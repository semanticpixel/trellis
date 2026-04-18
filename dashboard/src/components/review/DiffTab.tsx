import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ThemedToken } from 'shiki';
import { DiffFileList, type AnnotationCount } from './DiffFileList';
import { InlineComment } from './InlineComment';
import { AnnotationBadge } from './AnnotationBadge';
import {
  useDiffSummary,
  useFileDiff,
  useStageFile,
  useRevertFile,
  useCreateAnnotation,
  useDeleteAnnotation,
} from '../../hooks/useReview';
import { useBranches } from '../../hooks/useWorkspaces';
import {
  parseUnifiedDiff,
  findDiffForFile,
  computeGaps,
  type ParsedDiffFile,
  type DiffHunk,
  type DiffLine,
  type GapRange,
} from '../../utils/diffParser';
import { highlightCode, languageFromFile } from '../../utils/highlighter';
import type { Thread, Annotation, AnnotationType } from '@shared/types';
import styles from './DiffTab.module.css';

interface DiffTabProps {
  thread: Thread;
  repoId: string | null;
  annotations: Annotation[];
  selectedAnnotationIds: Set<string>;
  onToggleAnnotation: (id: string) => void;
  autoFocusFile?: { path: string; token: number } | null;
}

const DEFAULT_GAP_PEEK = 3;

