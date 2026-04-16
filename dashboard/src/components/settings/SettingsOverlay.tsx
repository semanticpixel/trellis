import { useState, useCallback, useEffect } from 'react';
import {
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useWorkspaces,
  useUpdateWorkspace,
  useDeleteWorkspace,
  useSetting,
  useSetSetting,
} from '../../hooks/useWorkspaces';
import { ColorPicker } from '../sidebar/ColorPicker';
import { X, Trash2, Pencil, Plus, Check } from 'lucide-react';
import type { Provider, ProviderType } from '@shared/types';
import styles from './SettingsOverlay.module.css';

interface SettingsOverlayProps {
  onClose: () => void;
}

type SettingsTab = 'providers' | 'workspaces' | 'appearance';

export function SettingsOverlay({ onClose }: SettingsOverlayProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.close} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={activeTab === 'providers' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('providers')}
          >
            Providers
          </button>
          <button
            className={activeTab === 'workspaces' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('workspaces')}
          >
            Workspaces
          </button>
          <button
            className={activeTab === 'appearance' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('appearance')}
          >
            Appearance
          </button>
        </div>

        <div className={styles.body}>
          {activeTab === 'providers' && <ProvidersTab />}
          {activeTab === 'workspaces' && <WorkspacesTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
        </div>
      </div>
    </div>
  );
}

// ── Providers Tab ──────────────────────────────────────────────

function ProvidersTab() {
  const { data: providers } = useProviders();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Configured Providers</div>

        {providers?.map((p) =>
          editingId === p.id ? (
            <ProviderForm
              key={p.id}
              provider={p}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <ProviderCard
              key={p.id}
              provider={p}
              onEdit={() => setEditingId(p.id)}
            />
          ),
        )}

        {providers?.length === 0 && !showAdd && (
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: 'var(--space-md)' }}>
            No providers configured. Add one to get started.
          </p>
        )}

        {showAdd ? (
          <ProviderForm onDone={() => setShowAdd(false)} />
        ) : (
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add provider
          </button>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>API Keys</div>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
          Keys are encrypted via your OS keychain (safeStorage). They are never stored in the database.
        </p>
        <ApiKeyManager providerType="anthropic" label="Anthropic" />
        <ApiKeyManager providerType="openai" label="OpenAI" />
      </div>
    </div>
  );
}

