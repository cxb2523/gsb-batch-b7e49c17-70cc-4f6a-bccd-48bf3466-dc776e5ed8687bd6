import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// No network and no browser: these tests exercise the search chain's bookkeeping only.
const { fetchHttp, withPage, cacheGet, cacheSet } = vi.hoisted(() => ({
  fetchHttp: vi.fn(),
  withPage: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}))

vi.mock('../../src/core/fetcher/http-fetcher.js', () => ({
  fetchHttp,
  resolveRedirect: vi.fn(async () => null),
}))
vi.mock('../../src/core/fetcher/browser-fetcher.js', () => ({ withPage }))
vi.mock('../../src/lib/cache.js', () => ({ cacheGet, cacheSet }))
vi.mock('../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}))

import type { SearchResult } from '../../src/core/extractor/search-extractor.js'
import {
  webSearch,
  searchCacheKey,
  setSearchClock,
  markStrategyBlocked,
  resetSearchState,
  searchStatus,
  SEARCH_BLOCK_COOLDOWN_MS,
} from '../../src/core/search/web-search.js'
import { config } from '../../src/lib/config.js'

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)

const DDG_RESULTS: SearchResult[] = [
  { title: 'Cached DuckDuckGo result', url: 'https://example.com/cached', snippet: 'From cache', position: 1 },
]

const opts = { query: 'cooling chain', limit: 5 } as const

beforeEach(() => {
  vi.clearAllMocks()
  resetSearchState()
  setSearchClock(() => NOW)
  // Pin the chain used by every test: Google first, DuckDuckGo as fallback
  config.SEARCH_ENGINE = 'google'
  config.SEARCH_FALLBACK = true
  config.SEARCH_CACHE_TTL_SECONDS = 3600
  cacheGet.mockResolvedValue(null)
})

afterEach(() => {
  resetSearchState()
})

