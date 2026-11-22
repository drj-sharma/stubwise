/// <reference types="jest" />
import { ApiClient, ApiError, CONFLICT_MESSAGE, OFFLINE_MESSAGE, SIGNED_OUT_MESSAGE, TIMEOUT_MESSAGE, type TokenStore, errorMessage } from './client';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  const store = {
    value: initial,
    getRefreshToken: async () => store.value,
    setRefreshToken: async (token: string) => {
      store.value = token;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

function setup(handler: Handler, refreshToken: string | null = 'refresh-1', timeoutMs?: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const store = memoryStore(refreshToken);
  const client = new ApiClient({
    baseUrl: 'http://api.test/',
    store,
    timeoutMs,
    fetch: (async (input: string, init: RequestInit) => {
      calls.push({ url: input, init });
      return handler(input, init);
    }) as unknown as typeof fetch,
  });
  const signedOut = jest.fn();
  client.onSignedOut(signedOut);
  return { client, store, calls, signedOut };
}

const header = (init: RequestInit, name: string): string | undefined => (init.headers as Record<string, string>)[name];

const pair = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, user: { id: 'u' } });

describe('ApiClient', () => {
  it('refreshes before the first request when only a refresh token is stored, and sends the bearer token', async () => {
    const { client, store, calls } = setup((url) => (url.endsWith('/v1/auth/refresh') ? json(200, pair(2)) : json(200, { ok: true })));
    await expect(client.request('GET', '/v1/me')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['http://api.test/v1/auth/refresh', 'http://api.test/v1/me']);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ refreshToken: 'refresh-1' });
    expect(header(calls[1]!.init, 'Authorization')).toBe('Bearer access-2');
    expect(store.value).toBe('refresh-2');
  });

  it('on 401 refreshes once and retries once', async () => {
    let meCalls = 0;
    const { client, calls } = setup((url) => {
      if (url.endsWith('/refresh')) return json(200, pair(3));
      meCalls += 1;
      return meCalls === 1 ? json(401, { error: { code: 'unauthorized', message: 'no' } }) : json(200, { id: 'u' });
    });
    await client.startSession({ accessToken: 'expired', refreshToken: 'refresh-1' });
    await expect(client.request('GET', '/v1/me')).resolves.toEqual({ id: 'u' });
    expect(calls.map((c) => c.url.replace('http://api.test', ''))).toEqual(['/v1/me', '/v1/auth/refresh', '/v1/me']);
    expect(header(calls[2]!.init, 'Authorization')).toBe('Bearer access-3');
  });

  it('shares one refresh between requests that fail together', async () => {
    let refreshes = 0;
    const { client } = setup((url, init) => {
      if (url.endsWith('/refresh')) {
        refreshes += 1;
        return json(200, pair(4));
      }
      return header(init, 'Authorization') === 'Bearer access-4' ? json(200, {}) : json(401, {});
    });
    await client.startSession({ accessToken: 'expired', refreshToken: 'refresh-1' });
    await Promise.all([client.request('GET', '/a'), client.request('GET', '/b'), client.request('GET', '/c')]);
    expect(refreshes).toBe(1);
  });

  it('signs out when the refresh token is refused', async () => {
    const { client, store, signedOut } = setup((url) =>
      url.endsWith('/refresh') ? json(401, { error: { code: 'invalid_refresh_token', message: 'Sign in again.' } }) : json(401, {}),
    );
    await client.startSession({ accessToken: 'expired', refreshToken: 'refresh-1' });
    const error = await client.request('GET', '/v1/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(SIGNED_OUT_MESSAGE);
    expect(store.value).toBeNull();
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it('signs out when even a fresh token is refused (session revoked)', async () => {
    const { client, signedOut } = setup((url) => (url.endsWith('/refresh') ? json(200, pair(5)) : json(401, {})));
    await expect(client.request('GET', '/v1/me')).rejects.toMatchObject({ code: 'signed_out' });
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh fails because the phone is offline', async () => {
    const { client, store, signedOut } = setup(() => {
      throw new TypeError('Network request failed');
    });
    await expect(client.request('GET', '/v1/me')).rejects.toMatchObject({ code: 'offline', message: OFFLINE_MESSAGE });
    expect(store.value).toBe('refresh-1');
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('reports a timeout', async () => {
    const { client } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      null,
      20,
    );
    await expect(client.request('GET', '/v1/meta', { auth: false })).rejects.toMatchObject({ code: 'timeout', message: TIMEOUT_MESSAGE });
  });

  it('sends If-Match and Idempotency-Key, and turns a 412 into a conflict', async () => {
    const { client, calls } = setup(() =>
      json(412, { error: { code: 'version_conflict', message: 'This record was changed elsewhere since you loaded it. Reload it and try again.' } }),
    );
    await client.startSession({ accessToken: 'a-token', refreshToken: 'refresh-1' });
    const error = await client.request('PATCH', '/v1/business', { body: { name: 'X' }, ifMatch: 7, idempotencyKey: 'k-1' }).catch((e: unknown) => e);
    expect(header(calls[0]!.init, 'If-Match')).toBe('7');
    expect(header(calls[0]!.init, 'Idempotency-Key')).toBe('k-1');
    expect((error as ApiError).status).toBe(412);
    expect(errorMessage(error)).toBe(CONFLICT_MESSAGE);
  });

  it("surfaces the server's error message and names the first invalid field", async () => {
    const { client } = setup((url) =>
      url.includes('workers')
        ? json(404, { error: { code: 'worker_not_found', message: 'No such worker.' } })
        : json(400, { error: { code: 'invalid_request', message: 'The request is not valid.', details: [{ path: 'email', message: 'bad' }] } }),
    );
    await expect(client.request('GET', '/v1/workers/x', { auth: false })).rejects.toMatchObject({ status: 404, code: 'worker_not_found', message: 'No such worker.' });
    await expect(client.request('POST', '/v1/auth/password/login', { auth: false, body: {} })).rejects.toMatchObject({
      message: 'The request is not valid. (email: bad)',
    });
  });

  it('builds query strings and treats 204 as no content', async () => {
    const { client, calls } = setup(() => json(204, null));
    await client.startSession({ accessToken: 'a-token', refreshToken: 'refresh-1' });
    await expect(client.request('DELETE', '/v1/stubs', { query: { workerId: 'w 1', cursor: undefined, limit: 200 } })).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('http://api.test/v1/stubs?workerId=w%201&limit=200');
  });
});
