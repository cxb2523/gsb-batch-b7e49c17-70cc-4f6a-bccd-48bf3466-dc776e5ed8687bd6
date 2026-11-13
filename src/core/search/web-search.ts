import { createHash } from 'node:crypto'
import { fetchHttp, resolveRedirect } from '../fetcher/http-fetcher.js'
import { withPage } from '../fetcher/browser-fetcher.js'
import { parseGoogle, parseDuckDuckGo, type SearchResult } from '../extractor/search-extractor.js'
import { cacheGet, cacheSet } from '../../lib/cache.js'
import { mapLimit } from '../../lib/concurrency.js'
import { config } from '../../lib/config.js'
import { logger } from '../../lib/logger.js'

export type SearchEngine = 'google' | 'duckduckgo'
export type SearchStrategy = 'google-http' | 'google-browser' | 'duckduckgo'

export interface SearchOptions {
  query: string
  limit: number
  engine?: SearchEngine
  /** UI / result language, e.g. "en", "ja" (Google hl). */
  lang?: string
  /** Country to search from, e.g. "us", "jp" (Google gl). */
  country?: string
  /** Google time filter, e.g. "qdr:d" (day), "qdr:w", "qdr:m", "qdr:y". */
  tbs?: string
  timeout?: number
  skipCache?: boolean
}

export interface SearchResponse {
  results: SearchResult[]
  /** Engine that actually produced these results — also for a cache hit. */
  engine: SearchEngine
  /**
   * Engines tried (or deliberately skipped) before `engine`, with a readable reason.
   * A strategy that is cooling down after a bot check shows up here as `skipped: ...`
   * together with its cooldown end / remaining time — never as a network failure.
   */
  fallbackFrom?: { engine: SearchEngine; reason: string }[]
  /** Every engine tried was blocked (CAPTCHA / anomaly page / still cooling down). */
  blocked?: boolean
  /** Results were served from the cache instead of a fresh request. */
  cached?: boolean
}

export class SearchBlockedError extends Error {}

const GOOGLE_PAGE_SIZE = 10
const GOOGLE_READY_SELECTOR = '#rso, #search, #botstuff, #captcha-form, form[action*="/sorry/"], #recaptcha'
// Google still serves its lightweight no-JS results page to Opera Mini: plain HTTP, ~0.5s, real /url?q= links
const GOOGLE_BASIC_UA = 'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80 (S60; SymbOS; Opera Mobi/23.348; U; en) Presto/2.5.25 Version/10.54'

// After a CAPTCHA, skip that strategy for a while: retrying immediately is slow and prolongs the block
export const SEARCH_BLOCK_COOLDOWN_MS = 10 * 60 * 1000
const blockedUntil = new Map<SearchStrategy, number>()

// Injectable clock so tests can exercise cooldown expiry without sleeping.
let clock: () => number = () => Date.now()

/** Test seam: replace the clock used for cooldown decisions; call without an argument to restore the real clock. */
export function setSearchClock(fn?: () => number): void {
  clock = fn ?? (() => Date.now())
}

/** Test seam: clear all cooldown state and restore the real clock. */
export function resetSearchState(): void {
  blockedUntil.clear()
  clock = () => Date.now()
}

export function isStrategyCoolingDown(s: SearchStrategy): boolean {
  return (blockedUntil.get(s) ?? 0) > clock()
}

/** Mark a strategy as blocked for the cooldown window. Exported so tests can seed cooldown state. */
export function markStrategyBlocked(s: SearchStrategy): void {
  blockedUntil.set(s, clock() + SEARCH_BLOCK_COOLDOWN_MS)
  logger.warn({ strategy: s, minutes: SEARCH_BLOCK_COOLDOWN_MS / 60000 }, 'Search strategy blocked; cooling down')
}

/** Per-strategy availability, for /health. */
export function searchStatus(): Record<SearchStrategy, string> {
  const status = (s: SearchStrategy) =>
    isStrategyCoolingDown(s) ? `blocked until ${new Date(blockedUntil.get(s) ?? 0).toISOString()}` : 'ok'
  return { 'google-http': status('google-http'), 'google-browser': status('google-browser'), duckduckgo: status('duckduckgo') }
}

