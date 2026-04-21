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
  useMcpServers,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
  useReloadMcpServer,
  useReloadAllMcp,
  useClaudeCodeCandidates,
  useImportMcpServers,
  type McpServerInfo,
  type McpServerConfigInput,
  type McpTransport,
} from '../../hooks/useWorkspaces';
import { usePersistedSetting } from '../../hooks/usePersistedSetting';
import { ColorPicker } from '../sidebar/ColorPicker';
import { X, Trash2, Pencil, Plus, Check, Keyboard, RefreshCw, Download, Server, AlertCircle } from 'lucide-react';
import type { Provider, ProviderType } from '@shared/types';
import styles from './SettingsOverlay.module.css';

interface SettingsOverlayProps {
  onClose: () => void;
  onOpenShortcutReference: () => void;
}

type SettingsTab = 'providers' | 'mcp' | 'workspaces' | 'appearance';

export function SettingsOverlay({ onClose, onOpenShortcutReference }: SettingsOverlayProps) {
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
            className={activeTab === 'mcp' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('mcp')}
          >
            MCP
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
          {activeTab === 'mcp' && <McpTab />}
          {activeTab === 'workspaces' && <WorkspacesTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
        </div>

        <div className={styles.footer}>
          <button className={styles.footerBtn} onClick={onOpenShortcutReference}>
            <Keyboard size={14} /> Keyboard shortcuts
          </button>
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

// ── MCP Tab ────────────────────────────────────────────────────

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

function McpTab() {
  // Mirrors App.tsx's persisted selection so live status lines up with the
  // workspace the user is actually focused on.
  const [workspaceId] = usePersistedSetting<string | null>(
    'session.activeWorkspaceId',
    null,
    isNullableString,
  );
  const { data: workspaces } = useWorkspaces();
  const { data: servers, isLoading } = useMcpServers(workspaceId);
  const { data: candidates } = useClaudeCodeCandidates();
  const reloadAll = useReloadAllMcp();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const workspace = workspaces?.find((w) => w.id === workspaceId);
  const hasCandidates = (candidates?.length ?? 0) > 0;

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.mcpHeader}>
          <div>
            <div className={styles.sectionTitle}>Model Context Protocol servers</div>
            <p className={styles.mcpHint}>
              Configured in <code>~/.trellis/mcp.json</code> (user) or <code>&lt;workspace&gt;/.mcp.json</code> (project).
              Tools are exposed as <code>mcp__&lt;server&gt;__&lt;tool&gt;</code>.
              {workspace && (
                <> Live status is for <strong>{workspace.name}</strong>.</>
              )}
              {!workspace && <> Select a workspace in the sidebar to see live status.</>}
            </p>
          </div>
          {workspaceId && (
            <button
              className={styles.btnSecondary}
              onClick={() => reloadAll.mutate(workspaceId)}
              disabled={reloadAll.isPending}
              title="Reload all MCP servers for this workspace"
            >
              <RefreshCw size={12} /> Reload all
            </button>
          )}
        </div>

        {hasCandidates && !showImport && (
          <button className={styles.mcpImportBanner} onClick={() => setShowImport(true)}>
            <Download size={14} />
            <span>
              Found Claude Code MCP config — import {countServers(candidates ?? [])} server(s)
            </span>
          </button>
        )}

        {showImport && candidates && (
          <McpImportPanel candidates={candidates} onDone={() => setShowImport(false)} />
        )}

        {isLoading && <p className={styles.mcpHint}>Loading…</p>}

        {servers?.map((s) =>
          editing === s.name ? (
            <McpServerForm
              key={s.name}
              server={s}
              onDone={() => setEditing(null)}
            />
          ) : (
            <McpServerCard
              key={s.name}
              server={s}
              workspaceId={workspaceId}
              onEdit={() => setEditing(s.name)}
            />
          ),
        )}

        {servers?.length === 0 && !showAdd && (
          <p className={styles.mcpHint}>
            No MCP servers configured. Add one below — commands like <code>npx</code>,{' '}
            <code>uvx</code>, or a custom binary all work.
          </p>
        )}

        {showAdd ? (
          <McpServerForm onDone={() => setShowAdd(false)} />
        ) : (
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add MCP server
          </button>
        )}
      </div>
    </div>
  );
}