export function DiffTab({
  thread,
  repoId,
  annotations,
  selectedAnnotationIds,
  onToggleAnnotation,
  autoFocusFile,
}: DiffTabProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commentLineNumber, setCommentLineNumber] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (autoFocusFile?.path) setSelectedFile(autoFocusFile.path);
  }, [autoFocusFile?.token, autoFocusFile?.path]);

  useEffect(() => {
    setCommentLineNumber(null);
    rowRefs.current.clear();
  }, [selectedFile]);

  const baseRef = thread.base_commit ?? undefined;
  const { data: diffSummary } = useDiffSummary(repoId, baseRef);
  const { data: fileDiff } = useFileDiff(repoId, selectedFile, baseRef);
  const { data: branches } = useBranches(repoId);
  const stageFile = useStageFile();
  const revertFile = useRevertFile();
  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  const fileAnnotations = annotations.filter(
    (a) => a.target_type === 'diff_line' && a.target_ref.startsWith((selectedFile ?? '') + ':'),
  );

  const annotationCounts = annotations.reduce<Record<string, AnnotationCount>>((acc, a) => {
    if (a.target_type !== 'diff_line' || a.resolved === 1) return acc;
    const path = a.target_ref.slice(0, a.target_ref.lastIndexOf(':'));
    if (!path) return acc;
    const entry = acc[path] ?? { active: 0, outdated: 0 };
    if (a.stale === true) entry.outdated += 1;
    else entry.active += 1;
    acc[path] = entry;
    return acc;
  }, {});

  const annotationsByLine = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of fileAnnotations) {
      const parts = a.target_ref.split(':');
      const line = parseInt(parts[parts.length - 1]!, 10);
      if (Number.isNaN(line)) continue;
      const group = m.get(line) ?? [];
      group.push(a);
      m.set(line, group);
    }
    return m;
  }, [fileAnnotations]);

  // Parse the full patch once per diff summary; pick out the selected file.
  const parsedFiles = useMemo<ParsedDiffFile[]>(
    () => parseUnifiedDiff(diffSummary?.patch ?? ''),
    [diffSummary?.patch],
  );
  const fileParsed = selectedFile ? findDiffForFile(parsedFiles, selectedFile) : null;
  const modifiedLines = useMemo(() => (fileDiff?.modified ?? '').split('\n'), [fileDiff?.modified]);
  const originalLines = useMemo(() => (fileDiff?.original ?? '').split('\n'), [fileDiff?.original]);

  // Highlight modified + original. Both run in parallel.
  const lang = selectedFile ? languageFromFile(selectedFile) : 'plaintext';
  const [modifiedTokens, setModifiedTokens] = useState<ThemedToken[][]>([]);
  const [originalTokens, setOriginalTokens] = useState<ThemedToken[][]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!fileDiff) {
      setModifiedTokens([]);
      setOriginalTokens([]);
      return;
    }
    Promise.all([
      highlightCode(fileDiff.modified, lang),
      highlightCode(fileDiff.original, lang),
    ]).then(([m, o]) => {
      if (cancelled) return;
      setModifiedTokens(m.lines);
      setOriginalTokens(o.lines);
    });
    return () => {
      cancelled = true;
    };
  }, [fileDiff, lang]);

  const gaps = useMemo<GapRange[]>(() => {
    if (!fileParsed) return [];
    return computeGaps(fileParsed, modifiedLines.length || null);
  }, [fileParsed, modifiedLines.length]);

  // Auto-scroll the active comment row into view.
  useEffect(() => {
    if (commentLineNumber === null) return;
    const el = rowRefs.current.get(commentLineNumber);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [commentLineNumber]);

  const handleCommentSubmit = useCallback(
    (type: AnnotationType, text: string, replacement?: string) => {
      if (!selectedFile || commentLineNumber === null) return;
      createAnnotation.mutate(
        {
          threadId: thread.id,
          target_type: 'diff_line',
          target_ref: `${selectedFile}:${commentLineNumber}`,
          annotation_type: type,
          text,
          replacement,
        },
        {
          onSuccess: (newAnnotation) => {
            setCommentLineNumber(null);
            onToggleAnnotation(newAnnotation.id);
          },
        },
      );
    },
    [selectedFile, commentLineNumber, thread.id, createAnnotation, onToggleAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => deleteAnnotation.mutate({ id, threadId: thread.id }),
    [thread.id, deleteAnnotation],
  );

  const handleStage = useCallback(
    (file: string) => repoId && stageFile.mutate({ repoId, filePath: file }),
    [repoId, stageFile],
  );
  const handleRevert = useCallback(
    (file: string) => repoId && revertFile.mutate({ repoId, filePath: file, baseRef }),
    [repoId, baseRef, revertFile],
  );

  if (!repoId) {
    return <div className={styles.placeholder}>Select a repo-level thread to view diffs</div>;
  }

  const fileSummary = diffSummary?.files.find((f) => f.file === selectedFile);
  const currentBranch = branches?.find((b) => b.isCurrent)?.name ?? 'HEAD';
  const baseLabel = baseRef ?? 'HEAD';

  return (
    <div className={styles.container}>
      <div className={styles.branchLine} title={`Comparing ${baseLabel} to ${currentBranch}`}>
        <span className={styles.branchBase}>{baseLabel}</span>
        <span className={styles.branchArrow}>→</span>
        <span className={styles.branchHead}>{currentBranch}</span>
      </div>

      <DiffFileList
        files={diffSummary?.files ?? []}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        onStage={handleStage}
        onRevert={handleRevert}
        annotationCounts={annotationCounts}
      />

      {selectedFile && fileParsed ? (
        <div className={styles.editorContainer}>
          <div className={styles.editorHeader}>
            <span className={styles.editorFileName}>{selectedFile}</span>
            <span className={styles.editorStats}>
              {fileSummary && fileSummary.additions > 0 && (
                <span className={styles.statAdd}>+{fileSummary.additions}</span>
              )}
              {fileSummary && fileSummary.deletions > 0 && (
                <span className={styles.statDel}>-{fileSummary.deletions}</span>
              )}
            </span>
            <span className={styles.editorHint}>Click a line number to leave a review comment</span>
          </div>

          <DiffBody
            file={fileParsed}
            gaps={gaps}
            modifiedLines={modifiedLines}
            originalLines={originalLines}
            modifiedTokens={modifiedTokens}
            originalTokens={originalTokens}
            annotationsByLine={annotationsByLine}
            commentLineNumber={commentLineNumber}
            onSelectLine={setCommentLineNumber}
            rowRefs={rowRefs}
          />

          {commentLineNumber !== null && (
            <div className={styles.inlineCommentContainer}>
              <div className={styles.inlineCommentLine}>Line {commentLineNumber}</div>
              <InlineComment
                onSubmit={handleCommentSubmit}
                onCancel={() => setCommentLineNumber(null)}
              />
            </div>
          )}

          {fileAnnotations.length > 0 && (
            <div className={styles.annotationList}>
              {fileAnnotations.map((a) => (
                <div key={a.id} className={styles.annotationRow}>
                  <span className={styles.annotationLineRef}>L{a.target_ref.split(':').pop()}</span>
                  <AnnotationBadge
                    annotation={a}
                    selected={selectedAnnotationIds.has(a.id)}
                    onToggleSelect={onToggleAnnotation}
                    onDelete={handleDeleteAnnotation}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : selectedFile ? (
        <div className={styles.placeholder}>Loading diff...</div>
      ) : (
        <div className={styles.placeholder}>Select a file to view its diff</div>
      )}
    </div>
  );
}

// ── Body ──────────────────────────────────────────────────────────

interface DiffBodyProps {
  file: ParsedDiffFile;
  gaps: GapRange[];
  modifiedLines: string[];
  originalLines: string[];
  modifiedTokens: ThemedToken[][];
  originalTokens: ThemedToken[][];
  annotationsByLine: Map<number, Annotation[]>;
  commentLineNumber: number | null;
  onSelectLine: (line: number) => void;
  rowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
}

function DiffBody({
  file,
  gaps,
  modifiedLines,
  originalLines,
  modifiedTokens,
  originalTokens,
  annotationsByLine,
  commentLineNumber,
  onSelectLine,
  rowRefs,
}: DiffBodyProps) {
  const segments: React.ReactNode[] = [];
  for (let i = 0; i < file.hunks.length; i++) {
    const gap = gaps[i];
    if (gap && gap.endLine >= gap.startLine) {
      segments.push(
        <GapRow
          key={`gap-${i}`}
          gap={gap}
          modifiedLines={modifiedLines}
          modifiedTokens={modifiedTokens}
          annotationsByLine={annotationsByLine}
          commentLineNumber={commentLineNumber}
          onSelectLine={onSelectLine}
          rowRefs={rowRefs}
        />,
      );
    }
    const hunk = file.hunks[i]!;
    segments.push(
      <HunkRows
        key={`hunk-${i}`}
        hunk={hunk}
        modifiedTokens={modifiedTokens}
        originalTokens={originalTokens}
        annotationsByLine={annotationsByLine}
        commentLineNumber={commentLineNumber}
        onSelectLine={onSelectLine}
        rowRefs={rowRefs}
      />,
    );
  }
  // Trailing gap
  const trailing = gaps[file.hunks.length];
  if (trailing && trailing.endLine >= trailing.startLine) {
    segments.push(
      <GapRow
        key="gap-trailing"
        gap={trailing}
        modifiedLines={modifiedLines}
        modifiedTokens={modifiedTokens}
        annotationsByLine={annotationsByLine}
        commentLineNumber={commentLineNumber}
        onSelectLine={onSelectLine}
        rowRefs={rowRefs}
      />,
    );
  }

  return (
    <div className={styles.diffBody}>
      <div className={styles.diffBodyInner}>{segments}</div>
    </div>
  );
}

// ── Hunk ──────────────────────────────────────────────────────────

interface HunkRowsProps {
  hunk: DiffHunk;
  modifiedTokens: ThemedToken[][];
  originalTokens: ThemedToken[][];
  annotationsByLine: Map<number, Annotation[]>;
  commentLineNumber: number | null;
  onSelectLine: (line: number) => void;
  rowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
}

function HunkRows({
  hunk,
  modifiedTokens,
  originalTokens,
  annotationsByLine,
  commentLineNumber,
  onSelectLine,
  rowRefs,
}: HunkRowsProps) {
  return (
    <>
      {hunk.lines.map((line, idx) => (
        <DiffRow
          key={`${hunk.newStart}-${idx}`}
          line={line}
          modifiedTokens={modifiedTokens}
          originalTokens={originalTokens}
          active={line.newNo !== null && line.newNo === commentLineNumber}
          annotations={line.newNo !== null ? annotationsByLine.get(line.newNo) : undefined}
          onSelect={() => line.newNo !== null && onSelectLine(line.newNo)}
          rowRefs={rowRefs}
        />
      ))}
    </>
  );
}

// ── Gap ───────────────────────────────────────────────────────────

interface GapRowProps {
  gap: GapRange;
  modifiedLines: string[];
  modifiedTokens: ThemedToken[][];
  annotationsByLine: Map<number, Annotation[]>;
  commentLineNumber: number | null;
  onSelectLine: (line: number) => void;
  rowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
}

function GapRow({
  gap,
  modifiedLines,
  modifiedTokens,
  annotationsByLine,
  commentLineNumber,
  onSelectLine,
  rowRefs,
}: GapRowProps) {
  const [expanded, setExpanded] = useState(false);
  const total = gap.endLine - gap.startLine + 1;
  if (total <= 0) return null;

  // If the gap is small enough to show fully without an expand control,
  // just render it inline.
  const peek = Math.min(DEFAULT_GAP_PEEK, total);
  const visibleLines = expanded
    ? rangeArray(gap.startLine, gap.endLine)
    : rangeArray(gap.startLine, gap.startLine + peek - 1);
  const hidden = total - visibleLines.length;

  return (
    <>
      {visibleLines.map((newNo) => {
        const content = modifiedLines[newNo - 1] ?? '';
        const tokens = modifiedTokens[newNo - 1];
        const line: DiffLine = { type: 'context', content, oldNo: null, newNo };
        return (
          <DiffRow
            key={`gap-${newNo}`}
            line={line}
            modifiedTokens={tokens ? [tokens] : []}
            originalTokens={[]}
            tokenIndex={0}
            active={commentLineNumber === newNo}
            annotations={annotationsByLine.get(newNo)}
            onSelect={() => onSelectLine(newNo)}
            rowRefs={rowRefs}
            isGap
          />
        );
      })}
      {hidden > 0 && (
        <button className={styles.gapToggle} onClick={() => setExpanded(true)}>
          Show {hidden} more unmodified line{hidden === 1 ? '' : 's'} ▾
        </button>
      )}
      {expanded && total > DEFAULT_GAP_PEEK && (
        <button className={styles.gapToggle} onClick={() => setExpanded(false)}>
          Hide unmodified lines ▴
        </button>
      )}
    </>
  );
}

// ── Row ───────────────────────────────────────────────────────────

interface DiffRowProps {
  line: DiffLine;
  modifiedTokens: ThemedToken[][];
  originalTokens: ThemedToken[][];
  /** When provided, override the line-number lookup into the tokens array. */
  tokenIndex?: number;
  active: boolean;
  annotations?: Annotation[];
  onSelect: () => void;
  rowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  isGap?: boolean;
}

function DiffRow({
  line,
  modifiedTokens,
  originalTokens,
  tokenIndex,
  active,
  annotations,
  onSelect,
  rowRefs,
  isGap,
}: DiffRowProps) {
  const isAdd = line.type === 'add';
  const isRemove = line.type === 'remove';
  const tokens =
    tokenIndex !== undefined
      ? modifiedTokens[tokenIndex]
      : isRemove && line.oldNo !== null
        ? originalTokens[line.oldNo - 1]
        : line.newNo !== null
          ? modifiedTokens[line.newNo - 1]
          : undefined;

  const setRef = (el: HTMLDivElement | null) => {
    if (line.newNo === null) return;
    if (el) rowRefs.current.set(line.newNo, el);
    else rowRefs.current.delete(line.newNo);
  };

  const rowClass = [
    styles.row,
    isAdd ? styles.rowAdd : '',
    isRemove ? styles.rowRemove : '',
    !isAdd && !isRemove ? styles.rowContext : '',
    active ? styles.rowActive : '',
    isGap ? styles.rowGap : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleGutterClick = () => {
    if (line.newNo !== null) onSelect();
  };

  return (
    <>
      <div className={rowClass} ref={setRef}>
        <button
          type="button"
          className={styles.gutter}
          onClick={handleGutterClick}
          tabIndex={line.newNo === null ? -1 : 0}
          aria-label={line.newNo !== null ? `Comment on line ${line.newNo}` : undefined}
          disabled={line.newNo === null}
        >
          <span className={styles.gutterOld}>{line.oldNo ?? ''}</span>
          <span className={styles.gutterNew}>{line.newNo ?? ''}</span>
        </button>
        <span className={styles.marker} aria-hidden />
        <span className={styles.markerSign}>{isAdd ? '+' : isRemove ? '-' : ' '}</span>
        <code className={styles.code}>{renderTokens(line.content, tokens)}</code>
      </div>
      {annotations && annotations.length > 0 && (
        <div className={styles.lineAnnotations}>
          {annotations.map((a) => {
            const stale = a.resolved === 0 && a.stale === true;
            const muted = a.resolved === 1 || stale;
            return (
              <div
                key={a.id}
                className={`${styles.annotationPill} ${muted ? styles.annotationPillMuted : ''}`}
              >
                <span className={styles.annotationPillType}>{a.annotation_type.toUpperCase()}</span>
                {stale && <span className={styles.outdatedPill}>outdated</span>}
                <span className={styles.annotationPillText}>{a.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function renderTokens(content: string, tokens: ThemedToken[] | undefined): React.ReactNode {
  if (content === '') return '\u00A0';
  if (!tokens || tokens.length === 0) return content;
  // Defensive: shiki tokens do not include trailing newlines, so they
  // already line up with our split('\n') content lines.
  return tokens.map((t, i) => (
    <span key={i} style={t.color ? { color: t.color } : undefined}>
      {t.content}
    </span>
  ));
}

function rangeArray(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
