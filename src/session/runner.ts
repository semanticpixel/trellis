import type { Store } from '../db/store.js';
import type { LLMAdapter } from '../llm/types.js';
import type { LLMMessage, StreamEvent, WSEventType } from '../shared/types.js';
import { getTool, getToolDefinitions } from '../tools/registry.js';
import { MAX_TOOL_LOOPS } from '../shared/constants.js';
import { compactMessages, estimateTokens } from './history.js';
import { generateTitleForThread } from './titler.js';
import { isMcpToolName, mcpManager } from '../mcp/manager.js';
import { buildExpandedMessage, expandMentionedFiles, type MentionFileCache } from './file-mentions.js';

export interface RunnerContext {
  store: Store;
  broadcast: (threadId: string, type: WSEventType, data: unknown) => void;
}

export async function runThread(
  threadId: string,
  adapter: LLMAdapter,
  ctx: RunnerContext,
  abortSignal: AbortSignal,
): Promise<void> {
  const { store, broadcast } = ctx;
  const thread = store.getThread(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);

  // Resolve workspace path for tool sandboxing
  const workspace = store.getWorkspace(thread.workspace_id);
  if (!workspace) throw new Error(`Workspace not found: ${thread.workspace_id}`);

  const workspacePath = thread.repo_id
    ? store.getRepo(thread.repo_id)?.path ?? workspace.path
    : workspace.path;

  const mcpTools = mcpManager.listTools(thread.workspace_id);
  const toolDefs = [...getToolDefinitions(), ...mcpTools];
  const toolContext = { workspacePath, threadId };

  // Build system prompt
  const systemPrompt = thread.system_prompt ?? buildDefaultSystemPrompt(workspacePath);

  // Annotation context is no longer auto-injected here.
  // Users send feedback explicitly via POST /threads/:id/send-feedback,
  // which injects selected annotations as a user message before triggering the session.

  store.updateThreadStatus(threadId, 'running');
  broadcast(threadId, 'thread_status', { status: 'running' });
  broadcast(threadId, 'thread_stream_start', {});

  let loopCount = 0;
  // Cache @path file reads across tool-loop iterations within this run. Without
  // it, three @mentions × five iterations = fifteen disk reads of identical
  // content. Cache is per-runThread so a fresh send picks up edits made between
  // turns; mid-turn tool edits don't change the snapshot the LLM was given.
  const mentionCache: MentionFileCache = new Map();

  try {
    while (loopCount < MAX_TOOL_LOOPS) {
      if (abortSignal.aborted) break;
      loopCount++;

      // Load messages from DB
      const dbMessages = store.listMessages(threadId);
      const allMessages: LLMMessage[] = dbMessages.map((m) => ({
        role: m.role as LLMMessage['role'],
        content: m.content,
        toolName: m.tool_name ?? undefined,
        toolUseId: m.tool_use_id ?? undefined,
      }));

      // Expand @path tokens in user messages. The DB record stays unchanged —
      // expansion is ephemeral, applied only to the message stream sent to the
      // adapter. If the most recent user message references a missing or
      // oversized file, surface a thread_error and abort the send (the user
      // can edit and resend).
      let expansionFailed = false;
      for (let i = 0; i < allMessages.length; i++) {
        const m = allMessages[i];
        if (m.role !== 'user' || m.toolUseId) continue;
        if (!m.content.includes('@')) continue;
        const expansion = await expandMentionedFiles(m.content, workspacePath, mentionCache);
        if (!expansion.ok) {
          // Only abort if this is the most recent user message — older messages
          // may reference files that have since been deleted; we don't want to
          // permanently brick a thread for that.
          const isLastUser = !allMessages.slice(i + 1).some((later) => later.role === 'user' && !later.toolUseId);
          if (isLastUser) {
            store.updateThreadStatus(threadId, 'error');
            broadcast(threadId, 'thread_error', { error: expansion.error });
            broadcast(threadId, 'thread_status', { status: 'error' });
            expansionFailed = true;
            break;
          }
          continue;
        }
        if (expansion.files.length > 0) {
          allMessages[i] = { ...m, content: buildExpandedMessage(m.content, expansion.files) };
        }
      }
      if (expansionFailed) return;

      // Compact messages if approaching context limit
      const systemPromptTokens = estimateTokens(systemPrompt) + 2000; // ~2k for tool defs
      const messages = compactMessages(allMessages, thread.provider, systemPromptTokens);

      // Stream from LLM
      let assistantText = '';
      const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];

      // Per-iteration abort signal: linked to the session signal but disposed
      // when the iteration ends, so provider SDK listeners don't accumulate on
      // the session-level signal across tool-loop iterations.
      const iterationController = new AbortController();
      const onSessionAbort = () => iterationController.abort();
      abortSignal.addEventListener('abort', onSessionAbort, { once: true });

      try {
        const stream = adapter.stream({
          messages,
          tools: toolDefs,
          systemPrompt,
          model: thread.model,
          abortSignal: iterationController.signal,
        });

        for await (const event of stream) {
          if (abortSignal.aborted) break;
          handleStreamEvent(event, threadId, broadcast, assistantText, toolCalls);

          if (event.type === 'text_delta') {
            assistantText += event.text;
          } else if (event.type === 'tool_use_end') {
            toolCalls.push({ id: event.id, name: event.name, input: event.input });
          } else if (event.type === 'error') {
            store.updateThreadStatus(threadId, 'error');
            broadcast(threadId, 'thread_error', { error: event.error.message });
            broadcast(threadId, 'thread_status', { status: 'error' });
            return;
          }
        }
      } finally {
        abortSignal.removeEventListener('abort', onSessionAbort);
      }

      if (abortSignal.aborted) break;

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        if (assistantText) {
          const msg = store.createMessage(threadId, 'assistant', assistantText);
          broadcast(threadId, 'thread_message', msg);
        }
        break;
      }

      // Store assistant message with tool calls
      // For each tool call, store the assistant's tool_use then execute and store tool result
      if (assistantText) {
        const msg = store.createMessage(threadId, 'assistant', assistantText);
        broadcast(threadId, 'thread_message', msg);
      }

      for (const tc of toolCalls) {
        // Store assistant tool_use message
        const toolUseMsg = store.createMessage(
          threadId,
          'assistant',
          JSON.stringify(tc.input),
          tc.name,
          tc.id,
        );
        broadcast(threadId, 'thread_message', toolUseMsg);

        // Execute tool
        broadcast(threadId, 'thread_tool_start', { toolUseId: tc.id, name: tc.name });

        let result;
        if (isMcpToolName(tc.name)) {
          try {
            result = await mcpManager.callTool(
              thread.workspace_id,
              tc.name,
              (tc.input ?? {}) as Record<string, unknown>,
            );
          } catch (err) {
            result = {
              output: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`,
              isError: true,
            };
          }
        } else {
          const tool = getTool(tc.name);
          if (!tool) {
            result = { output: `Unknown tool: ${tc.name}`, isError: true };
          } else {
            try {
              result = await tool.execute(tc.input as Record<string, unknown>, toolContext);
            } catch (err) {
              result = {
                output: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
                isError: true,
              };
            }
          }
        }

        // Store tool result
        const toolResultMsg = store.createMessage(
          threadId,
          'tool',
          result.output,
          tc.name,
          tc.id,
        );
        broadcast(threadId, 'thread_tool_end', {
          toolUseId: tc.id,
          name: tc.name,
          input: tc.input,
          result,
        });
        broadcast(threadId, 'thread_message', toolResultMsg);
      }

      // Loop back to call LLM again with tool results
    }

    if (loopCount >= MAX_TOOL_LOOPS) {
      store.createMessage(threadId, 'assistant', 'Reached maximum tool loop limit. Stopping.');
      broadcast(threadId, 'thread_error', { error: 'Max tool loops reached' });
    }

    store.updateThreadStatus(threadId, 'done');
    broadcast(threadId, 'thread_stream_end', {});
    broadcast(threadId, 'thread_status', { status: 'done' });

    if (!abortSignal.aborted && loopCount < MAX_TOOL_LOOPS) {
      const finalMessages = store.listMessages(threadId);
      const userMessageCount = finalMessages.filter((m) => m.role === 'user').length;
      if (userMessageCount === 1) {
        generateTitleForThread(threadId, adapter, { store, broadcast }).catch((err) => {
          console.error(`[trellis] Title generation failed for ${threadId}:`, err);
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.updateThreadStatus(threadId, 'error');
    broadcast(threadId, 'thread_error', { error: message });
    broadcast(threadId, 'thread_status', { status: 'error' });
  }
}

function handleStreamEvent(
  event: StreamEvent,
  threadId: string,
  broadcast: RunnerContext['broadcast'],
  _assistantText: string,
  _toolCalls: Array<{ id: string; name: string; input: unknown }>,
): void {
  switch (event.type) {
    case 'text_delta':
      broadcast(threadId, 'thread_stream_delta', { text: event.text });
      break;
    case 'tool_use_start':
      // Handled inline
      break;
    case 'tool_use_delta':
      broadcast(threadId, 'thread_stream_delta', { toolUseId: event.id, partialInput: event.partialInput });
      break;
    case 'message_end':
      // Usage tracked but not broadcast for now
      break;
  }
}

function buildDefaultSystemPrompt(workspacePath: string): string {
  return `You are a helpful coding assistant. You have access to tools to read, write, and edit files, run shell commands, and list files in the workspace at: ${workspacePath}

When the user asks you to make changes, use the tools to read existing files first, then make targeted edits. Prefer edit_file over write_file for existing files.

Be concise in your responses.`;
}
