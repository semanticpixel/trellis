import OpenAI from 'openai';
import type { LLMAdapter } from './types.js';
import type { StreamRequest, StreamEvent, ToolDefinition } from '../shared/types.js';
import { DEFAULT_MAX_TOKENS } from '../shared/constants.js';

/**
 * Custom adapter for any OpenAI-compatible API endpoint.
 * Identical to OpenAIAdapter but with configurable baseURL and provider identity.
 */
export class CustomAdapter implements LLMAdapter {
  readonly providerId: string;
  readonly displayName: string;
  private client: OpenAI;
  private defaultModels: Array<{ id: string; name: string }>;

  constructor(
    providerId: string,
    displayName: string,
    baseURL: string,
    apiKey: string,
    defaultModels: Array<{ id: string; name: string }> = [],
  ) {
    this.providerId = providerId;
    this.displayName = displayName;
    this.defaultModels = defaultModels;
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await this.client.models.list();
      return response.data
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => ({ id: m.id, name: m.id }));
    } catch {
      return this.defaultModels;
    }
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const messages = convertMessages(request.messages, request.systemPrompt);
    const tools = convertTools(request.tools);

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: request.model,
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools.length > 0) {
      params.tools = tools;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    try {
      const stream = await this.client.chat.completions.create(params, {
        signal: request.abortSignal ?? undefined,
      });

      const toolCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];

        if (choice?.delta?.content) {
          yield { type: 'text_delta', text: choice.delta.content };
        }

        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const existing = toolCalls.get(tc.index);
            if (!existing) {
              const id = tc.id ?? `tc_${tc.index}`;
              const name = tc.function?.name ?? '';
              toolCalls.set(tc.index, { id, name, args: tc.function?.arguments ?? '' });
              yield { type: 'tool_use_start', id, name };
            } else {
              const partialArgs = tc.function?.arguments ?? '';
              existing.args += partialArgs;
              yield { type: 'tool_use_delta', id: existing.id, partialInput: partialArgs };
            }
          }
        }

        if (choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'stop') {
          for (const [, tc] of toolCalls) {
            let input: unknown = {};
            try {
              input = JSON.parse(tc.args);
            } catch {
              // partial or empty
            }
            yield { type: 'tool_use_end', id: tc.id, name: tc.name, input };
          }
          toolCalls.clear();
        }

        if (chunk.usage) {
          yield {
            type: 'message_end',
            usage: {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
          };
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

function convertMessages(
  messages: StreamRequest['messages'],
  systemPrompt: string,
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolUseId!,
        content: msg.content,
      });
    } else if (msg.role === 'assistant' && msg.toolName && msg.toolUseId) {
      result.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: msg.toolUseId,
            type: 'function',
            function: {
              name: msg.toolName,
              arguments: msg.content,
            },
          },
        ],
      });
    } else if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = msg.images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mediaType};base64,${img.data}` },
      }));
      parts.push({ type: 'text', text: msg.content });
      result.push({ role: 'user', content: parts });
    } else {
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return result;
}

function convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
