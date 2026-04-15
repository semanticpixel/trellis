import { useState, useRef } from 'react';
import { useCreateWorkspace } from '../../hooks/useWorkspaces';
import { ColorPicker } from './ColorPicker';
import { X } from 'lucide-react';
import styles from './AddWorkspaceModal.module.css';

interface AddWorkspaceModalProps {
  onClose: () => void;
}

export function AddWorkspaceModal({ onClose }: AddWorkspaceModalProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [color, setColor] = useState('#6e7681');
  const [error, setError] = useState('');
  const createWorkspace = useCreateWorkspace();
  const dirInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError('Name and path are required');
      return;
    }
    createWorkspace.mutate(
      { name: name.trim(), path: path.trim(), color },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>Add Workspace</h3>
          <button className={styles.close} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Name
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. w0"
              autoFocus
            />
          </label>

          <label className={styles.label}>
            Path
            <div className={styles.pathRow}>
              <input
                className={styles.input}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="e.g. ~/workspace/project/w0"
              />
              <button
                type="button"
                className={styles.browseBtn}
                onClick={async () => {
                  if (window.api?.dialog) {
                    const selected = await window.api.dialog.openDirectory();
                    if (selected) {
                      setPath(selected);
                      if (!name.trim()) {
                        setName(selected.split('/').pop() ?? '');
                      }
                    }
                  } else {
                    dirInputRef.current?.click();
                  }
                }}
              >
                Browse
              </button>
              <input
                ref={dirInputRef}
                type="file"
                // @ts-expect-error -- webkitdirectory is not in React's input type defs
                webkitdirectory=""
                className={styles.hiddenInput}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    // webkitRelativePath gives "dirName/file" — extract the dir name
                    const relPath = file.webkitRelativePath;
                    const dirName = relPath.split('/')[0] ?? '';
                    if (dirName) {
                      setPath(dirName);
                      if (!name.trim()) {
                        setName(dirName);
                      }
                    }
                  }
                  // Reset so the same folder can be re-selected
                  e.target.value = '';
                }}
              />
            </div>
          </label>

          <label className={styles.label}>
            Color
            <ColorPicker value={color} onChange={setColor} />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={createWorkspace.isPending}
            >
              {createWorkspace.isPending ? 'Adding...' : 'Add workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
