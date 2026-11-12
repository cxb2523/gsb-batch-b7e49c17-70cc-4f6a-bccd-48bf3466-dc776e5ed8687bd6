import { getApiBaseUrl } from './api-url';

export interface ApiErrorOptions {
  status?: number | undefined;
  code?: string | undefined;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.code = options.code;
    this.details = options.details;
  }
}

export type HttpResponseType = 'json' | 'arrayBuffer' | 'blob' | 'text';

export interface HttpRequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  workspaceId?: string | undefined;
  headers?: Record<string, string> | Headers | undefined;
  body?: unknown;
  responseType?: HttpResponseType | undefined;
}

function isBinaryBody(body: unknown): body is Blob | ArrayBuffer | Uint8Array | FormData {
  return (
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof Uint8Array ||
    (typeof FormData !== 'undefined' && body instanceof FormData)
  );
}

function buildHeaders(
  initHeaders: HttpRequestOptions['headers'],
  workspaceId: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (initHeaders) {
    new Headers(initHeaders).forEach((value, key) => {
      headers[key] = value;
    });
  }
  if (workspaceId) {
    headers['active-organization'] = workspaceId;
  }
  return headers;
}

/** Encodes the body and, unless the caller set one, adds the matching Content-Type. */
function encodeBody(body: unknown, headers: Record<string, string>): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;

  const hasContentType = 'Content-Type' in headers || 'content-type' in headers;
  const setContentType = (value: string) => {
    if (!hasContentType) headers['Content-Type'] = value;
  };

  if (isBinaryBody(body)) {
    if (!(body instanceof FormData)) setContentType('application/octet-stream');
    return body instanceof Uint8Array ? new Blob([body.slice().buffer]) : body;
  }
  setContentType('application/json');
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/** The first reason in a `{ errors: [{ message }] }` validation answer, if the body has one. */
function firstFieldReason(body: object): string | null {
  if (!('errors' in body) || !Array.isArray(body.errors)) return null;
  const first: unknown = body.errors[0];
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return typeof first.message === 'string' && first.message.length > 0 ? first.message : null;
  }
  return null;
}

async function toApiError(res: Response): Promise<ApiError> {
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  const errorData: unknown = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  let code: string | undefined;
  let message = `Request failed with status ${res.status}`;
  let details: unknown = errorData;

  if (typeof errorData === 'object' && errorData !== null) {
    if ('code' in errorData && typeof errorData.code === 'string') {
      code = errorData.code;
    }
    if ('message' in errorData) {
      if (typeof errorData.message === 'string') {
        message = errorData.message;
      } else if (Array.isArray(errorData.message)) {
        message = errorData.message.join(', ');
      }
    }
    // A refused field comes as "Validation failed" plus the reasons: say the first reason.
    const reason = firstFieldReason(errorData);
    if (reason) message = reason;
    const restDetails = Object.fromEntries(
      Object.entries(errorData).filter(
        ([key]) => key !== 'code' && key !== 'message' && key !== 'statusCode' && key !== 'error',
      ),
    );
    details = Object.keys(restDetails).length > 0 ? restDetails : errorData;
  }

  return new ApiError({ status: res.status, code, message, details });
}

async function parseSuccess(res: Response, responseType: HttpResponseType): Promise<unknown> {
  if (res.status === 204) {
    return responseType === 'json' ? {} : undefined;
  }

  switch (responseType) {
    case 'arrayBuffer':
      return res.arrayBuffer();
    case 'blob':
      return res.blob();
    case 'text':
      return res.text();
    case 'json': {
      const text = await res.text();
      if (!text.trim()) return {};
      try {
        return JSON.parse(text);
      } catch (parseError) {
        throw new ApiError({
          status: res.status,
          code: 'INVALID_JSON',
          message: 'Failed to parse JSON response from server',
          details: parseError,
        });
      }
    }
  }
}

export async function httpRequest(
  path: string,
  options: HttpRequestOptions & { responseType: 'arrayBuffer' },
): Promise<ArrayBuffer>;
export async function httpRequest(
  path: string,
  options: HttpRequestOptions & { responseType: 'blob' },
): Promise<Blob>;
export async function httpRequest(
  path: string,
  options: HttpRequestOptions & { responseType: 'text' },
): Promise<string>;
export async function httpRequest<T = unknown>(
  path: string,
  options?: HttpRequestOptions,
): Promise<T>;
export async function httpRequest(
  path: string,
  options: HttpRequestOptions = {},
): Promise<unknown> {
  const { workspaceId, headers: initHeaders, body, responseType = 'json', ...rest } = options;

  const headers = buildHeaders(initHeaders, workspaceId);
  const encodedBody = encodeBody(body, headers);

  const base = getApiBaseUrl();
  const url =
    path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const init: RequestInit = { credentials: 'include', headers, ...rest };
  if (encodedBody !== undefined) init.body = encodedBody;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      // The browser's own wording ("Failed to fetch", "Load failed") stays in `details`.
      message: 'Could not reach the server. Check your connection and try again.',
      details: err,
    });
  }

  if (!res.ok) throw await toApiError(res);
  return parseSuccess(res, responseType);
}

export function validateResponse<T>(
  schema: {
    safeParse: (data: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: {
            issues: readonly { path?: readonly (string | number | symbol)[]; message: string }[];
          };
        };
  },
  data: unknown,
  endpoint: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path?.map(String).join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new ApiError({
      status: 500,
      code: 'UNEXPECTED_RESPONSE',
      message: `Invalid response from ${endpoint}: ${issues}`,
      details: result.error,
    });
  }
  return result.data;
}

export const http = Object.assign(httpRequest, {
  get: <T = unknown>(path: string, options?: Omit<HttpRequestOptions, 'method'>) =>
    httpRequest<T>(path, { ...options, method: 'GET' }),
  post: <T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>,
  ) => httpRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>,
  ) => httpRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>,
  ) => httpRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = unknown>(path: string, options?: Omit<HttpRequestOptions, 'method'>) =>
    httpRequest<T>(path, { ...options, method: 'DELETE' }),
});