describe('webSearch cooldown reporting', () => {
  it('serves a cached fallback result while Google cools down and says why Google was skipped', async () => {
    // Google CAPTCHA'd earlier: both Google paths are in their 10 minute cooldown
    markStrategyBlocked('google-http')
    markStrategyBlocked('google-browser')
    // One minute later DuckDuckGo has a cached answer for this query
    const later = NOW + 60_000
    setSearchClock(() => later)

    cacheGet.mockImplementation(async (key: string) =>
      key === searchCacheKey('duckduckgo', opts) ? DDG_RESULTS : null,
    )

    const res = await webSearch({ ...opts })

    expect(res.cached).toBe(true)
    expect(res.engine).toBe('duckduckgo')
    expect(res.results).toEqual(DDG_RESULTS)
    expect(res.blocked).toBeUndefined()

    const skip = res.fallbackFrom?.find((f) => f.engine === 'google')
    expect(skip).toBeDefined()
    const reason = skip?.reason ?? ''
    // Readable skip reason: engine is cooling down, with a cooldown end / remaining time
    expect(reason).toMatch(/cooling down/i)
    expect(reason).toContain(new Date(NOW + SEARCH_BLOCK_COOLDOWN_MS).toISOString())
    expect(reason).toMatch(/retry in 9m/)
    // Not disguised as a network / fetch failure
    expect(reason).not.toMatch(/captcha page|network|fetch failed|ECONN|socket/i)
    // Nothing was fetched: Google was skipped, DuckDuckGo came from cache
    expect(fetchHttp).not.toHaveBeenCalled()
    expect(withPage).not.toHaveBeenCalled()
  })

  it('reports a cooling-down engine when the fallback engine answers from the network', async () => {
    markStrategyBlocked('google-http')
    markStrategyBlocked('google-browser')
    fetchHttp.mockResolvedValue({
      html: '<div class="result"><a class="result__a" href="https://example.com/live">Live</a><a class="result__snippet">Live snippet</a></div>',
      statusCode: 200,
      headers: {},
      url: 'https://html.duckduckgo.com/html/?q=cooling',
    })

    const res = await webSearch({ ...opts })

    expect(res.engine).toBe('duckduckgo')
    expect(res.cached).toBeUndefined()
    expect(res.fallbackFrom?.[0]?.engine).toBe('google')
    expect(res.fallbackFrom?.[0]?.reason).toMatch(/cooling down/i)
  })

  it('explains the skipped primary even when it is not the one cooling down', async () => {
    // Google is healthy but has no cached answer; DuckDuckGo does
    cacheGet.mockImplementation(async (key: string) =>
      key === searchCacheKey('duckduckgo', opts) ? DDG_RESULTS : null,
    )

    const res = await webSearch({ ...opts })

    expect(res.cached).toBe(true)
    expect(res.engine).toBe('duckduckgo')
    expect(res.fallbackFrom).toEqual([
      { engine: 'google', reason: expect.stringMatching(/cached answer from duckduckgo/i) },
    ])
    // A cached answer still beats a fresh network attempt
    expect(fetchHttp).not.toHaveBeenCalled()
  })

  it('notes the cooling path of the engine that served the cache hit', async () => {
    // Google answers from cache, but its plain-HTTP path is still cooling down
    markStrategyBlocked('google-http')
    const googleResults: SearchResult[] = [
      { title: 'Cached Google result', url: 'https://example.com/google-cache', snippet: 'From cache', position: 1 },
    ]
    cacheGet.mockImplementation(async (key: string) => (key === searchCacheKey('google', opts) ? googleResults : null))

    const res = await webSearch({ ...opts })

    expect(res.engine).toBe('google')
    expect(res.cached).toBe(true)
    expect(res.results).toEqual(googleResults)
    expect(res.fallbackFrom).toEqual([
      { engine: 'google', reason: expect.stringMatching(/skipped google-http: .*cooling down.*retry in 10m/i) },
    ])
    expect(fetchHttp).not.toHaveBeenCalled()
    expect(withPage).not.toHaveBeenCalled()
  })

  it('notes a single cooling path when the other path of the same engine still answers', async () => {
    // Only the plain-HTTP Google path is cooling down; the browser path is still healthy
    markStrategyBlocked('google-http')
    const basicHtml = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'google-basic.html'), 'utf8')
    withPage.mockImplementation(async (fn: (page: unknown) => Promise<unknown>) =>
      fn({
        goto: async () => null,
        waitForSelector: async () => null,
        content: async () => basicHtml,
        url: () => 'https://www.google.com/search?q=cooling',
      }),
    )

    const res = await webSearch({ ...opts })

    expect(res.engine).toBe('google')
    expect(res.results.length).toBeGreaterThan(0)
    const note = res.fallbackFrom?.find((f) => f.engine === 'google')
    expect(note?.reason).toMatch(/skipped google-http/i)
    expect(note?.reason).toContain(new Date(NOW + SEARCH_BLOCK_COOLDOWN_MS).toISOString())
    // The cooling path was not probed and is reported as a skip, not a fetch failure
    expect(fetchHttp).not.toHaveBeenCalled()
    expect(note?.reason).not.toMatch(/captcha page|network|fetch failed|ECONN|socket/i)
  })

  it('reports a genuine CAPTCHA as a blocked attempt, not as a cooldown skip', async () => {
    const captchaHtml = '<html><body>Our systems have detected unusual traffic from your computer network.</body></html>'
    fetchHttp.mockResolvedValue({
      html: captchaHtml,
      statusCode: 200,
      headers: {},
      url: 'https://www.google.com/search?q=cooling',
    })
    // Both Google paths hit the CAPTCHA page, so both go into cooldown
    withPage.mockImplementation(async (fn: (page: unknown) => Promise<unknown>) =>
      fn({
        goto: async () => null,
        waitForSelector: async () => null,
        content: async () => captchaHtml,
        url: () => 'https://www.google.com/sorry/index',
      }),
    )

    const res = await webSearch({ ...opts })

    expect(res.engine).toBe('duckduckgo')
    const google = res.fallbackFrom?.find((f) => f.engine === 'google')
    expect(google?.reason).toMatch(/captcha/i)
    expect(google?.reason).not.toMatch(/cooling down/i)
    // The CAPTCHA put both Google paths into cooldown for /health
    expect(searchStatus()['google-http']).toMatch(/^blocked until /)
    expect(searchStatus()['google-browser']).toMatch(/^blocked until /)
  })

  it('keeps blocked: true with empty results when every engine is cooling down', async () => {
    markStrategyBlocked('google-http')
    markStrategyBlocked('google-browser')
    markStrategyBlocked('duckduckgo')
    const later = NOW + 5 * 60_000
    setSearchClock(() => later)

    const res = await webSearch({ ...opts })

    expect(res.blocked).toBe(true)
    expect(res.results).toEqual([])
    expect(res.cached).toBeUndefined()
    // Both engines are reported as deliberately skipped, with cooldown details and no network attempt
    const skipped = res.fallbackFrom ?? []
    expect(skipped).toHaveLength(2)
    for (const entry of skipped) {
      expect(entry.reason).toMatch(/cooling down/i)
      expect(entry.reason).toMatch(/retry in 5m/)
    }
    expect(skipped.map((f) => f.engine)).toEqual(['google', 'duckduckgo'])
    expect(fetchHttp).not.toHaveBeenCalled()
    expect(withPage).not.toHaveBeenCalled()
  })

  it('keeps blocked: true when every engine returns a bot check', async () => {
    const captchaHtml = '<html><body>Our systems have detected unusual traffic from your computer network.</body></html>'
    const anomalyHtml = '<div class="anomaly-modal">bots</div>'
    // Google's HTTP path hits a CAPTCHA, DuckDuckGo answers with its anomaly page
    fetchHttp.mockImplementation(async (url: string) => ({
      html: url.includes('duckduckgo') ? anomalyHtml : captchaHtml,
      statusCode: 200,
      headers: {},
      url,
    }))
    // Google's browser path would show the CAPTCHA too, but the HTTP path already put Google in cooldown
    withPage.mockImplementation(async (fn: (page: unknown) => Promise<unknown>) =>
      fn({
        goto: async () => null,
        waitForSelector: async () => null,
        content: async () => captchaHtml,
        url: () => 'https://www.google.com/sorry/index',
      }),
    )

    const res = await webSearch({ ...opts })

    expect(res.blocked).toBe(true)
    expect(res.results).toEqual([])
    expect(res.cached).toBeUndefined()
    // Every engine is accounted for and the reasons are real failures, not cooldown skips
    expect(res.fallbackFrom?.map((f) => f.engine)).toEqual(['google', 'duckduckgo'])
    expect(res.fallbackFrom?.[0]?.reason).toMatch(/captcha/i)
    expect(res.fallbackFrom?.[1]?.reason).toMatch(/anomaly/i)
  })

  it('retries the primary engine once its cooldown window has passed', async () => {
    markStrategyBlocked('google-http')
    markStrategyBlocked('google-browser')
    // Past the 10 minute window the clock seam makes the cooldown expire without sleeping
    setSearchClock(() => NOW + SEARCH_BLOCK_COOLDOWN_MS + 1_000)
    fetchHttp.mockResolvedValue({
      html: '<div class="Gx5Zad"><a href="/url?q=https://example.com/primary&amp;sa=U"><h3>Primary hit</h3></a><div class="VwiC3b">Primary snippet</div></div>',
      statusCode: 200,
      headers: {},
      url: 'https://www.google.com/search?q=cooling',
    })

    const res = await webSearch({ ...opts })

    expect(res.engine).toBe('google')
    expect(res.fallbackFrom).toBeUndefined()
    expect(searchStatus()['google-http']).toBe('ok')
    expect(searchStatus()['google-browser']).toBe('ok')
    expect(fetchHttp).toHaveBeenCalled()
  })

  it('returns the primary engine uncached when it is not cooling down', async () => {
    fetchHttp.mockResolvedValue({
      html: '<div class="Gx5Zad"><a href="/url?q=https://example.com/primary&amp;sa=U"><h3>Primary hit</h3></a><div class="VwiC3b">Primary snippet</div></div>',
      statusCode: 200,
      headers: {},
      url: 'https://www.google.com/search?q=cooling',
    })

    const res = await webSearch({ ...opts })

    expect(res.engine).toBe('google')
    expect(res.cached).toBeUndefined()
    expect(res.fallbackFrom).toBeUndefined()
    expect(res.results[0]?.url).toBe('https://example.com/primary')
  })
})
