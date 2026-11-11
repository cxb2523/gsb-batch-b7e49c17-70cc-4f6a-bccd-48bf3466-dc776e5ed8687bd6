import type { HomeAssistant } from '../types';
import { defaultStatisticsQuery, key, loadHistory, loadStatistics, readerFor, toPoint } from './fetch';
import type { StatisticsQuery } from './fetch';
import type { Point, Range, SeriesRequest, Source } from './types';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface Loaded {
  status: LoadStatus;
  /** Points per series key (see `key()`), oldest first, trimmed to the range. */
  data: Map<string, Point[]>;
  error?: string;
}

const STATISTICS_REFRESH_MS: Record<string, number> = {
  '5minute': 5 * 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 86_400_000,
  month: 86_400_000,
};

export interface GetOptions {
  /**
   * The range reaches the present, so new states belong in it (default true). A fixed past span
   * (an offset, or stepped back with the buttons) is loaded once and left alone.
   */
  live?: boolean;
  /** Statistics only: the period and columns to ask for (default: a period that fits the span). */
  statistics?: StatisticsQuery;
}

/**
 * One card's loaded history. It loads when what is asked for changes shape (entities, source,
 * statistics columns), or reaches outside what it has (a start earlier than it loaded from, or a
 * past span it loaded being left for a later one). A live range keeps up by itself: new states
 * from `hass` are appended and points older than the range are dropped, so a rolling chart never
 * refetches. Statistics have no live feed, so a live range reloads them once a period, on a timer,
 * and when the card comes back to the page; it keeps drawing the rows it has while they reload.
 * A past range gets neither: nothing new can happen in it.
 */
export class HistoryStore {
  private shape = '';
  private loadedFrom = Infinity;
  /** The end of what is loaded; Infinity while it is kept up to date with live states. */
  private loadedTo = -Infinity;
  private status: LoadStatus = 'loading';
  private error?: string;
  private data = new Map<string, Point[]>();
  /** The state object each series last took a point from, so one change is one point. */
  private seen = new Map<string, unknown>();
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  /** When the card left the page; a long absence means missed states, so reload. */
  private pausedAt?: number;
  /** Live statistics due a reload: the next period has been written. */
  private stale = false;

  constructor(private readonly onChange: () => void) {}

  get(hass: HomeAssistant, series: SeriesRequest[], range: Range, source: Source, options: GetOptions = {}): Loaded {
    const live = options.live ?? true;
    const query = source === 'statistics' ? (options.statistics ?? defaultStatisticsQuery(range)) : undefined;
    const shape = `${source}|${series.map(key).join(',')}|${query ? JSON.stringify(query) : ''}`;
    const away = this.pausedAt !== undefined && Date.now() - this.pausedAt > PAUSE_RELOAD_MS;
    const resumedStatistics = this.pausedAt !== undefined && source === 'statistics' && live;
    this.pausedAt = undefined;
    // A past span that still rolls with the clock (the last 7 days, a week ago) moves a little on
    // every redraw; reload once it has moved by a minute or 1 % of the span, not every time.
    const margin = Math.max(60_000, (range.end - range.start) / 100);
    const outside =
      range.start < this.loadedFrom || (live ? this.loadedTo !== Infinity : range.end > this.loadedTo + margin);
    if (shape !== this.shape || outside || (away && live) || resumedStatistics || this.stale) {
      // Statistics read again for the same span (the card came back to the page, which a masonry
      // view does whenever it re-lays out its columns, or the next period was written) keep
      // drawing what they have until the new rows land: blanking to "Loading" would rebuild the
      // chart and replay its draw-in every time.
      const refresh = shape === this.shape && !outside && source === 'statistics' && this.status === 'ready';
      this.shape = shape;
      this.stale = false;
      this.load(hass, series, range, live, query, refresh);
    }
    if (this.status === 'ready' && source === 'history' && this.loadedTo === Infinity) this.appendLive(hass, series);
    const data = new Map<string, Point[]>();
    for (const [k, points] of this.data) data.set(k, trim(points, range));
    return { status: this.status, data, error: this.error };
  }