function ProviderCard({ provider, onEdit }: { provider: Provider; onEdit: () => void }) {
  const deleteProvider = useDeleteProvider();

  return (
    <div className={styles.providerCard}>
      <div className={styles.providerInfo}>
        <div className={styles.providerName}>{provider.name}</div>
        <div className={styles.providerType}>
          {provider.type}
          {provider.base_url ? ` \u2022 ${provider.base_url}` : ''}
          {provider.default_model ? ` \u2022 ${provider.default_model}` : ''}
        </div>
      </div>
      <div className={styles.providerActions}>
        <button className={styles.iconBtn} onClick={onEdit} title="Edit">
          <Pencil size={14} />
        </button>
        <button
          className={styles.dangerBtn}
          onClick={() => deleteProvider.mutate(provider.id)}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ProviderForm({ provider, onDone }: { provider?: Provider; onDone: () => void }) {
  const [name, setName] = useState(provider?.name ?? '');
  const [type, setType] = useState<ProviderType>(provider?.type ?? 'anthropic');
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '');
  const [defaultModel, setDefaultModel] = useState(provider?.default_model ?? '');
  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (provider) {
      updateProvider.mutate(
        { id: provider.id, name, base_url: baseUrl || undefined, default_model: defaultModel || undefined },
        { onSuccess: onDone },
      );
    } else {
      createProvider.mutate(
        { name, type, base_url: baseUrl || undefined, default_model: defaultModel || undefined },
        { onSuccess: onDone },
      );
    }
  };

  return (
    <div className={styles.form}>
      <div className={styles.formRow}>
        <label className={styles.label}>Name</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My Ollama"
        />
      </div>
      {!provider && (
        <div className={styles.formRow}>
          <label className={styles.label}>Type</label>
          <select className={styles.select} value={type} onChange={(e) => setType(e.target.value as ProviderType)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
          </select>
        </div>
      )}
      {(type === 'ollama' || type === 'custom') && (
        <div className={styles.formRow}>
          <label className={styles.label}>Base URL</label>
          <input
            className={styles.input}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={type === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
          />
        </div>
      )}
      <div className={styles.formRow}>
        <label className={styles.label}>Default Model</label>
        <input
          className={styles.input}
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder="e.g. llama3.1, gpt-4o"
        />
      </div>
      <div className={styles.formActions}>
        <button className={styles.btnSecondary} onClick={onDone}>Cancel</button>
        <button className={styles.btnPrimary} onClick={handleSubmit}>
          {provider ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function ApiKeyManager({ providerType, label }: { providerType: string; label: string }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [keyValue, setKeyValue] = useState('');

  useEffect(() => {
    // Check if key exists via preload bridge
    const api = (window as unknown as { api?: { keys?: { has: (name: string) => Promise<string | null> } } }).api;
    if (api?.keys?.has) {
      api.keys.has(providerType).then((result) => setHasKey(!!result));
    } else {
      // Outside Electron, check env
      setHasKey(null);
    }
  }, [providerType]);

  const handleSave = async () => {
    const key = keyValue.trim();
    if (!key) return;

    // Store in OS keychain via safeStorage (if in Electron)
    const api = (window as unknown as { api?: { keys?: { store: (name: string, value: string) => Promise<void> } } }).api;
    if (api?.keys?.store) {
      await api.keys.store(providerType, key);
    }

    // Register the adapter on the backend so it's usable immediately
    await fetch('/api/adapters/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: providerType, apiKey: key }),
    });

    setHasKey(true);
    setEditing(false);
    setKeyValue('');
  };

  const handleDelete = async () => {
    const api = (window as unknown as { api?: { keys?: { delete: (name: string) => Promise<void> } } }).api;
    if (api?.keys?.delete) {
      await api.keys.delete(providerType);
      setHasKey(false);
    }
  };

  if (editing) {
    return (
      <div className={styles.form}>
        <div className={styles.formRow}>
          <label className={styles.label}>{label} API Key</label>
          <input
            className={styles.input}
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder={`Enter ${label} API key`}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          />
        </div>
        <div className={styles.formActions}>
          <button className={styles.btnSecondary} onClick={() => setEditing(false)}>Cancel</button>
          <button className={styles.btnPrimary} onClick={handleSave}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.providerCard}>
      <div className={styles.providerInfo}>
        <div className={styles.providerName}>{label}</div>
        <div className={styles.keyStatus}>
          {hasKey ? (
            <span className={styles.keySet}><Check size={12} /> Key configured</span>
          ) : hasKey === false ? (
            <span className={styles.keyMissing}>No key set</span>
          ) : (
            <span className={styles.keyMissing}>Using environment variable</span>
          )}
        </div>
      </div>
      <div className={styles.providerActions}>
        <button className={styles.iconBtn} onClick={() => setEditing(true)} title="Set key">
          <Pencil size={14} />
        </button>
        {hasKey && (
          <button className={styles.dangerBtn} onClick={handleDelete} title="Remove key">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Workspaces Tab ─────────────────────────────────────────────

function WorkspacesTab() {
  const { data: workspaces } = useWorkspaces();
  const updateWorkspace = useUpdateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const [editingColor, setEditingColor] = useState<string | null>(null);

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Workspaces</div>

        {workspaces?.map((ws) => (
          <div key={ws.id} className={styles.workspaceRow}>
            <div style={{ position: 'relative' }}>
              <div
                className={styles.workspaceColor}
                style={{ backgroundColor: ws.color }}
                onClick={() => setEditingColor(editingColor === ws.id ? null : ws.id)}
              />
              {editingColor === ws.id && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10 }}>
                  <ColorPicker
                    value={ws.color}
                    onChange={(color) => {
                      updateWorkspace.mutate({ id: ws.id, color });
                      setEditingColor(null);
                    }}
                  />
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div className={styles.workspaceName}>{ws.name}</div>
              <div className={styles.workspacePath}>{ws.path}</div>
            </div>
            <button
              className={styles.dangerBtn}
              onClick={() => {
                if (confirm(`Remove workspace "${ws.name}"? Thread history will be deleted.`)) {
                  deleteWorkspace.mutate(ws.id);
                }
              }}
              title="Remove workspace"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {(!workspaces || workspaces.length === 0) && (
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
            No workspaces. Add one from the sidebar.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Appearance Tab ─────────────────────────────────────────────

function AppearanceTab() {
  const { data: themeSetting } = useSetting('theme');
  const setSetting = useSetSetting();
  const currentTheme = themeSetting?.value ?? 'system';

  const handleThemeChange = useCallback((theme: string) => {
    setSetting.mutate({ key: 'theme', value: theme });
    applyTheme(theme);
  }, [setSetting]);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Theme</div>
        <div className={styles.themeGroup}>
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              className={currentTheme === t ? styles.themeOptionActive : styles.themeOption}
              onClick={() => handleThemeChange(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function applyTheme(theme: string): void {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  }
  // 'system' means use prefers-color-scheme (no override)
}
