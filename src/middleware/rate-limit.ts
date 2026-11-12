// 限流中间件
//
// 两类调用者，两套互不干扰的计数：
//
// 1. 匿名调用者（convert / stream / batch 三条路由共用）：
//    - 分钟窗口按路由分别计数，键为 anon-rl:<route>:<ip>:<minuteBucket>，
//      计数保存在 D1，所有边缘实例共享同一份原子计数，不再随实例数放大。
//    - 每日窗口按 IP 汇总三条路由，键为 anon-daily:<ip>:<UTC date>。
//    - 内存计数只做热实例快速拦截，不作为放行依据；D1 不可用时整体放行。
// 2. 已登录/带 key 的调用者：只走实例内存里的本地预算，不产生任何 D1 写入。

import type { Env } from "../types";
import {
  RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_CONVERT_PER_WINDOW,
  RATE_LIMIT_STREAM_PER_WINDOW,
  RATE_LIMIT_BATCH_PER_WINDOW,
  RATE_LIMIT_ANON_CONVERT_PER_WINDOW,
  RATE_LIMIT_ANON_STREAM_PER_WINDOW,
  RATE_LIMIT_ANON_BATCH_PER_WINDOW,
  RATE_LIMIT_ANON_PER_DAY,
} from "../config";
import {
  localRateCounters,
  incrementCounter,
  logMetric,
} from "../runtime-state";
import { withExtraHeaders, errorResponse } from "../helpers/response";
import { bumpFixedWindowLimit } from "./rate-limit-d1";

export type RateLimitRoute = "convert" | "stream" | "batch";

export interface RateLimitDecision {
  exceeded: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  /** Set when the anonymous daily cap, not the per-minute window, was hit. */
  anonDaily?: boolean;
}

export function limitForRoute(route: RateLimitRoute, anonymous = false): number {
  if (anonymous) {
    switch (route) {
      case "batch":
        return RATE_LIMIT_ANON_BATCH_PER_WINDOW;
      case "stream":
        return RATE_LIMIT_ANON_STREAM_PER_WINDOW;
      default:
        return RATE_LIMIT_ANON_CONVERT_PER_WINDOW;
    }
  }
  switch (route) {
    case "batch":
      return RATE_LIMIT_BATCH_PER_WINDOW;
    case "stream":
      return RATE_LIMIT_STREAM_PER_WINDOW;
    default:
      return RATE_LIMIT_CONVERT_PER_WINDOW;
  }
}

/**
 * Instance-local fixed-window counter. Authenticated callers are enforced with
 * this alone. For anonymous callers it is only a hot-isolate fast reject: it
 * can block a request early, but can never admit one against the shared D1 count.
 */
export function consumeLocalRateCounter(
  route: RateLimitRoute,
  ip: string,
  nowMs: number,
  audience: "anon" | "auth" = "auth",
): number {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const bucket = Math.floor(nowMs / windowMs);
  const key = `rl:${audience}:${route}:${ip}:${bucket}`;
  const existing = localRateCounters.get(key);
  const expiresAt = (bucket + 1) * windowMs + 5_000;
  const nextCount = (existing?.count || 0) + 1;
  localRateCounters.set(key, { count: nextCount, expiresAt });

  if (localRateCounters.size > 2000) {
    for (const [counterKey, entry] of localRateCounters) {
      if (entry.expiresAt <= nowMs) {
        localRateCounters.delete(counterKey);
      }
    }
  }
  return nextCount;
}

function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim() || null;
  }
  return null;
}

export interface ConsumeRateLimitOptions {
  /** Anonymous convert/stream/batch share the durable D1 counters. */
  anonymous?: boolean;
}

/** Whole seconds from now until the next UTC midnight (at least 1). */
export function secondsUntilNextUtcMidnight(nowMs: number): number {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const nextUtcDay = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
  return Math.max(1, Math.ceil((nextUtcDay - nowMs) / 1000));
}

/** Whole seconds from now until the end of the current fixed minute window. */
function secondsUntilWindowEnd(nowMs: number): number {
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const resetMs = (Math.floor(nowMs / windowMs) + 1) * windowMs;
  return Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
}

function localOnlyDecision(
  route: RateLimitRoute,
  ip: string,
  nowMs: number,
  anonymous: boolean,
): RateLimitDecision {
  const limit = limitForRoute(route, anonymous);
  const count = consumeLocalRateCounter(route, ip, nowMs, anonymous ? "anon" : "auth");
  return {
    exceeded: count > limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: secondsUntilWindowEnd(nowMs),
  };
}

