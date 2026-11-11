export function inspectJsonResponse(status, text) {
  const bytes = Buffer.byteLength(text);
  if (status < 200 || status >= 300) return { ok: false, status, bytes, reason: 'HTTP_ERROR' };
  if (!text.trim()) return { ok: false, status, bytes, reason: 'EMPTY_RESPONSE' };
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, status, bytes, reason: 'INVALID_JSON' }; }
  const businessCode = data?.code ?? data?.BaseResp?.StatusCode ?? data?.base_resp?.StatusCode;
  if (businessCode != null && Number(businessCode) !== 0) {
    return { ok: false, status, bytes, reason: 'BUSINESS_ERROR', businessCode };
  }
  return { ok: true, status, bytes, data };
}

export async function requestText(url, options = {}) {
  const { timeout = 20000, attempts = 2, ...init } = options;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      const text = await response.text();
      return { status: response.status, url: response.url, text, headers: response.headers };
    } catch (error) { lastError = error; }
  }
  throw new Error(`网络请求失败：${lastError?.cause?.code || lastError?.message || 'UNKNOWN'}`);
}
