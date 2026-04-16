import type { LLMMessage } from '../shared/types.js';

/**
 * Context window limits per provider family.
 * Conservative estimates leaving room for tool definitions and system prompt.
 */
const CONTEXT_LIMITS: Record<string, number> = {
  anthropic: 180_000, // 200k window, 20k reserved
  openai: 110_000,    // 128k window, 18k reserved
  ollama: 6_000,      // default for smaller models; overridden per model
  custom: 110_000,    // assume OpenAI-compatible defaults
};

/**
 * Approximate token count for a string.
 * Uses ~4 chars per token heuristic (good enough for truncation decisions).
 * Actual provider-side tokenization will be authoritative.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens across all messages.
 */
export function estimateConversationTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    // Each message has ~4 tokens of overhead (role, separators)
    total += 4 + estimateTokens(msg.content);
  }
  return total;
}

/**
 * Get the context limit for a given provider.
 */
export function getContextLimit(provider: string): number {
  return CONTEXT_LIMITS[provider] ?? CONTEXT_LIMITS.custom;
}

/**
 * Compact messages when approaching context limits.
 *
 * Strategy:
 * - Always preserve the first user message (sets context)
 * - Always preserve the last N messages (recent context is most important)
 * - Always preserve tool_use/tool result pairs (breaking these corrupts the conversation)
 * - Truncate from the middle, oldest first
 * - Insert a "[Earlier messages truncated]" marker where truncation occurred
 *
 * @param messages - Full conversation messages
 * @param provider - Provider type for context limit lookup
 * @param systemPromptTokens - Estimated tokens in system prompt + tool defs
 * @returns Compacted messages that fit within the context window
 */
export function compactMessages(
  messages: LLMMessage[],
  provider: string,
  systemPromptTokens = 2000,
): LLMMessage[] {
  const limit = getContextLimit(provider);
  const available = limit - systemPromptTokens;

  const totalTokens = estimateConversationTokens(messages);
  if (totalTokens <= available) {
    return messages;
  }

  // Number of recent messages to always keep (recent tool loops + last exchange)
  const KEEP_RECENT = 20;
  const KEEP_FIRST = 1; // first user message

  if (messages.length <= KEEP_RECENT + KEEP_FIRST) {
    // Can't compact further, return as-is
    return messages;
  }

  const firstMessages = messages.slice(0, KEEP_FIRST);
  const recentMessages = messages.slice(-KEEP_RECENT);

  // Check if first + recent already fits
  const preservedTokens = estimateConversationTokens(firstMessages) + estimateConversationTokens(recentMessages);
  if (preservedTokens >= available) {
    // Even preserved set is too big — just keep recent
    return [
      { role: 'user', content: '[Earlier conversation history truncated to fit context window]' },
      ...recentMessages,
    ];
  }

  // Fill middle from most recent to oldest until budget is reached
  const middleMessages = messages.slice(KEEP_FIRST, -KEEP_RECENT);
  const includedMiddle: LLMMessage[] = [];
  let budgetRemaining = available - preservedTokens;

  // Walk backwards through middle (keep most recent middle messages)
  for (let i = middleMessages.length - 1; i >= 0; i--) {
    const msg = middleMessages[i];
    const msgTokens = 4 + estimateTokens(msg.content);

    if (msgTokens > budgetRemaining) break;

    // Ensure tool result pairs stay together
    if (msg.role === 'tool' && i > 0 && middleMessages[i - 1].role === 'assistant' && middleMessages[i - 1].toolUseId) {
      const pairTokens = msgTokens + 4 + estimateTokens(middleMessages[i - 1].content);
      if (pairTokens > budgetRemaining) break;
      includedMiddle.unshift(msg);
      includedMiddle.unshift(middleMessages[i - 1]);
      budgetRemaining -= pairTokens;
      i--; // skip the assistant message we already included
    } else {
      includedMiddle.unshift(msg);
      budgetRemaining -= msgTokens;
    }
  }

  const truncationMarker: LLMMessage = {
    role: 'user',
    content: `[${middleMessages.length - includedMiddle.length} earlier messages truncated to fit context window]`,
  };

  return [
    ...firstMessages,
    truncationMarker,
    ...includedMiddle,
    ...recentMessages,
  ];
}