/**
 * Consume one request against the rate limit and return the decision.
 *
 * Returns null only when the client IP cannot be determined: without an
 * identity there is nothing to key a counter on, so no limit is applied.
 *
 * For anonymous callers the D1 counters are the source of truth and span every
 * edge instance. If D1 is unavailable, the request is allowed through — we
 * prefer availability over denial when the counter store is down, and
 * bumpFixedWindowLimit keeps the existing console.warn alert for operators.
 */
export async function consumeRateLimit(
  request: Request,
  env: Env,
  route: RateLimitRoute,
  options: ConsumeRateLimitOptions = {},
): Promise<RateLimitDecision | null> {
  const ip = getClientIp(request);
  if (!ip) return null;

  const anonymous = options.anonymous === true;
  const nowMs = Date.now();

  // Signed-in / keyed callers keep their original local budget and never
  // touch the shared counters (no extra database writes).
  if (!anonymous || !env.AUTH_DB) {
    return localOnlyDecision(route, ip, nowMs, anonymous);
  }

  const minuteLimit = limitForRoute(route, true);
  const localCount = consumeLocalRateCounter(route, ip, nowMs, "anon");

  // Hot-isolate fast reject: this instance has already seen the whole quota,
  // so reject without another D1 round trip. A fresh isolate (local count 1)
  // always falls through to the shared counter, which is the point.
  if (localCount > minuteLimit) {
    return {
      exceeded: true,
      limit: minuteLimit,
      remaining: 0,
      retryAfterSeconds: secondsUntilWindowEnd(nowMs),
    };
  }

  // Per-minute window, counted separately per route but shared across instances.
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const minuteBucket = Math.floor(nowMs / windowMs);
  const minuteResetIso = new Date((minuteBucket + 1) * windowMs).toISOString();
  const minute = await bumpFixedWindowLimit(
    env,
    `anon-rl:${route}:${ip}:${minuteBucket}`,
    minuteLimit,
    RATE_LIMIT_WINDOW_SECONDS,
    minuteResetIso,
  );
  if (minute.unavailable) {
    // Counter store is down: fail open, keep the local bookkeeping only.
    return {
      exceeded: false,
      limit: minuteLimit,
      remaining: Math.max(0, minuteLimit - localCount),
      retryAfterSeconds: secondsUntilWindowEnd(nowMs),
    };
  }
  if (minute.blocked) {
    return {
      exceeded: true,
      limit: minuteLimit,
      remaining: 0,
      retryAfterSeconds: secondsUntilWindowEnd(nowMs),
    };
  }

  // Daily cap aggregates all three routes for one IP for the UTC day.
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const nextUtcMidnightIso = new Date(
    Date.parse(`${day}T00:00:00.000Z`) + 86_400_000,
  ).toISOString();
  const daily = await bumpFixedWindowLimit(
    env,
    `anon-daily:${ip}:${day}`,
    RATE_LIMIT_ANON_PER_DAY,
    86_400,
    nextUtcMidnightIso,
  );
  if (daily.blocked) {
    return {
      exceeded: true,
      limit: RATE_LIMIT_ANON_PER_DAY,
      remaining: 0,
      retryAfterSeconds: secondsUntilNextUtcMidnight(nowMs),
      anonDaily: true,
    };
  }

  // Daily store hiccup (the minute write succeeded) is also fail-open.
  const dailyRemaining = daily.unavailable
    ? Math.max(0, RATE_LIMIT_ANON_PER_DAY - localCount)
    : Math.max(0, RATE_LIMIT_ANON_PER_DAY - daily.count);
  return {
    exceeded: false,
    limit: minuteLimit,
    remaining: Math.min(Math.max(0, minuteLimit - minute.count), dailyRemaining),
    retryAfterSeconds: secondsUntilWindowEnd(nowMs),
  };
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "Retry-After": String(decision.retryAfterSeconds),
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(decision.retryAfterSeconds),
  };
}

export function rateLimitedResponse(
  route: RateLimitRoute,
  decision: RateLimitDecision,
  asJson: boolean,
): Response {
  incrementCounter("rateLimited");
  logMetric("rate_limit.blocked", {
    route,
    limit: decision.limit,
    retry_after_s: decision.retryAfterSeconds,
    anon_daily: decision.anonDaily === true,
  });
  const message = decision.anonDaily
    ? `Anonymous use is limited to ${decision.limit} requests per IP per day. ` +
      "This is the daily limit; it resets at 00:00 UTC. " +
      "Apply for a free API key at /portal/ and send it as " +
      "'Authorization: Bearer <key>' to keep converting. " +
      `匿名用户每个 IP 每天限 ${decision.limit} 次（每日限制，UTC 零点重置），` +
      "请到 /portal/ 免费申请 API key。"
    : `Too many requests. Please try again in ${decision.retryAfterSeconds} seconds.`;
  const base = errorResponse("Rate Limited", message, 429, asJson);
  return withExtraHeaders(base, rateLimitHeaders(decision));
}
