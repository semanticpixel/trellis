export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiffFile {
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(patch: string): ParsedDiffFile[] {
  if (!patch.trim()) return [];

  const lines = patch.split('\n');
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  const finishHunk = () => {
    if (current && currentHunk) current.hunks.push(currentHunk);
    currentHunk = null;
  };
  const finishFile = () => {
    finishHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finishFile();
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = {
        oldPath: match?.[1] ?? '',
        newPath: match?.[2] ?? '',
        isNew: false,
        isDeleted: false,
        isBinary: false,
        hunks: [],
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode')) { current.isNew = true; continue; }
    if (line.startsWith('deleted file mode')) { current.isDeleted = true; continue; }
    if (line.startsWith('Binary files ')) { current.isBinary = true; continue; }
    if (line.startsWith('index ') || line.startsWith('similarity index') ||
        line.startsWith('rename ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch) {
      finishHunk();
      const oldStart = parseInt(hunkMatch[1]!, 10);
      const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3]!, 10);
      const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;
      currentHunk = { oldStart, oldCount, newStart, newCount, header: line, lines: [] };
      oldLineNo = oldStart;
      newLineNo = newStart;
      continue;
    }

    if (!currentHunk) continue;

    const marker = line[0];
    const content = line.slice(1);
    if (marker === '+') {
      currentHunk.lines.push({ type: 'add', content, oldNo: null, newNo: newLineNo });
      newLineNo += 1;
    } else if (marker === '-') {
      currentHunk.lines.push({ type: 'remove', content, oldNo: oldLineNo, newNo: null });
      oldLineNo += 1;
    } else if (marker === ' ') {
      currentHunk.lines.push({ type: 'context', content, oldNo: oldLineNo, newNo: newLineNo });
      oldLineNo += 1;
      newLineNo += 1;
    }
    // '\' lines (no-newline-at-end-of-file) are skipped
  }
  finishFile();

  return files;
}

export function findDiffForFile(files: ParsedDiffFile[], path: string): ParsedDiffFile | null {
  return files.find((f) => f.newPath === path || f.oldPath === path) ?? null;
}

export interface GapRange {
  /** First modified-file line number (1-based) included in the gap. */
  startLine: number;
  /** Last modified-file line number (1-based) included in the gap. */
  endLine: number;
}

/**
 * For a parsed file, compute the line ranges in the modified content that
 * fall *between* hunks (and before the first hunk / after the last hunk).
 *
 * `totalNewLines` is the total line count of the modified file — used to
 * compute the trailing gap. Pass `null` to skip the trailing gap.
 */
export function computeGaps(file: ParsedDiffFile, totalNewLines: number | null): GapRange[] {
  const gaps: GapRange[] = [];
  if (file.hunks.length === 0) return gaps;

  // Leading gap: lines [1 .. firstHunk.newStart - 1]
  const first = file.hunks[0]!;
  if (first.newStart > 1) {
    gaps.push({ startLine: 1, endLine: first.newStart - 1 });
  } else {
    gaps.push({ startLine: 1, endLine: 0 }); // empty placeholder so indexing aligns
  }

  for (let i = 0; i < file.hunks.length - 1; i++) {
    const a = file.hunks[i]!;
    const b = file.hunks[i + 1]!;
    const start = a.newStart + a.newCount;
    const end = b.newStart - 1;
    gaps.push({ startLine: start, endLine: end });
  }

  // Trailing gap
  const last = file.hunks[file.hunks.length - 1]!;
  const start = last.newStart + last.newCount;
  if (totalNewLines !== null && start <= totalNewLines) {
    gaps.push({ startLine: start, endLine: totalNewLines });
  } else {
    gaps.push({ startLine: start, endLine: start - 1 });
  }

  return gaps;
}
