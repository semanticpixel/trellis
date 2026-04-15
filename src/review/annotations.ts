import type { Store } from '../db/store.js';
import type { Annotation } from '../shared/types.js';

/**
 * Get unresolved annotations for a thread, optionally filtered to specific IDs.
 */
export function getUnresolvedAnnotations(
  store: Store,
  threadId: string,
  annotationIds?: string[],
): Annotation[] {
  const all = store.listAnnotations(threadId, true); // true = unresolved only
  if (!annotationIds) return all;
  const idSet = new Set(annotationIds);
  return all.filter((a) => idSet.has(a.id));
}
