/**
 * Global, atomic rate limiting backed by D1.
 *
 * Cache API is per-colo and non-atomic. For operations where global
 * consistency matters (notably magic-link email quota and the anonymous
 * conversion limits shared by every edge instance), we need D1
 * INSERT ... ON CONFLICT UPDATE with RETURNING to get an atomic counter.
 *
 *   bumpLimit(env, "magic-link:ip:1.2.3.4", 10, 3600)
 *     → { count: 7, limit: 10, blocked: false, resetAt: "2026-04-11T..." }
 *
 * Falls back to allow-through (blocked: false) if D1 is unavailable —
 * we prefer availability over denial when the counter store is down.
 */

import type { Env } from "../types";

export interface RateLimitResult {
  count: number;
  limit: number;
  blocked: boolean;
  resetAt: string;
}

/** Result of a fixed-window bump; `unavailable` means D1 could not be reached. */
export interface FixedWindowRateLimitResult extends RateLimitResult {
  /** True when the counter store was unavailable and the request must fail open. */
  unavailable: boolean;
}

interface BumpOptions {
  /**
   * Absolute expiry timestamp (ISO). When given, the row expires at this exact
   * instant even when the counter rolls over — used for fixed windows aligned
   * to the minute boundary or UTC midnight. Defaults to now + windowSeconds.
   */
  expiresAtIso?: string;
}

async function bump(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
  options: BumpOptions = {},
): Promise<{ row?: { count: number; expires_at: string }; resetAt: string; failed: boolean }> {
  const now = new Date();
  const resetAt = options.expiresAtIso
    ?? new Date(now.getTime() + windowSeconds * 1000).toISOString();
  const nowIso = now.toISOString();

  if (!env.AUTH_DB) {
    // No D1 → can't enforce; fail open to preserve availability.
    return { resetAt, failed: true };
  }

  try {
    const row = await env.AUTH_DB.prepare(`
      INSERT INTO rate_limits (key, count, expires_at)
      VALUES (?1, 1, ?2)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.expires_at <= ?3 THEN 1
          ELSE rate_limits.count + 1
        END,
        expires_at = CASE
          WHEN rate_limits.expires_at <= ?3 THEN excluded.expires_at
          ELSE rate_limits.expires_at
        END
      RETURNING count, expires_at
    `).bind(key, resetAt, nowIso).first<{
      count: number;
      expires_at: string;
    }>();

    if (!row) {
      return { resetAt, failed: true };
    }
    return { row, resetAt, failed: false };
  } catch (err) {
    // Fail open on D1 errors — don't break the user flow because
    // the counter backend is down. Log so ops can investigate.
    console.warn("D1 rate limit error (failing open):", err);
    return { resetAt, failed: true };
  }
}

/**
 * Increment a rate limit counter and return whether the request is blocked.
 * Uses D1 atomic upsert: the counter resets when the row's expires_at passes.
 *
 * The query is a single round-trip — RETURNING gives us the post-write
 * counter value without a follow-up SELECT.
 */
export async function bumpLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { row, resetAt } = await bump(env, key, limit, windowSeconds);
  if (!row) {
    return { count: 0, limit, blocked: false, resetAt };
  }
  return {
    count: row.count,
    limit,
    blocked: row.count > limit,
    resetAt: row.expires_at,
  };
}

/**
 * Fixed-window variant for the shared anonymous limits. The caller computes
 * both the windowed key and the exact reset instant, so every edge instance
 * counts against the same window and `Retry-After` points at the real boundary
 * (next minute boundary / next UTC midnight) instead of now + window length.
 *
 * `unavailable: true` signals that D1 could not be read; callers must fail open.
 */
export async function bumpFixedWindowLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
  expiresAtIso?: string,
): Promise<FixedWindowRateLimitResult> {
  const { row, resetAt, failed } = await bump(env, key, limit, windowSeconds, {
    expiresAtIso,
  });
  if (!row) {
    return { count: 0, limit, blocked: false, resetAt, unavailable: true };
  }
  return {
    count: row.count,
    limit,
    blocked: row.count > limit,
    resetAt: row.expires_at,
    unavailable: false,
  };
}

/** Read the current counter without incrementing it (useful for probing). */
export async function peekLimit(
  env: Env,
  key: string,
): Promise<{ count: number; expires_at: string } | null> {
  if (!env.AUTH_DB) return null;
  try {
    const row = await env.AUTH_DB.prepare(
      `SELECT count, expires_at FROM rate_limits WHERE key = ? LIMIT 1`
    ).bind(key).first<{ count: number; expires_at: string }>();
    if (!row) return null;
    if (new Date(row.expires_at) <= new Date()) return null;
    return row;
  } catch {
    return null;
  }
}
