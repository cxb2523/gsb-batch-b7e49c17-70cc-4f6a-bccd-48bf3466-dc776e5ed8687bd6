/**
 * Verifiable normalization for the source list attached to an AI answer.
 *
 * The same source routinely shows up several times — as a short link, with
 * tracking parameters, or under http and https. A short link can also resolve
 * to a dead page or a private address (cloud metadata, localhost), and
 * structured citation fields may carry non-http values. Every candidate
 * therefore goes through one verifiable resolution before it is allowed into
 * the list:
 *
 *   1. It must parse and use http/https.
 *   2. Each hop — including the starting URL and every redirect target — must
 *      pass {@link assertPublicHttpUrl}, so a redirect into a private range is
 *      rejected.
 *   3. At most {@link MAX_SOURCE_REDIRECTS} redirects are followed.
 *   4. The final address is canonicalized and used as the dedup key; the
 *      https spelling wins when both schemes resolve to the same address.
 *
 * Anything that fails is dropped and counted under a {@link SourceDropReason}.
 * A fully rejected list yields an empty array, never a throw — the answer
 * itself is still returned.
 */
import { assertPublicHttpUrl, SsrfError } from "./ssrf";
import { fetchWithTimeout } from "./http";

/** Maximum redirects followed while resolving one source. */
export const MAX_SOURCE_REDIRECTS = 3;

/** Per-request deadline for each HTTP hop of a source resolution. */
const SOURCE_FETCH_TIMEOUT_MS = 10_000;

export const SOURCE_DROP_REASONS = [
  "too_many_redirects",
  "non_public",
  "resolve_failed",
  "non_http",
] as const;

export type SourceDropReason = (typeof SOURCE_DROP_REASONS)[number];

/** Count of candidates rejected at each gate. `total` is the sum. */
export type SourceDropStats = {
  total: number;
  tooManyRedirects: number;
  nonPublic: number;
  resolveFailed: number;
  nonHttp: number;
};

export type NormalizedSources = {
  /** Verified final addresses, deduped (https preferred). */
  sources: string[];
  /** Why each rejected candidate was dropped, with counts. */
  dropped: SourceDropStats;
};

function emptyStats(): SourceDropStats {
  return {
    total: 0,
    tooManyRedirects: 0,
    nonPublic: 0,
    resolveFailed: 0,
    nonHttp: 0,
  };
}

/** Tracking/analytics parameters stripped before dedup and output. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "utm_cid",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "mc_cid",
  "mc_eid",
  "dclid",
  "yclid",
  "igshid",
  "ttclid",
  "li_fat_id",
  "ref",
  "referrer",
  "spm",
  "source",
  "_hsenc",
  "_hsmi",
  "hsctatracking",
]);

/**
 * Remove the URL fragment, default ports and tracking parameters. The query
 * is re-sorted so parameter order can't split one page into two entries.
 */
function canonicalize(url: URL): URL {
  const out = new URL(url.toString());
  out.hash = "";
  if (
    (out.protocol === "http:" && out.port === "80") ||
    (out.protocol === "https:" && out.port === "443")
  ) {
    out.port = "";
  }
  const params = [...out.searchParams.entries()].filter(
    ([key]) => !TRACKING_PARAMS.has(key.toLowerCase()),
  );
  params.sort(([a, ka], [b, kb]) =>
    a === b ? ka.localeCompare(kb) : a.localeCompare(b),
  );
  out.search = "";
  for (const [key, value] of params) out.searchParams.append(key, value);
  return out;
}

/** Scheme-agnostic identity of a final address, used to merge http/https. */
function dedupKey(url: URL): string {
  const c = canonicalize(url);
  return `${c.hostname.toLowerCase()}${c.port ? `:${c.port}` : ""}${c.pathname}${c.search}`;
}

/**
 * Follow a source's redirect chain to its final address. Every hop is checked
 * with {@link assertPublicHttpUrl} before it is fetched.
 *
 * Throws {@link SsrfError} for any hop that isn't a public http(s) URL,
 * {@link Error} with `reason: "too_many_redirects"` past the redirect cap,
 * and {@link Error} with `reason: "resolve_failed"` for network/parse errors.
 */
