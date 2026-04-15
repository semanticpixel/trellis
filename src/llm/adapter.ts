import type { LLMAdapter } from './types.js';
import type { ProviderType } from '../shared/types.js';

const adapters = new Map<string, LLMAdapter>();

export function registerAdapter(adapter: LLMAdapter): void {
  adapters.set(adapter.providerId, adapter);
}

export function getAdapter(providerId: string): LLMAdapter {
  const adapter = adapters.get(providerId);
  if (!adapter) {
    throw new Error(`No adapter registered for provider: ${providerId}`);
  }
  return adapter;
}

export function listAdapters(): LLMAdapter[] {
  return Array.from(adapters.values());
}

export function hasAdapter(providerId: string): boolean {
  return adapters.has(providerId);
}
