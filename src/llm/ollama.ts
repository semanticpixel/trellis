import type { LLMAdapter } from './types.js';
import type { StreamRequest, StreamEvent, ToolDefinition } from '../shared/types.js';

export class OllamaAdapter implements LLMAdapter {
  readonly providerId = 'ollama';
  readonly displayName = 'Ollama';
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return (data.models ?? []).map((m) => ({ id: m.name, name: m.name }));
    } catch {
      return [];
    }
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const messages = convertMessages(request.messages, request.systemPrompt);
    const tools = convertTools(request.tools);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    if (request.temperature !== undefined) {
      body.options = { temperature: request.temperature };
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.abortSignal ?? undefined,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        yield { type: 'error', error: new Error(`Ollama API error ${res.status}: ${text}`) };
        return;
      }

      if (!res.body) {
        yield { type: 'error', error: new Error('Ollama returned no response body') };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let toolCallIndex = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Ollama sends newline-delimited JSON
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let chunk: OllamaChatChunk;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }

          // Text content
          if (chunk.message?.content) {
            yield { type: 'text_delta', text: chunk.message.content };
          }

          // Tool calls
          if (chunk.message?.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              const id = `ollama_tc_${toolCallIndex++}`;
              yield { type: 'tool_use_start', id, name: tc.function.name };
              yield { type: 'tool_use_end', id, name: tc.function.name, input: tc.function.arguments };
            }
          }

          // Final message (done: true)
          if (chunk.done) {
            yield {
              type: 'message_end',
              usage: {
                inputTokens: chunk.prompt_eval_count ?? 0,
                outputTokens: chunk.eval_count ?? 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
              },
            };
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk: OllamaChatChunk = JSON.parse(buffer);
          if (chunk.message?.content) {
            yield { type: 'text_delta', text: chunk.message.content };
          }
          if (chunk.done) {
            yield {
              type: 'message_end',
              usage: {
                inputTokens: chunk.prompt_eval_count ?? 0,
                outputTokens: chunk.eval_count ?? 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
              },
            };
          }
        } catch {
          // ignore trailing partial
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }
}

// ── Ollama types ───────────────────────────────────────────────

interface OllamaChatChunk {
  message?: {
    role: string;
    content?: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

// ── Helpers ────────────────────────────────────────────────────

function convertMessages(
  messages: StreamRequest['messages'],
  systemPrompt: string,
): Array<{ role: string; content: string; tool_calls?: unknown[]; images?: string[] }> {
  const result: Array<{ role: string; content: string; tool_calls?: unknown[]; images?: string[] }> = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      result.push({ role: 'tool', content: msg.content });
    } else if (msg.role === 'assistant' && msg.toolName && msg.toolUseId) {
      result.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          function: {
            name: msg.toolName,
            arguments: JSON.parse(msg.content),
          },
        }],
      });
    } else if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      // Ollama: bare base64 strings (no data URI prefix). Only multimodal
      // models (llava etc.) accept these — non-vision models will surface a
      // server-side error which we propagate as-is.
      result.push({
        role: 'user',
        content: msg.content,
        images: msg.images.map((img) => img.data),
      });
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

function convertTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
