import { useState, useRef, useEffect } from 'react';
import { useAdapters, useUpdateThreadModel } from '../../hooks/useWorkspaces';
import { ChevronDown } from 'lucide-react';
import styles from './ModelSelector.module.css';

interface ModelSelectorProps {
  provider: string;
  model: string;
  threadId: string;
}

const MODEL_OPTIONS: Record<string, Array<{ id: string; name: string }>> = {
  anthropic: [
    { id: 'claude-opus-4-20250514', name: 'Opus 4' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'o3-mini', name: 'o3-mini' },
  ],
  ollama: [
    { id: 'llama3.1', name: 'Llama 3.1' },
    { id: 'codellama', name: 'Code Llama' },
    { id: 'mistral', name: 'Mistral' },
  ],
};

export function ModelSelector({ provider, model, threadId }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: adapters } = useAdapters();
  const updateModel = useUpdateThreadModel();

  const displayName = getModelDisplayName(model);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleSelect = (newProvider: string, newModel: string) => {
    updateModel.mutate({ threadId, provider: newProvider, model: newModel });
    setOpen(false);
  };

  // Build available options grouped by registered adapters
  const registeredProviders = adapters?.map((a) => a.providerId) ?? [];

  return (
    <div className={styles.wrapper} ref={ref}>
      <button className={styles.selector} onClick={() => setOpen(!open)} title={`${provider}/${model}`}>
        <span className={styles.label}>{displayName}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className={styles.dropdown}>
          {registeredProviders.map((pid) => {
            const adapter = adapters?.find((a) => a.providerId === pid);
            const models = MODEL_OPTIONS[pid] ?? [{ id: 'default', name: pid }];

            return (
              <div key={pid} className={styles.group}>
                <div className={styles.groupLabel}>{adapter?.displayName ?? pid}</div>
                {models.map((m) => (
                  <button
                    key={`${pid}:${m.id}`}
                    className={`${styles.option} ${pid === provider && m.id === model ? styles.optionActive : ''}`}
                    onClick={() => handleSelect(pid, m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            );
          })}

          {registeredProviders.length === 0 && (
            <div className={styles.empty}>No adapters registered. Add an API key in Settings.</div>
          )}
        </div>
      )}
    </div>
  );
}

function getModelDisplayName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('gpt-4o-mini')) return 'GPT-4o Mini';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('o3')) return 'o3-mini';
  return model.split('/').pop()?.split('-').slice(0, 2).join(' ') ?? model;
}
