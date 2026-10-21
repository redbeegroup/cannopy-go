/**
 * Thin fetch wrapper for the REST API. Every call carries the device's session
 * token as a bearer token (architecture doc, decision 8); the token is set
 * here by the session provider when the app opens or the owner signs in.
 * Errors arrive as `{ error, message, details? }` and are thrown as ApiError
 * so screens can show the code in the owner's language.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

let currentToken: string | null = null;

export function setApiToken(token: string | null): void {
  currentToken = token;
}

export function getApiToken(): string | null {
  return currentToken;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  /** Overrides the session token, for the sign-in screens before a session exists. */
  token?: string | null;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const token = options.token === undefined ? currentToken : options.token;
  if (token) headers.authorization = `Bearer ${token}`;

  const init: RequestInit = {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (json ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(
      res.status,
      e.error ?? 'request_failed',
      e.message ?? res.statusText,
      e.details,
    );
  }
  return json as T;
}

/** True when the server no longer accepts this device's token: the owner must sign in again. */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** True for the failures that mean "no server right now" rather than "the server said no". */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof ApiError && err.status >= 502);
}
