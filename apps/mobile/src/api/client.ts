/**
 * The HTTP client for the CrewStub server. Plain TypeScript with no React
 * Native imports, so it runs under Jest: storage and `fetch` are passed in.
 *
 * Sessions: the access token (15 minutes) lives only in memory; the refresh
 * token is kept in the store (the iOS Keychain in the app). A request that
 * gets 401 refreshes once and is retried once. When the server refuses the
 * refresh token the session is over: the store is cleared and `onSignedOut`
 * runs. A refresh that fails because the phone is offline keeps the session.
 */

export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** The part of a sign-in or refresh response the client itself needs. */
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/** Every failure, whether the server answered or not. `message` is ready to show to the person. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const OFFLINE_MESSAGE = 'You appear to be offline. Check your internet connection and try again.';
export const TIMEOUT_MESSAGE = 'CrewStub is taking too long to answer. Check your connection and try again.';
export const SIGNED_OUT_MESSAGE = 'Your session has ended. Please sign in again.';
export const CONFLICT_MESSAGE = 'This was changed on another device, so it has been reloaded. Please make your change again.';

export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 412;
}

export function isNotFound(error: unknown, code?: string): boolean {
  return error instanceof ApiError && error.status === 404 && (code === undefined || error.code === code);
}

export function errorMessage(error: unknown): string {
  if (isConflict(error)) return CONFLICT_MESSAGE;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export interface RequestOptions {
  body?: unknown;
  /** The record's `version` as last read: the change fails with 412 if it has moved on since. */
  ifMatch?: number;
  /** Makes a retried create return the first result instead of creating a second record. */
  idempotencyKey?: string;
  /** False for routes that work without a session (sign-in, refresh, meta). */
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
}

export interface ApiClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type FetchResult = { kind: 'response'; response: Response } | { kind: 'failed'; error: ApiError };

export class ApiClient {
  readonly baseUrl: string;
  private readonly store: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private accessToken: string | null = null;
  private refreshing: Promise<void> | null = null;
  private signedOutListener: (() => void) | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.store = options.store;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** Called when the server ends the session (refresh token refused). Not called for `signOut()`. */
  onSignedOut(listener: (() => void) | null): void {
    this.signedOutListener = listener;
  }

  async startSession(tokens: SessionTokens): Promise<void> {
    await this.store.setRefreshToken(tokens.refreshToken);
    this.accessToken = tokens.accessToken;
  }

  async hasStoredSession(): Promise<boolean> {
    return (await this.store.getRefreshToken()) !== null;
  }

  /** Forgets the session on this device. The caller tells the server first, if it can. */
  async clearSession(): Promise<void> {
    this.accessToken = null;
    await this.store.clear();
  }

  /**
   * Swaps the stored refresh token for a new pair. Several requests failing
   * together share one refresh, because each refresh token works only once.
   */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = await this.store.getRefreshToken();
    if (!refreshToken) throw await this.endSession();
    const result = await this.send('POST', '/v1/auth/refresh', { body: { refreshToken }, auth: false });
    if (result.kind === 'failed') throw result.error; // offline: keep the session and try later
    if (result.response.status === 400 || result.response.status === 401) throw await this.endSession();
    const body = await this.parse<SessionTokens>(result.response);
    await this.startSession(body);
  }

  private async endSession(): Promise<ApiError> {
    await this.clearSession();
    this.signedOutListener?.();
    return new ApiError(401, 'signed_out', SIGNED_OUT_MESSAGE);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    if (auth && !this.accessToken) await this.refresh();
    let result = await this.send(method, path, options);
    if (auth && result.kind === 'response' && result.response.status === 401) {
      await this.refresh();
      result = await this.send(method, path, options);
      // Refused even with a fresh token: the session was revoked (signed out elsewhere, account deleted).
      if (result.kind === 'response' && result.response.status === 401) throw await this.endSession();
    }
    if (result.kind === 'failed') throw result.error;
    return this.parse<T>(result.response);
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const params = Object.entries(query ?? {})
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    return `${this.baseUrl}${path}${params.length ? `?${params.join('&')}` : ''}`;
  }

  private async send(method: string, path: string, options: RequestOptions): Promise<FetchResult> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if ((options.auth ?? true) && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (options.ifMatch !== undefined) headers['If-Match'] = String(options.ifMatch);
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url(path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      return { kind: 'response', response };
    } catch {
      return {
        kind: 'failed',
        error: timedOut ? new ApiError(0, 'timeout', TIMEOUT_MESSAGE) : new ApiError(0, 'offline', OFFLINE_MESSAGE),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (response.ok) return body as T;
    throw errorFromBody(response.status, body);
  }
}

/** The server's `{error: {code, message, details}}`, as an ApiError whose message can be shown as is. */
export function errorFromBody(status: number, body: unknown): ApiError {
  const error = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  const code = typeof error?.code === 'string' ? error.code : `http_${status}`;
  let message = typeof error?.message === 'string' && error.message ? error.message : fallbackMessage(status);
  // "The request is not valid." alone does not say what to fix; name the first field.
  const first = Array.isArray(error?.details) ? (error.details[0] as { path?: unknown; message?: unknown } | undefined) : undefined;
  if (code === 'invalid_request' && typeof first?.path === 'string') {
    message = `${message} (${first.path}${typeof first.message === 'string' ? `: ${first.message}` : ''})`;
  }
  return new ApiError(status, code, message, error?.details);
}

function fallbackMessage(status: number): string {
  if (status >= 500) return 'CrewStub ran into a problem. Please try again in a moment.';
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  return 'The request could not be completed. Please try again.';
}
