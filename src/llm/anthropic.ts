import Anthropic from '@anthropic-ai/sdk';
import type { LLMAdapter } from './types.js';
import type { StreamRequest, StreamEvent, ToolDefinition } from '../shared/types.js';
import { DEFAULT_MAX_TOKENS } from '../shared/constants.js';

export class AnthropicAdapter implements LLMAdapter {
  readonly providerId = 'anthropic';
  readonly displayName = 'Anthropic';
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    return [
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ];
  }

  async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
    const messages = convertMessages(request.messages);
    const tools = convertTools(request.tools);

    const streamParams: Anthropic.MessageCreateParamsStreaming = {
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.systemPrompt,
      messages,
      stream: true,
    };

    if (tools.length > 0) {
      streamParams.tools = tools;
    }

    if (request.temperature !== undefined) {
      streamParams.temperature = request.temperature;
    }

    const stream = this.client.messages.stream(streamParams, {
      signal: request.abortSignal ?? undefined,
    });

    let currentToolId = '';
    let currentToolName = '';
    let toolInputJson = '';

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              currentToolId = block.id;
              currentToolName = block.name;
              toolInputJson = '';
              yield { type: 'tool_use_start', id: block.id, name: block.name };
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'thinking_delta') {
              yield { type: 'thinking_delta', text: delta.thinking };
            } else if (delta.type === 'input_json_delta') {
              toolInputJson += delta.partial_json;
              yield { type: 'tool_use_delta', id: currentToolId, partialInput: delta.partial_json };
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolId) {
              let input: unknown = {};
              try {
                input = JSON.parse(toolInputJson);
              } catch {
                // partial or empty input
              }
              yield { type: 'tool_use_end', id: currentToolId, name: currentToolName, input };
              currentToolId = '';
              currentToolName = '';
              toolInputJson = '';
            }
            break;
          }

          case 'message_delta': {
            // message_delta contains usage info at end of stream
            break;
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'message_end',
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          cacheReadTokens: (finalMessage.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
          cacheCreationTokens: (finalMessage.usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }
}

function convertMessages(messages: StreamRequest['messages']): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool results attach to the previous assistant message's tool_use
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolUseId!,
            content: msg.content,
          },
        ],
      });
    } else if (msg.role === 'assistant' && msg.toolName && msg.toolUseId) {
      // Assistant message with tool use
      result.push({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: msg.toolUseId,
            name: msg.toolName,
            input: JSON.parse(msg.content),
          },
        ],
      });
    } else {
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  return result;
}

function convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }));
}