/** Every strategy that can serve an engine; the engine is skipped only when all of them are cooling down. */
const ENGINE_STRATEGIES: Record<SearchEngine, readonly SearchStrategy[]> = {
  google: ['google-http', 'google-browser'],
  duckduckgo: ['duckduckgo'],
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

/** Strategies of `engine` that are still inside their cooldown window at `at`. */
function coolingStrategies(engine: SearchEngine, at: number): Array<{ strategy: SearchStrategy; until: number }> {
  return ENGINE_STRATEGIES[engine]
    .map((strategy) => ({ strategy, until: blockedUntil.get(strategy) ?? 0 }))
    .filter(({ until }) => until > at)
}

function cooldownDetail(cooling: Array<{ strategy: SearchStrategy; until: number }>, at: number): string {
  const availableAt = Math.min(...cooling.map(({ until }) => until))
  const detail = cooling.map(({ strategy, until }) => `${strategy} until ${new Date(until).toISOString()}`).join(', ')
  // The earliest path to recover decides when an engine-level retry makes sense
  const retry = availableAt - at
  return `still cooling down after a bot check (${detail}); retry in ${formatDuration(retry)}`
}

/**
 * Why an engine was skipped without any network attempt, or null if it is still usable.
 * Only reported when *all* of the engine's strategies are cooling down; the reason carries the
 * cooldown end and the remaining time so callers can tell this apart from a fetch failure.
 */
function coolingDownReason(engine: SearchEngine, at: number): string | null {
  const strategies = ENGINE_STRATEGIES[engine]
  const cooling = coolingStrategies(engine, at)
  if (cooling.length < strategies.length) return null
  return `skipped: ${cooldownDetail(cooling, at)}`
}

/**
 * Reason to report when only part of an engine's paths are cooling down and the engine is still
 * queried through the remaining ones (e.g. Google's browser path after the HTTP path was blocked).
 */
function partialCooldownReason(engine: SearchEngine, at: number): string | null {
  const cooling = coolingStrategies(engine, at)
  if (cooling.length === 0 || cooling.length === ENGINE_STRATEGIES[engine].length) return null
  const names = cooling.map(({ strategy }) => strategy).join(', ')
  return `skipped ${names}: ${cooldownDetail(cooling, at)}`
}

function googleUrl(opts: SearchOptions, start: number): string {
  const params = new URLSearchParams({ q: opts.query, hl: opts.lang ?? 'en', pws: '0' })
  if (opts.country) params.set('gl', opts.country)
  if (opts.tbs) params.set('tbs', opts.tbs)
  if (start > 0) params.set('start', String(start))
  return `https://www.google.com/search?${params}`
}

async function googleHttpPage(opts: SearchOptions, start: number) {
  const { html, url, statusCode } = await fetchHttp(googleUrl(opts, start), opts.timeout ?? 15000, {
    'user-agent': GOOGLE_BASIC_UA,
    'accept-language': `${opts.lang ?? 'en'};q=0.9`,
    // Skip the EU consent interstitial
    cookie: 'CONSENT=YES+; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
  })
  // Google throttles scrapers with a bare 403/429 rather than a CAPTCHA on this path
  if (statusCode === 403 || statusCode === 429) return { results: [], blocked: true }
  return parseGoogle(html, url)
}

async function googleBrowserPage(opts: SearchOptions, start: number) {
  return withPage(async (page) => {
    await page.goto(googleUrl(opts, start), { waitUntil: 'domcontentloaded', timeout: opts.timeout ?? 20000 })
    // Results are server-rendered once the JS shell boots; don't wait for network idle
    await page.waitForSelector(GOOGLE_READY_SELECTOR, { timeout: 8000 }).catch(() => null)
    return parseGoogle(await page.content(), page.url())
  })
}

async function searchGoogle(opts: SearchOptions): Promise<SearchResult[]> {
  const pages = Math.min(5, Math.ceil(opts.limit / GOOGLE_PAGE_SIZE))
  const starts = Array.from({ length: pages }, (_, i) => i * GOOGLE_PAGE_SIZE)

  const strategies = (['google-http', 'google-browser'] as const).filter((s) => !isStrategyCoolingDown(s))
  // Both paths cooling down: report the cooldown instead of probing the block again
  if (strategies.length === 0) {
    throw new SearchBlockedError(coolingDownReason('google', clock()) ?? 'Google is cooling down after a bot check')
  }

  let parsed: Awaited<ReturnType<typeof googleHttpPage>>[] | null = null
  for (const s of strategies) {
    const fetchPage = s === 'google-http' ? googleHttpPage : googleBrowserPage
    const attempt = await mapLimit(starts, s === 'google-http' ? 5 : 2, (start) => fetchPage(opts, start))
    if (attempt.every((p) => p.blocked)) {
      markStrategyBlocked(s)
      continue
    }
    blockedUntil.delete(s)
    if (attempt.some((p) => p.results.length > 0)) {
      parsed = attempt
      break
    }
    parsed ??= attempt
  }
  if (!parsed) throw new SearchBlockedError('Google returned a CAPTCHA page')

  const seen = new Set<string>()
  const merged = parsed.flatMap((p) => p.results).filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, opts.limit)

  // Newer SERPs link through opaque /goto tokens; one redirect lookup each reveals the real URL
  const resolved = await mapLimit(merged, 10, async (r) => {
    if (!r.needsResolve) return r
    const target = await resolveRedirect(r.url)
    const { needsResolve: _drop, ...rest } = r
    return { ...rest, url: target ?? r.url }
  })
  return resolved.map((r, i) => ({ title: r.title, url: r.url, snippet: r.snippet, position: i + 1 }))
}