  /**
   * The card left the page (masonry moves cards about, views switch): stop the refresh timer and
   * any pending redraw, but keep the readings for when it comes back.
   */
  pause(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pausedAt = Date.now();
  }

  /** Forget everything and stop the refresh timer. */
  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.shape = '';
    this.stale = false;
    this.loadedFrom = Infinity;
    this.loadedTo = -Infinity;
    this.generation++;
  }

  private load(
    hass: HomeAssistant,
    series: SeriesRequest[],
    range: Range,
    live: boolean,
    query: StatisticsQuery | undefined,
    refresh = false,
  ): void {
    const generation = ++this.generation;
    if (!refresh) this.status = 'loading';
    // Count the span as covered from the moment it is asked for, so redraws while it loads (or
    // after it fails) don't ask again.
    this.loadedFrom = range.start;
    this.loadedTo = live ? Infinity : range.end;
    clearTimeout(this.timer);
    const request = query ? loadStatistics(hass, series, range, query) : loadHistory(hass, series, range);
    request.then(
      (data) => {
        if (generation !== this.generation) return;
        this.data = data;
        this.status = 'ready';
        this.error = undefined;
        this.seen.clear();
        for (const s of series) this.seen.set(key(s), hass.states[s.entity]);
        if (query && live) this.refreshLater(query);
        this.onChange();
      },
      (err: unknown) => {
        if (generation !== this.generation) return;
        if (refresh) {
          // A refresh that fails keeps the rows it had, and tries again a period later.
          if (query && live) this.refreshLater(query);
          return;
        }
        this.status = 'error';
        this.error = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
        this.onChange();
      },
    );
  }

  /** Reload live statistics once the next period has been written. */
  private refreshLater(query: StatisticsQuery): void {
    this.timer = setTimeout(() => {
      this.stale = true;
      this.onChange();
    }, STATISTICS_REFRESH_MS[query.period]);
  }

  private appendLive(hass: HomeAssistant, series: SeriesRequest[]): void {
    for (const s of series) {
      const k = key(s);
      const state = hass.states[s.entity];
      if (!state || this.seen.get(k) === state) continue;
      this.seen.set(k, state);
      const t = Date.parse(state.last_updated ?? state.last_changed ?? '') || Date.now();
      const points = this.data.get(k) ?? [];
      const last = points[points.length - 1];
      if (last && t <= last.t) continue;
      points.push(toPoint(t, s.attribute ? state.attributes?.[s.attribute] : state.state, s.text, readerFor(s)));
      this.data.set(k, points);
    }
  }
}

/**
 * Points within the range. The last point before the start is kept, moved to the start and
 * marked `carried`, so a line begins at the left edge with the value it had then rather than at
 * the first change (and grouping knows it is not a reading taken in the range).
 */
export function trim(points: Point[], range: Range): Point[] {
  let first = 0;
  while (first < points.length && points[first].t < range.start) first++;
  const inside = points.slice(first).filter((p) => p.t <= range.end);
  const before = points[first - 1];
  return before ? [{ ...before, t: range.start, carried: true }, ...inside] : inside;
}

/** Away longer than this, a card reloads its history instead of carrying on. */
const PAUSE_RELOAD_MS = 60_000;

const stores = new WeakMap<HTMLElement, HistoryStore>();

/** The store for a card, made on first use; `onChange` redraws the card. */
export function storeFor(host: HTMLElement, onChange: () => void): HistoryStore {
  let store = stores.get(host);
  if (!store) {
    store = new HistoryStore(onChange);
    stores.set(host, store);
  }
  return store;
}

/** Pause a card's store when the card leaves the page. */
export function pauseStore(host: HTMLElement): void {
  stores.get(host)?.pause();
}
