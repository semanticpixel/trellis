import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace fs's synchronous reader so the provider can see a fake bridge file
// without touching the real ~/.trellis/oauth-bridge.json.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: vi.fn() };
});

import { readFileSync } from 'fs';
import { TrellisOAuthProvider } from './oauth.js';

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

  it("invalidateCredentials('discovery') is a no-op (we don't persist discovery state)", async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('fetch should not be called for discovery scope');
    });
    const provider = new TrellisOAuthProvider('glean');
    await provider.invalidateCredentials('discovery');
    expect(fetchMock).not.toHaveBeenCalled();
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
});
