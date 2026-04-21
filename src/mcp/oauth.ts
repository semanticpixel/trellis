import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * Kinds of per-server OAuth material the main process persists for us.
 * Must stay in sync with the `MCP_OAUTH_KINDS` list + `all` handler in
 * electron/main.mjs.
 */
const SECRET_KINDS = ['tokens', 'client-info', 'code-verifier', 'discovery'] as const;
type SecretKind = (typeof SECRET_KINDS)[number];

export type ExchangeResult = 'success' | 'failed';

/**
 * Sentinel message thrown by `redirectToAuthorization()` when the provider
 * is in quiet mode. Session-init uses quiet providers so that a cold start
 * with no persisted tokens doesn't open a browser tab — the SDK's 401 path
 * triggers redirectToAuthorization(), which throws this, and `startServer`
 * catches it to land the server in a benign "needs authorization" state.
 * Exported as a named const so call sites can match exactly without
 * substring brittleness.
 */
export const TRELLIS_OAUTH_REQUIRED = 'TRELLIS_OAUTH_REQUIRED';

const BRIDGE_FILE = join(homedir(), '.trellis', 'oauth-bridge.json');
const BRIDGE_TIMEOUT_MS = 5000;
const HEADER = 'X-Trellis-OAuth-Secret';

interface BridgeInfo {
  bridgePort: number;
  bridgeSecret: string;
  callbackPort: number;
}

function loadBridgeInfo(): BridgeInfo {
  // Sync read — the bridge file is local state written once on Electron
  // startup. The `redirectUrl` getter on OAuthClientProvider is synchronous
  // by contract, so we can't go async here.
  let raw: string;
  try {
    raw = readFileSync(BRIDGE_FILE, 'utf-8');
  } catch (err) {
    throw new Error(
      `Trellis OAuth bridge not available (could not read ${BRIDGE_FILE}). ` +
        `Make sure the Electron main process is running. Underlying error: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed bridge file at ${BRIDGE_FILE}: ${err instanceof Error ? err.message : err}`);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { bridgePort?: unknown }).bridgePort !== 'number' ||
    typeof (parsed as { bridgeSecret?: unknown }).bridgeSecret !== 'string' ||
    typeof (parsed as { callbackPort?: unknown }).callbackPort !== 'number'
  ) {
    throw new Error(`Bridge file at ${BRIDGE_FILE} is missing required fields`);
  }
  return parsed as BridgeInfo;
}

