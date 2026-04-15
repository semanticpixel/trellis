// Parse .trellis-plan.md into annotatable steps

export interface PlanStep {
  id: string;
  content: string;  // raw markdown text of the step
  depth: number;    // nesting level (0 = top-level heading, 1 = subheading, etc.)
  lineStart: number;
  lineEnd: number;
}

/**
 * Parse a plan markdown document into a list of selectable steps.
 * Steps are identified by: headings (#, ##, ###), numbered lists (1., 2.),
 * and bullet points (-, *).
 */
export function parsePlan(markdown: string): PlanStep[] {
  const lines = markdown.split('\n');
  const steps: PlanStep[] = [];
  let stepIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();

    // Match headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const depth = headingMatch[1]!.length - 1; // # = 0, ## = 1, ### = 2
      // Find the end of this heading's content (until next heading of same or higher level, or end)
      let endLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j]!.trimStart();
        const nextHeading = nextTrimmed.match(/^(#{1,6})\s/);
        if (nextHeading && nextHeading[1]!.length <= headingMatch[1]!.length) {
          break;
        }
        // Stop at the next list item or heading at same level
        if (nextTrimmed.match(/^(#{1,6})\s/) || nextTrimmed.match(/^\d+\.\s/) || nextTrimmed.match(/^[-*]\s/)) {
          break;
        }
        endLine = j;
      }

      const content = lines.slice(i, endLine + 1).join('\n').trim();
      steps.push({
        id: `step-${stepIndex++}`,
        content,
        depth,
        lineStart: i,
        lineEnd: endLine,
      });
      continue;
    }

    // Match numbered lists (1., 2., etc.)
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      const indent = line.length - trimmed.length;
      const depth = Math.floor(indent / 2) + 3; // indent-based depth, offset from headings

      steps.push({
        id: `step-${stepIndex++}`,
        content: trimmed,
        depth,
        lineStart: i,
        lineEnd: i,
      });
      continue;
    }

    // Match bullet points (- or *)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      const indent = line.length - trimmed.length;
      const depth = Math.floor(indent / 2) + 3;

      steps.push({
        id: `step-${stepIndex++}`,
        content: trimmed,
        depth,
        lineStart: i,
        lineEnd: i,
      });
      continue;
    }
  }

  return steps;
}
