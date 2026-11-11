/** One reading. `v: null` marks a gap (unavailable, unknown, not a number). */
export interface Point {
  /** Time, ms since the epoch. */
  t: number;
  v: number | null;
  /** Long-term statistics only: the period's lowest and highest. */
  min?: number | null;
  max?: number | null;
  /** The reading from before the range, moved to its start: the value then, not a new reading. */
  carried?: boolean;
  /** A grouped value: where its group ends (its `t` is where the group starts). */
  end?: number;
  /** Text series only (`SeriesRequest.text`): the state or attribute as written; `v` is then null. */
  s?: string;
}

/** Where a chart's readings come from. */
export type Source = 'history' | 'statistics';

/** The span a chart covers, ms since the epoch. */
export interface Range {
  start: number;
  end: number;
}

/** What to load for one series. */
export interface SeriesRequest {
  entity: string;
  /** Read this attribute instead of the state (history only). */
  attribute?: string;
  /** Keep the words ("heating", "idle") in `Point.s` instead of reading a number (history only). */
  text?: boolean;
  /** Read compass points (N, SSW) as degrees as well as numbers (history only; see `parseBearing`). */
  bearing?: boolean;
}