async function searchDuckDuckGo(opts: SearchOptions): Promise<SearchResult[]> {
  if (isStrategyCoolingDown('duckduckgo')) {
    throw new SearchBlockedError(coolingDownReason('duckduckgo', clock()) ?? 'DuckDuckGo is cooling down after a bot check')
  }
  const params = new URLSearchParams({ q: opts.query })
  if (opts.country || opts.lang) params.set('kl', `${opts.country ?? 'wt'}-${opts.lang ?? 'wt'}`)
  if (opts.tbs?.startsWith('qdr:')) params.set('df', opts.tbs.slice(4, 5))
  const { html } = await fetchHttp(`https://html.duckduckgo.com/html/?${params}`, opts.timeout ?? 15000)
  const { results, blocked } = parseDuckDuckGo(html)
  if (blocked) {
    markStrategyBlocked('duckduckgo')
    throw new SearchBlockedError('DuckDuckGo returned an anomaly (bot check) page')
  }
  return results.slice(0, opts.limit)
}

const ENGINES: Record<SearchEngine, (opts: SearchOptions) => Promise<SearchResult[]>> = {
  google: searchGoogle,
  duckduckgo: searchDuckDuckGo,
}

/** Cache key for one engine's answer to a query. Exported for tests that need to seed the cache. */
export function searchCacheKey(engine: SearchEngine, opts: SearchOptions): string {
  const raw = JSON.stringify([engine, opts.query, opts.limit, opts.lang, opts.country, opts.tbs])
  return `crawlit:search:${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`
}

export async function webSearch(opts: SearchOptions): Promise<SearchResponse> {
  const primary = opts.engine ?? config.SEARCH_ENGINE
  const chain: SearchEngine[] = config.SEARCH_FALLBACK
    ? [primary, ...(Object.keys(ENGINES) as SearchEngine[]).filter((e) => e !== primary)]
    : [primary]

  // Snapshot the clock once so cache and network decisions in one request agree on cooldown state
  const at = clock()
  const coolingReasons = new Map<SearchEngine, string>()
  for (const engine of chain) {
    const reason = coolingDownReason(engine, at)
    if (reason) coolingReasons.set(engine, reason)
  }

  const fallbackFrom: { engine: SearchEngine; reason: string }[] = []
  let allBlocked = true

  // Any engine's cached answer beats a fresh network attempt (e.g. a fallback result while Google is blocked)
  if (!opts.skipCache) {
    const cachedAll = await Promise.all(chain.map((engine) => cacheGet<SearchResult[]>(searchCacheKey(engine, opts))))
    for (const [i, cached] of cachedAll.entries()) {
      const engine = chain[i]
      if (!engine || !cached || cached.length === 0) continue

      // The answer is real, but say which engines were passed over to serve it from cache.
      // A cache hit makes no network attempt at all, so only the cache itself is cited here —
      // unless the skipped engine is cooling down, which is the more precise reason.
      const skippedBefore = chain.slice(0, i).map((prior) => ({
        engine: prior,
        reason: coolingReasons.get(prior) ?? `skipped: not attempted because a cached answer from ${engine} was available`,
      }))
      // The hit engine itself may have a path in cooldown (e.g. Google's HTTP path, browser still fine)
      const ownNote = coolingReasons.has(engine) ? null : partialCooldownReason(engine, at)
      const notes = [...skippedBefore, ...(ownNote ? [{ engine, reason: ownNote }] : [])]
      return {
        results: cached,
        engine,
        cached: true,
        ...(notes.length > 0 && { fallbackFrom: notes }),
      }
    }
  }

  for (const engine of chain) {
    const cooling = coolingReasons.get(engine)
    if (cooling) {
      // Deliberate skip, not a failed request
      fallbackFrom.push({ engine, reason: cooling })
      continue
    }

    const key = searchCacheKey(engine, opts)
    // Paths that were already in cooldown before this request (not ones blocked by it)
    const partialBefore = partialCooldownReason(engine, at)
    try {
      const results = await ENGINES[engine](opts)
      if (results.length === 0) {
        allBlocked = false
        fallbackFrom.push({ engine, reason: 'no results' })
        continue
      }
      if (config.SEARCH_CACHE_TTL_SECONDS > 0) await cacheSet(key, results, config.SEARCH_CACHE_TTL_SECONDS)
      if (partialBefore) fallbackFrom.push({ engine, reason: partialBefore })
      return { results, engine, ...(fallbackFrom.length && { fallbackFrom }) }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!(err instanceof SearchBlockedError)) allBlocked = false
      logger.warn({ engine, query: opts.query, reason }, 'Search engine failed')
      fallbackFrom.push({ engine, reason })
      // Keep the pre-existing cooldown skips visible even when the remaining path then failed
      if (partialBefore) fallbackFrom.push({ engine, reason: partialBefore })
    }
  }

  const last = fallbackFrom.at(-1)?.engine ?? primary
  return {
    results: [],
    engine: last,
    fallbackFrom,
    ...(allBlocked && { blocked: true }),
  }
}
