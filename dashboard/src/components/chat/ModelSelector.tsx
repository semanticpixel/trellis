import styles from './ModelSelector.module.css';

interface ModelSelectorProps {
  provider: string;
  model: string;
  threadId: string;
}

export function ModelSelector({ model }: ModelSelectorProps) {
  // For now, display-only. Full provider/model switching is Phase 4.
  const displayName = getModelDisplayName(model);

  return (
    <div className={styles.selector} title={model}>
      <span className={styles.label}>{displayName}</span>
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
