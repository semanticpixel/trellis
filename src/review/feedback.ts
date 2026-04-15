import type { Annotation } from '../shared/types.js';

/**
 * Convert a set of annotations into natural language feedback
 * that gets prepended to the next LLM message.
 */
export function formatFeedback(annotations: Annotation[]): string {
  if (annotations.length === 0) return '';

  const lines = annotations.map((a) => {
    const prefix = a.annotation_type === 'delete'
      ? '[DELETE]'
      : a.annotation_type === 'replace'
      ? '[REPLACE]'
      : a.annotation_type === 'question'
      ? '[QUESTION]'
      : '[COMMENT]';

    const target = a.target_type === 'diff_line'
      ? `on ${a.target_ref}`
      : `on step "${a.target_ref}"`;

    const replacement = a.replacement ? `\nSuggested replacement: ${a.replacement}` : '';

    return `${prefix} ${target}: ${a.text}${replacement}`;
  });

  return '\n\n--- Feedback from reviewer ---\n' + lines.join('\n');
}