async function resolveFinalUrl(
  candidate: string,
): Promise<{ final: URL; key: string }> {
  // Gate the starting URL before any network work.
  let current = await assertPublicHttpUrl(candidate);

  for (let hops = 0; hops <= MAX_SOURCE_REDIRECTS; hops += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        current.toString(),
        { method: "GET", redirect: "manual" },
        SOURCE_FETCH_TIMEOUT_MS,
      );
    } catch (error) {
      throw makeReasonError("resolve_failed", error);
    }

    const status = response.status;
    const location = response.headers.get("location");
    const isRedirect = status >= 300 && status < 400;
    if (!isRedirect) {
      // Drain/cancel the body so the socket can be reused; we only need the
      // final address, not the page body.
      await response.body?.cancel().catch(() => undefined);
      const final = canonicalize(current);
      return { final, key: dedupKey(final) };
    }
    if (location === null) {
      // A spec-conformant opaque-redirect response hides its Location header,
      // so the target can't be verified — fail closed instead of treating the
      // redirect URL itself as the final address.
      await response.body?.cancel().catch(() => undefined);
      throw makeReasonError("resolve_failed");
    }

    if (hops === MAX_SOURCE_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw makeReasonError("too_many_redirects");
    }

    await response.body?.cancel().catch(() => undefined);

    let next: URL;
    try {
      next = new URL(location, current);
    } catch (error) {
      throw makeReasonError("resolve_failed", error);
    }
    // Re-validate every redirect target — this is what blocks a short link
    // that lands on 169.254.169.254, localhost or an RFC1918 address.
    current = await assertPublicHttpUrl(next.toString());
  }

  throw makeReasonError("too_many_redirects");
}

type ReasonError = Error & { reason: SourceDropReason };

function makeReasonError(reason: SourceDropReason, cause?: unknown): ReasonError {
  const error = new Error(
    reason === "too_many_redirects"
      ? `Source exceeded ${MAX_SOURCE_REDIRECTS} redirects`
      : "Source could not be resolved",
  ) as ReasonError;
  error.reason = reason;
  if (cause instanceof Error) error.cause = cause;
  return error;
}

/**
 * Resolve, validate and deduplicate candidate source URLs.
 *
 * Candidates may be plain strings (answer-text links) or the values pulled
 * from structured citation fields, which can be non-strings or non-http
 * values — both are counted under `non_http` rather than crashing.
 */
export async function normalizeSources(
  candidates: unknown[],
): Promise<NormalizedSources> {
  const stats = emptyStats();
  // Insertion-ordered map keyed by scheme-agnostic final address. The value
  // keeps the chosen spelling; https replaces an earlier http entry.
  const deduped = new Map<string, URL>();

  const drop = (reason: SourceDropReason) => {
    stats.total += 1;
    if (reason === "too_many_redirects") stats.tooManyRedirects += 1;
    else if (reason === "non_public") stats.nonPublic += 1;
    else if (reason === "resolve_failed") stats.resolveFailed += 1;
    else stats.nonHttp += 1;
  };

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      drop("non_http");
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      drop("resolve_failed");
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      drop("non_http");
      continue;
    }

    try {
      const { final, key } = await resolveFinalUrl(candidate.trim());
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, final);
      } else if (
        existing.protocol === "http:" &&
        final.protocol === "https:"
      ) {
        // Same final address — prefer the https spelling, keep position.
        deduped.set(key, final);
      }
    } catch (error) {
      if (error instanceof SsrfError) {
        drop("non_public");
      } else if (
        error instanceof Error &&
        (error as ReasonError).reason === "too_many_redirects"
      ) {
        drop("too_many_redirects");
      } else {
        drop("resolve_failed");
      }
    }
  }

  return {
    sources: [...deduped.values()].map((url) => url.toString()),
    dropped: stats,
  };
}
