import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace fs's synchronous reader so the provider can see a fake bridge file
// without touching the real ~/.trellis/oauth-bridge.json.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: vi.fn() };
});

import { readFileSync } from 'fs';
import { TrellisOAuthProvider, TRELLIS_OAUTH_REQUIRED } from './oauth.js';

const BRIDGE = { bridgePort: 55555, bridgeSecret: 'test-secret', callbackPort: 33418 };
const mockedReadFileSync = vi.mocked(readFileSync);

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
    return handler(String(url), (init ?? {}) as RequestInit);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  mockedReadFileSync.mockReturnValue(JSON.stringify(BRIDGE));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TrellisOAuthProvider', () => {
  it('redirectUrl reflects the callbackPort from the bridge file', () => {
    const provider = new TrellisOAuthProvider('glean');
    expect(provider.redirectUrl).toBe('http://127.0.0.1:33418/callback');
  });

  it('clientMetadata includes scope when configured and our redirect URI', () => {
    const provider = new TrellisOAuthProvider('glean', { scope: 'read write' });
    expect(provider.clientMetadata).toMatchObject({
      client_name: 'Trellis',
      redirect_uris: ['http://127.0.0.1:33418/callback'],
      scope: 'read write',
      grant_types: ['authorization_code', 'refresh_token'],
    });
  });

  it('pre-registered clientId short-circuits clientInformation (no bridge call)', async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('fetch should not be called for pre-registered client');
    });
    const provider = new TrellisOAuthProvider('glean', {
      clientId: 'pinned-id',
      clientSecret: 'pinned-secret',
    });
    const info = await provider.clientInformation();
    expect(info).toEqual({ client_id: 'pinned-id', client_secret: 'pinned-secret' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saveClientInformation is a no-op when clientId is pre-registered', async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('fetch should not be called');
    });
    const provider = new TrellisOAuthProvider('glean', { clientId: 'pinned' });
    await provider.saveClientInformation({ client_id: 'whatever' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clientInformation without pre-registration loads the persisted blob via the bridge', async () => {
    const stored = { client_id: 'registered', client_secret: 'abc', redirect_uris: ['http://127.0.0.1:33418/callback'] };
    const fetchMock = stubFetch((url) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/client-info');
      return jsonResponse(200, { value: JSON.stringify(stored) });
    });
    const provider = new TrellisOAuthProvider('glean');
    const info = await provider.clientInformation();
    expect(info).toEqual(stored);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toBeDefined();
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-Trellis-OAuth-Secret')).toBe(BRIDGE.bridgeSecret);
  });

  it('saveTokens sends PUT with the bridge secret header and JSON body', async () => {
    const tokens = { access_token: 'ya29.abc', token_type: 'Bearer', expires_in: 3600 };
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/tokens');
      expect(init.method).toBe('PUT');
      const headers = new Headers(init.headers);
      expect(headers.get('X-Trellis-OAuth-Secret')).toBe(BRIDGE.bridgeSecret);
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(String(init.body))).toEqual({ value: JSON.stringify(tokens) });
      return jsonResponse(200, { ok: true });
    });
    const provider = new TrellisOAuthProvider('glean');
    await provider.saveTokens(tokens);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateCredentials('all') wipes every kind via the /all shortcut", async () => {
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/all');
      expect(init.method).toBe('DELETE');
      return jsonResponse(200, { ok: true });
    });
    const provider = new TrellisOAuthProvider('glean');
    await provider.invalidateCredentials('all');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateCredentials('tokens') only deletes the tokens entry", async () => {
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/tokens');
      expect(init.method).toBe('DELETE');
      return jsonResponse(200, { ok: true });
    });
    const provider = new TrellisOAuthProvider('glean');
    await provider.invalidateCredentials('tokens');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateCredentials('client') is a no-op when clientId is pre-registered", async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('fetch should not be called when clientId is pinned');
    });
    const provider = new TrellisOAuthProvider('glean', { clientId: 'pinned' });
    await provider.invalidateCredentials('client');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidateCredentials('discovery') deletes the persisted discovery blob", async () => {
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/discovery');
      expect(init.method).toBe('DELETE');
      return jsonResponse(200, { ok: true });
    });
    const provider = new TrellisOAuthProvider('glean');
    await provider.invalidateCredentials('discovery');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('saveDiscoveryState persists the blob via the bridge PUT endpoint', async () => {
    const state = {
      authorizationServerUrl: 'https://auth.example/',
      authorizationServerMetadata: {
        issuer: 'https://auth.example/',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        response_types_supported: ['code'],
      },
    };
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/discovery');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(String(init.body))).toEqual({ value: JSON.stringify(state) });
      return jsonResponse(200, { ok: true });
    });
    const provider = new TrellisOAuthProvider('glean');
    // SDK's AuthorizationServerMetadata has many required fields we don't need
    // to exercise here; cast through unknown to keep the fixture small.
    await provider.saveDiscoveryState(
      state as unknown as Parameters<typeof provider.saveDiscoveryState>[0],
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discoveryState parses the persisted JSON blob from the bridge', async () => {
    const cached = {
      authorizationServerUrl: 'https://auth.example/',
      authorizationServerMetadata: {
        issuer: 'https://auth.example/',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        response_types_supported: ['code'],
      },
    };
    stubFetch((url) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/discovery');
      return jsonResponse(200, { value: JSON.stringify(cached) });
    });
    const provider = new TrellisOAuthProvider('glean');
    await expect(provider.discoveryState()).resolves.toEqual(cached);
  });

  it('discoveryState returns undefined when nothing is persisted', async () => {
    stubFetch(() => jsonResponse(200, { value: null }));
    const provider = new TrellisOAuthProvider('glean');
    await expect(provider.discoveryState()).resolves.toBeUndefined();
  });

  it('reportExchangeResult posts the outcome to /oauth/exchange-complete using the tracked state', async () => {
    const flowState = 'csrf-state-for-exchange';
    const calls: Array<{ url: string; init: RequestInit }> = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth/start-flow')) {
        return jsonResponse(200, { code: 'auth-code', state: flowState });
      }
      if (url.endsWith('/oauth/exchange-complete')) {
        return jsonResponse(200, { ok: true });
      }
      throw new Error(`unexpected call: ${url}`);
    });
    const provider = new TrellisOAuthProvider('glean');
    await provider.redirectToAuthorization(
      new URL(`https://auth.example/authorize?state=${flowState}&client_id=x`),
    );
    await provider.waitForAuthorizationCode();
    await provider.reportExchangeResult('failed', 'invalid_grant');

    const exchangeCall = calls.find((c) => c.url.endsWith('/oauth/exchange-complete'));
    expect(exchangeCall).toBeDefined();
    expect(exchangeCall!.init.method).toBe('POST');
    expect(JSON.parse(String(exchangeCall!.init.body))).toEqual({
      state: flowState,
      result: 'failed',
      message: 'invalid_grant',
    });
  });

  it('reportExchangeResult is a no-op when no flow is pending', async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('fetch should not be called without a pending flow');
    });
    const provider = new TrellisOAuthProvider('glean');
    await provider.reportExchangeResult('success');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reportExchangeResult swallows bridge errors so UX polish never fails the flow', async () => {
    const flowState = 'csrf-state-swallow';
    stubFetch((url) => {
      if (url.endsWith('/oauth/start-flow')) {
        return jsonResponse(200, { code: 'auth-code', state: flowState });
      }
      return jsonResponse(500, { error: 'bridge exploded' });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new TrellisOAuthProvider('glean');
    await provider.redirectToAuthorization(
      new URL(`https://auth.example/authorize?state=${flowState}&client_id=x`),
    );
    await provider.waitForAuthorizationCode();
    await expect(provider.reportExchangeResult('success')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('surfaces a clear error when the bridge hangs past the 5s timeout', async () => {
    // AbortSignal.timeout rejects with an AbortError/TimeoutError when fetch's
    // signal fires. Emulate it by throwing a DOMException with name TimeoutError.
    stubFetch(() => {
      const err = new Error('timed out') as Error & { name: string };
      err.name = 'TimeoutError';
      throw err;
    });
    const provider = new TrellisOAuthProvider('glean');
    await expect(provider.tokens()).rejects.toThrow(/did not respond within 5000ms/);
  });

  it('surfaces a bridge-unreachable error when reading the bridge file fails', async () => {
    mockedReadFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const provider = new TrellisOAuthProvider('glean');
    await expect(provider.tokens()).rejects.toThrow(/Trellis OAuth bridge not available/);
  });

  it('redirectToAuthorization stages the browser call and waitForAuthorizationCode returns the code', async () => {
    const stateValue = 'csrf-state-abc';
    stubFetch((url, init) => {
      expect(url).toBe('http://127.0.0.1:55555/oauth/start-flow');
      expect(init.method).toBe('POST');
      const body = JSON.parse(String(init.body)) as { authorizationUrl: string; expectedState: string };
      expect(body.expectedState).toBe(stateValue);
      return jsonResponse(200, { code: 'auth-code-xyz', state: stateValue });
    });
    const provider = new TrellisOAuthProvider('glean');
    const authUrl = new URL(`https://auth.example/authorize?state=${stateValue}&client_id=x`);
    await provider.redirectToAuthorization(authUrl);
    await expect(provider.waitForAuthorizationCode()).resolves.toBe('auth-code-xyz');
  });

  it('redirectToAuthorization refuses URLs without a state parameter', async () => {
    const provider = new TrellisOAuthProvider('glean');
    const authUrl = new URL('https://auth.example/authorize?client_id=x');
    await expect(provider.redirectToAuthorization(authUrl)).rejects.toThrow(/missing `state`/);
  });

  it('quiet mode throws TRELLIS_OAUTH_REQUIRED and never posts to /oauth/start-flow', async () => {
    // Session-init builds providers in quiet mode. The SDK's 401 recovery
    // path calls redirectToAuthorization; quiet mode must refuse, so
    // unauthorized servers land in a benign "needs authorization" state
    // instead of each opening its own browser tab (and racing on port 33418).
    const fetchMock = stubFetch(() => {
      throw new Error('fetch should not be called in quiet mode');
    });
    const provider = new TrellisOAuthProvider('glean', { quiet: true });
    const authUrl = new URL('https://auth.example/authorize?state=s&client_id=x');
    await expect(provider.redirectToAuthorization(authUrl)).rejects.toThrow(
      TRELLIS_OAUTH_REQUIRED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('quiet mode still permits token/client reads via the bridge', async () => {
    // Only redirectToAuthorization is suppressed. Transports still need to
    // read persisted tokens and (pre-registered) client info via the
    // bridge so an already-authorized server reconnects cleanly.
    const tokens = { access_token: 'cached-token', token_type: 'Bearer', expires_in: 3600 };
    const fetchMock = stubFetch((url) => {
      expect(url).toBe('http://127.0.0.1:55555/mcp-oauth/glean/tokens');
      return jsonResponse(200, { value: JSON.stringify(tokens) });
    });
    const provider = new TrellisOAuthProvider('glean', { quiet: true });
    await expect(provider.tokens()).resolves.toEqual(tokens);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
