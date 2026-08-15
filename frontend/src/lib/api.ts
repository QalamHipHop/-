import { env } from './env';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** When true, do not throw on 4xx/5xx, return the raw Response. */
  raw?: boolean;
}

function buildUrl(path: string, query?: ApiRequestInit['query']) {
  // Frontend call sites use `/api/...`; the gateway owns the versioned REST
  // namespace at `/api/v1/...`. Normalize in one place so every client request
  // reaches the same production contract.
  const normalizedPath = path.startsWith('/api/') ? `/api/v1/${path.slice('/api/'.length)}` : path;
  const url = new URL(normalizedPath, env.apiBaseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiFetch<T = unknown>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { body, query, headers, raw, ...rest } = init;
  const token = typeof window !== 'undefined' ? localStorage.getItem('rial_token') : null;
  const isJson = body && typeof body === 'object' && !(body instanceof FormData);

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: {
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/json',
      ...headers,
    },
    body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
    credentials: 'include',
  });

  if (raw) return res as unknown as T;

  if (!res.ok) {
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = await res.text().catch(() => null);
    }
    throw new ApiError(res.status, `Request failed: ${res.status}`, payload);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T = unknown>(path: string, init?: ApiRequestInit) => apiFetch<T>(path, { ...init, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'PATCH', body }),
  delete: <T = unknown>(path: string, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'DELETE' }),
};