function countServers(candidates: { servers: Record<string, unknown> }[]): number {
  const names = new Set<string>();
  for (const c of candidates) for (const name of Object.keys(c.servers)) names.add(name);
  return names.size;
}

function McpServerCard({
  server,
  workspaceId,
  onEdit,
}: {
  server: McpServerInfo;
  workspaceId: string | null;
  onEdit: () => void;
}) {
  const deleteServer = useDeleteMcpServer();
  const reload = useReloadMcpServer();
  const [showLogs, setShowLogs] = useState(false);

  const stateLabel = describeState(server);
  const canDelete = server.source === 'user';
  const canReload = !!workspaceId;

  return (
    <div className={styles.mcpCard}>
      <div className={styles.mcpCardTop}>
        <div className={styles.mcpName}>
          <Server size={13} /> {server.name}
          <span className={stateBadgeClass(server.state)}>{stateLabel}</span>
          <span className={styles.mcpSource}>{server.source}</span>
        </div>
        <div className={styles.providerActions}>
          {canReload && (
            <button
              className={styles.iconBtn}
              onClick={() => reload.mutate({ name: server.name, workspaceId: workspaceId! })}
              disabled={reload.isPending}
              title="Reload server"
            >
              <RefreshCw size={14} />
            </button>
          )}
          <button className={styles.iconBtn} onClick={onEdit} title="Edit" disabled={!canDelete}>
            <Pencil size={14} />
          </button>
          {canDelete && (
            <button
              className={styles.dangerBtn}
              onClick={() => {
                if (confirm(`Remove MCP server "${server.name}"?`)) {
                  deleteServer.mutate(server.name);
                }
              }}
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.mcpMeta}>
        {server.transport === 'stdio' ? (
          <code>
            {server.command ?? ''}
            {server.args.length > 0 ? ` ${server.args.join(' ')}` : ''}
          </code>
        ) : (
          <code>
            {server.transport.toUpperCase()} · {server.url ?? ''}
          </code>
        )}
      </div>
      {server.state === 'ready' && (
        <div className={styles.mcpMeta}>
          {server.toolCount} tool{server.toolCount === 1 ? '' : 's'}
          {server.transport === 'stdio' && server.pid !== null ? ` • pid ${server.pid}` : ''}
        </div>
      )}
      {server.error && (
        <div className={styles.mcpError}>
          <AlertCircle size={12} /> {server.error}
        </div>
      )}
      {server.transport === 'stdio' && (server.stderrTail.length > 0 || server.error) && (
        <button
          className={styles.mcpLogToggle}
          onClick={() => setShowLogs((v) => !v)}
        >
          {showLogs ? 'Hide' : 'Show'} server stderr ({server.stderrTail.length})
        </button>
      )}
      {server.transport === 'stdio' && showLogs && server.stderrTail.length > 0 && (
        <pre className={styles.mcpLogs}>{server.stderrTail.join('\n')}</pre>
      )}
    </div>
  );
}

function stateBadgeClass(state: McpServerInfo['state']): string {
  switch (state) {
    case 'ready':
      return styles.mcpStateReady;
    case 'error':
      return styles.mcpStateError;
    case 'starting':
      return styles.mcpStateStarting;
    default:
      return styles.mcpStateIdle;
  }
}

function describeState(server: McpServerInfo): string {
  switch (server.state) {
    case 'ready':
      return 'ready';
    case 'starting':
      return 'starting';
    case 'error':
      return 'error';
    case 'stopped':
      return 'stopped';
    default:
      return 'not started';
  }
}

function McpServerForm({ server, onDone }: { server?: McpServerInfo; onDone: () => void }) {
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();

  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? '');
  const [argsText, setArgsText] = useState(server ? server.args.join(' ') : '');
  const [envText, setEnvText] = useState(
    server ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  );
  const [url, setUrl] = useState(server?.url ?? '');
  const [headersText, setHeadersText] = useState(
    server ? Object.entries(server.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
  );

  const handleSubmit = () => {
    if (!name.trim()) return;
    let config: McpServerConfigInput;
    if (transport === 'stdio') {
      if (!command.trim()) return;
      config = {
        type: 'stdio',
        command: command.trim(),
        args: splitArgs(argsText),
        env: parseEnvLines(envText),
      };
    } else {
      if (!url.trim()) return;
      config = {
        type: transport,
        url: url.trim(),
        headers: parseHeaderLines(headersText),
      };
    }
    if (server) {
      updateServer.mutate({ name: server.name, config }, { onSuccess: onDone });
    } else {
      createServer.mutate({ name: name.trim(), config }, { onSuccess: onDone });
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
          placeholder="e.g. atlassian"
          disabled={!!server}
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.label}>Transport</label>
        <select
          className={styles.select}
          value={transport}
          onChange={(e) => setTransport(e.target.value as McpTransport)}
        >
          <option value="stdio">stdio (local command)</option>
          <option value="http">http (Streamable HTTP)</option>
          <option value="sse">sse (Server-Sent Events, legacy)</option>
        </select>
      </div>
      {transport === 'stdio' ? (
        <>
          <div className={styles.formRow}>
            <label className={styles.label}>Command</label>
            <input
              className={styles.input}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. npx"
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>Arguments</label>
            <input
              className={styles.input}
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder='e.g. -y @org/mcp-server "--flag value"'
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>Environment (KEY=value per line)</label>
            <textarea
              className={styles.textarea}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="API_TOKEN=sk-..."
              rows={3}
            />
          </div>
        </>
      ) : (
        <>
          <div className={styles.formRow}>
            <label className={styles.label}>URL</label>
            <input
              className={styles.input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/v1"
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>Headers (Key: value per line — use ${'${env:VAR}'} for secrets)</label>
            <textarea
              className={styles.textarea}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder={'Authorization: Bearer ${env:CONTEXT7_TOKEN}'}
              rows={3}
            />
          </div>
        </>
      )}
      <div className={styles.formActions}>
        <button className={styles.btnSecondary} onClick={onDone}>Cancel</button>
        <button className={styles.btnPrimary} onClick={handleSubmit}>
          {server ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function McpImportPanel({
  candidates,
  onDone,
}: {
  candidates: Array<{ source: string; servers: Record<string, McpServerConfigInput> }>;
  onDone: () => void;
}) {
  const importMutation = useImportMcpServers();
  const allServers = new Map<string, McpServerConfigInput>();
  for (const c of candidates) {
    for (const [name, cfg] of Object.entries(c.servers)) {
      if (!allServers.has(name)) allServers.set(name, cfg);
    }
  }
  const [selected, setSelected] = useState<Set<string>>(new Set(allServers.keys()));

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleImport = () => {
    const subset: Record<string, McpServerConfigInput> = {};
    for (const name of selected) {
      const cfg = allServers.get(name);
      if (cfg) subset[name] = cfg;
    }
    importMutation.mutate(
      { servers: subset, overwrite: false },
      { onSuccess: onDone },
    );
  };

  return (
    <div className={styles.form}>
      <div className={styles.label}>Import from Claude Code config</div>
      <p className={styles.mcpHint}>
        Discovered {allServers.size} server(s) across {candidates.length} file(s). Existing entries in your
        Trellis config won't be overwritten.
      </p>
      {[...allServers.entries()].map(([name, cfg]) => (
        <label key={name} className={styles.mcpImportRow}>
          <input
            type="checkbox"
            checked={selected.has(name)}
            onChange={() => toggle(name)}
          />
          <div>
            <div className={styles.mcpName}>{name}</div>
            <div className={styles.mcpMeta}>
              <code>{describeCandidate(cfg)}</code>
            </div>
          </div>
        </label>
      ))}
      <div className={styles.formActions}>
        <button className={styles.btnSecondary} onClick={onDone}>Cancel</button>
        <button
          className={styles.btnPrimary}
          onClick={handleImport}
          disabled={selected.size === 0 || importMutation.isPending}
        >
          Import {selected.size} server{selected.size === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

function describeCandidate(cfg: McpServerConfigInput): string {
  if ('url' in cfg) {
    return `${cfg.type.toUpperCase()} · ${cfg.url}`;
  }
  return `${cfg.command}${cfg.args?.length ? ` ${cfg.args.join(' ')}` : ''}`;
}

// Simple whitespace split that respects double-quoted segments — enough for
// the common npx / uvx invocations users paste from Claude Code configs.
function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ?? m[2] ?? '');
  }
  return out;
}

function parseEnvLines(input: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

function parseHeaderLines(input: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}