async function bridgeFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const info = loadBridgeInfo();
  const url = `http://127.0.0.1:${info.bridgePort}${path}`;
  const headers = new Headers(init.headers);
  headers.set(HEADER, info.bridgeSecret);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(
        `Trellis OAuth bridge did not respond within ${BRIDGE_TIMEOUT_MS}ms ` +
          `(127.0.0.1:${info.bridgePort}). Is the Electron main process still running?`,
      );
    }
    throw new Error(
      `Trellis OAuth bridge unreachable at 127.0.0.1:${info.bridgePort}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bridge ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface TrellisOAuthProviderOptions {
  /** Pre-registered OAuth client_id. When set, DCR is skipped. */
  clientId?: string;
  /** Pre-registered client_secret. Only meaningful when clientId is set. */
  clientSecret?: string;
  /** Optional scope string requested during authorization. */
  scope?: string;
  /**
   * When true, `redirectToAuthorization()` throws the `TRELLIS_OAUTH_REQUIRED`
   * sentinel instead of opening a browser tab. Used for transports built
   * during session-init so a cascade of unauthorized HTTP servers can't
   * race to open N browser tabs and collide on the callback port.
   */
  quiet?: boolean;
}

/**
 * MCP OAuth client provider backed by Trellis's Electron-main bridge.
 *
 * Method signatures match `@modelcontextprotocol/sdk`'s
 * {@link OAuthClientProvider} interface: `redirectUrl` and `clientMetadata`
 * are getters (not functions), and `tokens`/`clientInformation` may return
 * undefined when no material is persisted yet.
 */
export class TrellisOAuthProvider implements OAuthClientProvider {
  private readonly options: TrellisOAuthProviderOptions;
  // `redirectToAuthorization` kicks off a bridge call that awaits the
  // browser callback; the caller retrieves the captured code via
  // `waitForAuthorizationCode()` after the initial auth() pass returns REDIRECT.
  private pendingCallback: Promise<string> | null = null;
  // The CSRF state we issued for the active flow. Kept around so
  // `reportExchangeResult()` can tell the bridge which browser session's
  // "Completing authorization…" page to flip to success/failed.
  private pendingState: string | null = null;

  constructor(
    public readonly serverName: string,
    options: TrellisOAuthProviderOptions = {},
  ) {
    this.options = options;
  }

  // ── OAuthClientProvider (getters) ────────────────────────────

  get redirectUrl(): string {
    // Sync by contract (OAuthClientProvider declares `get redirectUrl`).
    // The bridge file is small local JSON — reading it synchronously is
    // fine and much simpler than trying to preload + memoize.
    const info = loadBridgeInfo();
    return `http://127.0.0.1:${info.callbackPort}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Trellis',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    };
  }

  // ── OAuthClientProvider (methods) ────────────────────────────

  state(): string {
    // Fresh PKCE state per auth attempt. Persisted nowhere because the
    // one-shot callback listener compares it in-memory.
    return randomBytes(24).toString('base64url');
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    // Pre-registered shortcut: skip DCR entirely when the user has put a
    // clientId in .mcp.json. This keeps us compatible with servers that
    // don't advertise /register.
    if (this.options.clientId) {
      const info: OAuthClientInformationMixed = { client_id: this.options.clientId };
      if (this.options.clientSecret) info.client_secret = this.options.clientSecret;
      return info;
    }
    const raw = await this.readSecret('client-info');
    if (!raw) return undefined;
    return JSON.parse(raw) as OAuthClientInformationFull;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    // If the caller pre-registered a clientId, DCR shouldn't run — but if
    // the SDK does call us (e.g. a different grant type ever triggers it),
    // don't trample the operator's pinned config by persisting shadow state.
    if (this.options.clientId) return;
    await this.writeSecret('client-info', JSON.stringify(info));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const raw = await this.readSecret('tokens');
    if (!raw) return undefined;
    return JSON.parse(raw) as OAuthTokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.writeSecret('tokens', JSON.stringify(tokens));
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    // Without persistence, the SDK's second `auth()` call (the token-exchange
    // pass in authorizeServer) re-runs RFC 9728 / RFC 8414 discovery, which
    // can return stale or incomplete metadata and silently drop the token
    // exchange. Cache the full state so the second pass reuses the exact
    // endpoints from the first pass.
    await this.writeSecret('discovery', JSON.stringify(state));
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const raw = await this.readSecret('discovery');
    if (!raw) return undefined;
    return JSON.parse(raw) as OAuthDiscoveryState;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.writeSecret('code-verifier', codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const raw = await this.readSecret('code-verifier');
    if (!raw) throw new Error(`No PKCE code verifier persisted for server "${this.serverName}"`);
    return raw;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Quiet mode: refuse to open a browser tab. The SDK calls this when a
    // transport hits a 401 without cached tokens; session-init builds
    // providers in quiet mode so that N unauthorized servers can't race
    // N browser tabs (and collide on the single callback port).
    if (this.options.quiet) {
      throw new Error(TRELLIS_OAUTH_REQUIRED);
    }
    // The authorization URL carries the `state` we issued via state(), so
    // the bridge can validate the callback without additional state.
    const stateParam = authorizationUrl.searchParams.get('state');
    if (!stateParam) {
      throw new Error(
        'Authorization URL is missing `state` — refusing to start flow without CSRF protection',
      );
    }
    this.pendingState = stateParam;
    // Kick the bridge call off; the caller awaits via waitForAuthorizationCode().
    this.pendingCallback = bridgeFetch('/oauth/start-flow', {
      method: 'POST',
      body: JSON.stringify({ authorizationUrl: authorizationUrl.toString(), expectedState: stateParam }),
    }).then((body) => {
      const b = body as { code?: string; state?: string };
      if (!b || typeof b.code !== 'string') {
        throw new Error('OAuth bridge returned no code');
      }
      return b.code;
    });
    // Detach rejection so the unhandled-rejection warning doesn't fire before
    // the caller attaches its `await`.
    this.pendingCallback.catch(() => {});
  }

  /**
   * Await the captured authorization code for the most recent
   * `redirectToAuthorization()` call. Throws if the flow timed out or the
   * bridge returned an error.
   */
  async waitForAuthorizationCode(): Promise<string> {
    if (!this.pendingCallback) {
      throw new Error('waitForAuthorizationCode() called without an active redirectToAuthorization()');
    }
    try {
      return await this.pendingCallback;
    } finally {
      this.pendingCallback = null;
    }
  }

  /**
   * Inform the bridge that the code-for-token exchange finished so the
   * browser's "Completing authorization…" page can flip to the final state.
   * Swallows bridge errors — this is best-effort UX polish, not a hard
   * failure path.
   */
  async reportExchangeResult(result: ExchangeResult, message?: string): Promise<void> {
    const stateParam = this.pendingState;
    this.pendingState = null;
    if (!stateParam) return;
    try {
      await bridgeFetch('/oauth/exchange-complete', {
        method: 'POST',
        body: JSON.stringify({ state: stateParam, result, message: message ?? null }),
      });
    } catch (err) {
      console.warn(
        `[trellis] Failed to notify OAuth bridge of exchange result for "${this.serverName}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    // Map SDK scopes to our persisted kinds. 'all' deletes every per-server
    // key via the bridge shortcut so "Sign out" (and the SDK's repeated-
    // failure recovery path) is one call.
    if (scope === 'all') {
      // Pre-registered client_id lives in config, not in our store — the
      // DELETE /all endpoint only wipes persisted material, so the pinned
      // clientId stays intact.
      await bridgeFetch(`/mcp-oauth/${encodeURIComponent(this.serverName)}/all`, { method: 'DELETE' });
      return;
    }
    const kind: SecretKind =
      scope === 'client'
        ? 'client-info'
        : scope === 'tokens'
          ? 'tokens'
          : scope === 'discovery'
            ? 'discovery'
            : 'code-verifier';
    if (kind === 'client-info' && this.options.clientId) return; // see saveClientInformation note
    await this.deleteSecret(kind);
  }

  // ── Bridge helpers ───────────────────────────────────────────

  private async readSecret(kind: SecretKind): Promise<string | null> {
    const body = (await bridgeFetch(
      `/mcp-oauth/${encodeURIComponent(this.serverName)}/${kind}`,
    )) as { value: string | null };
    return body.value;
  }

  private async writeSecret(kind: SecretKind, value: string): Promise<void> {
    await bridgeFetch(`/mcp-oauth/${encodeURIComponent(this.serverName)}/${kind}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }

  private async deleteSecret(kind: SecretKind): Promise<void> {
    await bridgeFetch(`/mcp-oauth/${encodeURIComponent(this.serverName)}/${kind}`, {
      method: 'DELETE',
    });
  }
}

// Exposed so tests can point the provider at a fake bridge without touching
// ~/.trellis. Production code should not use this.
export const __testing = {
  BRIDGE_FILE,
  BRIDGE_TIMEOUT_MS,
  HEADER,
};
