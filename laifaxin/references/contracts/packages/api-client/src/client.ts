import { VALIDATION } from '@laifaxin/core/auth';
import type { Envelope } from '@laifaxin/core/common';

/** The transport owns HTTP, cancellation and platform-specific request options. */
export interface ApiRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface ApiResponse {
  status: number;
  headers?: { get(name: string): string | null };
  /** Decode lazily: a 401/403 response need not contain valid JSON. */
  json(): Promise<unknown>;
}
export interface SessionSnapshot {
  token: string | null;
  orgId: string | null;
}
export type ApiMessageKey =
  | 'permissionDenied'
  | 'sessionExpired'
  | typeof VALIDATION.networkError
  | typeof VALIDATION.requestFailed;
export interface ApiClientOptions<Options extends ApiRequestOptions = ApiRequestOptions> {
  baseUrl: string;
  transport(url: string, options: Options): Promise<ApiResponse>;
  getSession?: () => SessionSnapshot;
  onSessionExpired?: () => void;
  /** The backend expects the Web host including its port. */
  getHost?: () => string;
  message?: (key: ApiMessageKey) => string;
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`API ${status}: ${path}`);
    this.name = 'ApiError';
  }
}
export class PermissionDeniedError extends ApiError {
  constructor(path: string, message = 'permissionDenied') {
    super(403, path);
    this.name = 'PermissionDeniedError';
    this.message = message;
  }
}
export class RateLimitError extends ApiError {
  constructor(
    path: string,
    readonly retryAfter?: number,
    message?: string,
  ) {
    super(429, path);
    this.name = 'RateLimitError';
    if (message) this.message = message;
  }
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value?.trim()) return;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1000
      ? seconds
      : undefined;
  }
  // HTTP-date is also valid; do not interpret malformed numeric delays as dates.
  if (!/^[A-Za-z]{3}, /.test(text)) return;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp)
    ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
    : undefined;
}
export class SessionExpiredError extends Error {
  constructor(message = 'sessionExpired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}
/** Historical name retained for existing Web error handlers. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code?: number | string,
    readonly data?: unknown,
    /** Transport/HTTP failure: a write may have reached the server. */
    readonly networkError = false,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
/** Importing this module has no side effects. Clients never share mutable configuration. */
export function createApiClient<Options extends ApiRequestOptions = ApiRequestOptions>(
  options: ApiClientOptions<Options>,
) {
  const message = (key: ApiMessageKey) => options.message?.(key) || key;
  const getHost = () => options.getHost?.() ?? '';
  const getSession = () => options.getSession?.() ?? { token: null, orgId: null };
  async function fetchJson<T>(
    path: string,
    init?: Options,
    { readErrorMessage = false }: { readErrorMessage?: boolean } = {},
  ): Promise<T> {
    const session = getSession();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (session.token) {
      headers.accesstoken = session.token;
      if (session.orgId) headers.uid = session.orgId;
    }
    for (const [name, value] of Object.entries(init?.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    const expireSession = (detail?: string) => {
      const current = getSession();
      // A delayed response must not clear a new login or a different workspace.
      if (
        current.token &&
        headers.accesstoken === current.token &&
        (headers.uid ?? null) === current.orgId
      )
        options.onSessionExpired?.();
      return new SessionExpiredError(detail || message('sessionExpired'));
    };
    const response = await options.transport(`${options.baseUrl}${path}`, {
      ...init,
      headers,
    } as Options);
    if (response.status < 200 || response.status >= 300) {
      const body = readErrorMessage ? await response.json().catch(() => null) : null;
      const detail =
        body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message.trim()
          : '';
      if (response.status === 401) throw expireSession(detail);
      if (response.status === 403) {
        throw new PermissionDeniedError(path, detail || message('permissionDenied'));
      }
      if (response.status === 429) {
        throw new RateLimitError(
          path,
          parseRetryAfter(response.headers?.get('Retry-After')),
          detail || message(VALIDATION.requestFailed),
        );
      }
      const code =
        body &&
        typeof body === 'object' &&
        'code' in body &&
        (typeof body.code === 'string' || typeof body.code === 'number')
          ? body.code
          : undefined;
      if (detail || code !== undefined)
        throw new AuthError(detail || message(VALIDATION.requestFailed), code, undefined, true);
      throw new ApiError(response.status, path);
    }
    const data = await response.json();
    const envelope = data as Partial<Envelope> | null;
    if (response.status === 203 && envelope?.success === false) {
      throw expireSession(
        readErrorMessage && typeof envelope.message === 'string'
          ? envelope.message.trim()
          : undefined,
      );
    }
    if (
      envelope?.success === false &&
      typeof envelope.message === 'string' &&
      /^权限不足(?:$|[\s：:])/u.test(envelope.message.trim())
    ) {
      throw new PermissionDeniedError(
        path,
        readErrorMessage ? envelope.message : message('permissionDenied'),
      );
    }
    return data as T;
  }
  async function postEnvelopeFull<T>(
    path: string,
    body: Record<string, unknown>,
    options?: { readErrorMessage?: boolean },
  ): Promise<Envelope<T> & Record<string, unknown>> {
    let response: Envelope<T> & Record<string, unknown>;
    try {
      response = await fetchJson<Envelope<T> & Record<string, unknown>>(
        path,
        {
          method: 'POST',
          body: JSON.stringify({ ...body, host: getHost() }),
        } as Options,
        options,
      );
    } catch (error) {
      if (
        error instanceof SessionExpiredError ||
        error instanceof PermissionDeniedError ||
        error instanceof RateLimitError ||
        (options?.readErrorMessage && error instanceof AuthError)
      )
        throw error;
      throw new AuthError(message(VALIDATION.networkError), undefined, undefined, true);
    }
    if (!response.success)
      throw new AuthError(
        response.message ?? message(VALIDATION.requestFailed),
        response.code,
        response.data,
      );
    return response;
  }
  async function postEnvelope<T>(
    path: string,
    body: Record<string, unknown>,
    options?: { readErrorMessage?: boolean },
  ): Promise<T> {
    return (await postEnvelopeFull<T>(path, body, options)).data as T;
  }
  return { fetchJson, postEnvelope, postEnvelopeFull, getHost };
}
export type ApiClient = ReturnType<typeof createApiClient>;
