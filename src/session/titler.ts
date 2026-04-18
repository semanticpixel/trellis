import type { Store } from '../db/store.js';
import type { LLMAdapter } from '../llm/types.js';
import type { WSEventType } from '../shared/types.js';

export interface TitlerContext {
  store: Store;
  broadcast: (threadId: string, type: WSEventType, data: unknown) => void;
}

const TITLER_SYSTEM_PROMPT =
  'You generate concise titles for chat conversations. Respond with ONLY the title — no quotes, no trailing punctuation, no explanation.';

export async function generateTitleForThread(
  threadId: string,
  adapter: LLMAdapter,
  ctx: TitlerContext,
): Promise<void> {
  const { store, broadcast } = ctx;
  const thread = store.getThread(threadId);
  if (!thread) return;

  const messages = store.listMessages(threadId);
  const firstUser = messages.find((m) => m.role === 'user');
  const firstAssistantText = messages.find(
    (m) => m.role === 'assistant' && !m.tool_name && m.content.trim().length > 0,
  );
  if (!firstUser || !firstAssistantText) return;

  const prompt =
    `User message:\n${firstUser.content}\n\n` +
    `Assistant reply:\n${firstAssistantText.content}\n\n` +
    `Generate a 3-5 word title for this conversation.`;

  let text = '';
  try {
    const stream = adapter.stream({
      messages: [{ role: 'user', content: prompt }],
      tools: [],
      systemPrompt: TITLER_SYSTEM_PROMPT,
      model: thread.model,
      maxTokens: 32,
    });

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        text += event.text;
      } else if (event.type === 'error') {
        return;
      }
    }
  } catch {
    return;
  }

  const title = cleanTitle(text);
  if (!title) return;

  store.updateThreadTitle(threadId, title);
  broadcast(threadId, 'thread_update', { title });
}

function cleanTitle(raw: string): string {
  let t = raw.trim();
  t = t.split('\n')[0].trim();
  t = t.replace(/^["'`\u201C\u2018]+|["'`\u201D\u2019.!?,:;]+$/g, '').trim();
  if (t.length > 80) t = t.slice(0, 80).trim();
  return t;
}
