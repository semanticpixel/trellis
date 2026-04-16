import { useState, useCallback, useRef, useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { DiffFileList } from './DiffFileList';
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

export function DiffTab({ thread, repoId, annotations, selectedAnnotationIds, onToggleAnnotation, autoFocusFile }: DiffTabProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commentLineNumber, setCommentLineNumber] = useState<number | null>(null);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const viewZoneIdsRef = useRef<string[]>([]);

  // When App signals a tool wrote/edited a file, focus that file's diff.
  useEffect(() => {
    if (autoFocusFile?.path) {
      setSelectedFile(autoFocusFile.path);
    }
  }, [autoFocusFile?.token, autoFocusFile?.path]);

  const baseRef = thread.base_commit ?? undefined;
  const { data: diffSummary } = useDiffSummary(repoId, baseRef);
  const { data: fileDiff } = useFileDiff(repoId, selectedFile, baseRef);
  const stageFile = useStageFile();
  const revertFile = useRevertFile();
  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  // Filter annotations for the selected file
  const fileAnnotations = annotations.filter(
    (a) => a.target_type === 'diff_line' && a.target_ref.startsWith(selectedFile + ':'),
  );

  const handleEditorMount = useCallback(
    (editor: editor.IStandaloneDiffEditor) => {
      editorRef.current = editor;

      // Add glyph margin click handler on the modified editor
      const modifiedEditor = editor.getModifiedEditor();
      modifiedEditor.onMouseDown((e) => {
        if (e.target.type === 2 /* GUTTER_GLYPH_MARGIN */ || e.target.type === 3 /* GUTTER_LINE_NUMBERS */) {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber) {
            setCommentLineNumber(lineNumber);
          }
        }
      });
    },
    [],
  );

  // Update viewZones when annotations change
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !selectedFile) return;

    const modifiedEditor = editor.getModifiedEditor();

    // Clear existing viewZones
    modifiedEditor.changeViewZones((accessor) => {
      for (const id of viewZoneIdsRef.current) {
        accessor.removeZone(id);
      }
      viewZoneIdsRef.current = [];
    });

    // Group annotations by line number
    const byLine = new Map<number, Annotation[]>();
    for (const a of fileAnnotations) {
      const parts = a.target_ref.split(':');
      const line = parseInt(parts[parts.length - 1]!, 10);
      if (isNaN(line)) continue;
      const group = byLine.get(line) ?? [];
      group.push(a);
      byLine.set(line, group);
    }

    if (byLine.size === 0) return;

    // Add viewZones for each annotated line
    modifiedEditor.changeViewZones((accessor) => {
      for (const [line, lineAnnotations] of byLine) {
        const domNode = document.createElement('div');
        domNode.className = styles.viewZoneContainer;

        for (const annotation of lineAnnotations) {
          const badgeEl = document.createElement('div');
          badgeEl.className = `${styles.viewZoneBadge} ${annotation.resolved === 1 ? styles.viewZoneResolved : ''}`;

          const typeLabel = annotation.annotation_type.toUpperCase();
          badgeEl.innerHTML = `
            <div class="${styles.viewZoneBadgeHeader}">
              <span class="${styles.viewZoneBadgeType}">${typeLabel}</span>
            </div>
            <div class="${styles.viewZoneBadgeText}">${escapeHtml(annotation.text)}</div>
            ${annotation.replacement ? `<div class="${styles.viewZoneBadgeReplacement}"><code>${escapeHtml(annotation.replacement)}</code></div>` : ''}
          `;
          domNode.appendChild(badgeEl);
        }

        const id = accessor.addZone({
          afterLineNumber: line,
          heightInLines: Math.min(lineAnnotations.length * 3, 10),
          domNode,
        });
        viewZoneIdsRef.current.push(id);
      }
    });
  }, [fileAnnotations, selectedFile]);

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
          onSuccess: () => {
            setCommentLineNumber(null);
          },
        },
      );
    },
    [selectedFile, commentLineNumber, thread.id, createAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      deleteAnnotation.mutate({ id, threadId: thread.id });
    },
    [thread.id, deleteAnnotation],
  );

  const handleStage = useCallback(
    (file: string) => {
      if (!repoId) return;
      stageFile.mutate({ repoId, filePath: file });
    },
    [repoId, stageFile],
  );

  const handleRevert = useCallback(
    (file: string) => {
      if (!repoId) return;
      revertFile.mutate({ repoId, filePath: file, baseRef });
    },
    [repoId, baseRef, revertFile],
  );

  if (!repoId) {
    return <div className={styles.placeholder}>Select a repo-level thread to view diffs</div>;
  }

  return (
    <div className={styles.container}>
      <DiffFileList
        files={diffSummary?.files ?? []}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        onStage={handleStage}
        onRevert={handleRevert}
      />

      {selectedFile && fileDiff ? (
        <div className={styles.editorContainer}>
          <div className={styles.editorHeader}>
            <span className={styles.editorFileName}>{selectedFile}</span>
            <span className={styles.editorHint}>Click gutter to add comment</span>
          </div>

          <div className={styles.editor}>
            <DiffEditor
              original={fileDiff.original}
              modified={fileDiff.modified}
              language={getLanguageFromFile(selectedFile)}
              onMount={handleEditorMount}
              options={{
                readOnly: true,
                renderSideBySide: false,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                glyphMargin: true,
                folding: false,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
              theme="vs-dark"
            />
          </div>

          {/* Inline comment form - rendered below the editor at the selected line */}
          {commentLineNumber !== null && (
            <div className={styles.inlineCommentContainer}>
              <div className={styles.inlineCommentLine}>Line {commentLineNumber}</div>
              <InlineComment
                onSubmit={handleCommentSubmit}
                onCancel={() => setCommentLineNumber(null)}
              />
            </div>
          )}

          {/* Inline annotation list below the editor */}
          {fileAnnotations.length > 0 && (
            <div className={styles.annotationList}>
              {fileAnnotations.map((a) => (
                <div key={a.id} className={styles.annotationRow}>
                  <span className={styles.annotationLineRef}>
                    L{a.target_ref.split(':').pop()}
                  </span>
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

function getLanguageFromFile(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
  };
  return map[ext ?? ''] ?? 'plaintext';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
