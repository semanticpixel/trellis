import type { StreamRequest, StreamEvent } from '../shared/types.js';

export interface LLMAdapter {
  readonly providerId: string;
  readonly displayName: string;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<Array<{ id: string; name: string }>>;
  stream(request: StreamRequest): AsyncIterable<StreamEvent>;
}
