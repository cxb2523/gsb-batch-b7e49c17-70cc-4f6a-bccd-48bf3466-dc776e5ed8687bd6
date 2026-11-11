import type { CardConfig, EntityConfig, HomeAssistant } from '../types';
import { key, toReading } from './fetch';
import { HistoryStore } from './store';
import type { Point, Range } from './types';

/**
 * Conditional series: an entity's `when` keeps only the readings taken while another entity is
 * in a state (or above / below a value). Readings outside are gaps, so the line, its groups, the
 * highs and lows and the tooltip all see the kept readings only. A `when` on the card applies to
 * every series without its own.
 *
 *   when: { entity: person.john, state: home }     # every series...
 *   entities:
 *     - entity: sensor.living_room_power
 *     - entity: sensor.flow_temp
 *       when: { entity: sensor.heat_pump_power, above: 50 }   # ...but this one
 */
export interface Condition {
  entity: string;
  /** The state (or one of the states) that counts. */
  state?: string | string[];
  /** The condition entity's value must be above this (and below `below`, when both are set). */
  above?: number;
  below?: number;
}

/** When the condition held: from each `t` on, until the next. */
export interface Flip {
  t: number;
  ok: boolean;
}

const isEntityId = (v: unknown): v is string => typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v.trim());

/** Throw a readable error for a bad `when` (`where` names it in the message). */
function validateWhen(when: unknown, where: (k: string) => string): void {
  if (when === undefined) return;
  if (typeof when !== 'object' || when === null || Array.isArray(when)) {
    throw new Error(`"${where('')}" must have an "entity"`);
  }
  const w = when as Record<string, unknown>;
  // Left blank (the editor fills the fields in one at a time), the condition is ignored.
  if (w.entity !== undefined && !isEntityId(w.entity)) throw new Error(`"${where('entity')}" must be an entity id`);
  const states = Array.isArray(w.state) ? w.state : w.state === undefined ? [] : [w.state];
  if (states.some((s) => typeof s !== 'string' && typeof s !== 'number')) {
    throw new Error(`"${where('state')}" must be a state or a list of states`);
  }
  for (const k of ['above', 'below']) {
    if (w[k] !== undefined && (typeof w[k] !== 'number' || !Number.isFinite(w[k]))) {
      throw new Error(`"${where(k)}" must be a number`);
    }
  }
}

/** Throw a readable error for a bad `when` on the card or any of its entities, or a bad drawing option. */
export function validateConditions(raw: CardConfig): void {
  validateWhen(raw.when, (k) => `when${k ? `.${k}` : ''}`);
  (raw.entities ?? []).forEach((e, i) => {
    if (typeof e !== 'object' || e === null) return;
    validateWhen((e as EntityConfig & { when?: unknown }).when, (k) => `entities[${i}].when${k ? `.${k}` : ''}`);
  });
  for (const k of ['when_ghost', 'when_strip']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
}

/** A `when` as a condition, or undefined when it is unusable (no entity, or nothing to test). */
function parseWhen(w: Partial<Condition> | undefined): Condition | undefined {
  if (!w || typeof w !== 'object' || !isEntityId(w.entity)) return undefined;
  // A list, or text with commas between ("home, work"), as the editor writes it.
  const list = Array.isArray(w.state) ? w.state : typeof w.state === 'string' ? w.state.split(',') : [w.state];
  const states = list
    .filter((s) => s !== undefined && s !== null)
    .map((s) => String(s).trim())
    .filter(Boolean);
  const out: Condition = { entity: w.entity.trim() };
  if (states.length) out.state = states;
  if (typeof w.above === 'number') out.above = w.above;
  if (typeof w.below === 'number') out.below = w.below;
  return out.state || out.above !== undefined || out.below !== undefined ? out : undefined;
}

/**
 * One entity's condition: its own `when`, else the card's (`card`), else undefined. A half-filled
 * own `when` does not hide the card's.
 */
export function conditionOf(config: EntityConfig, card?: CardConfig): Condition | undefined {
  return (
    parseWhen((config as EntityConfig & { when?: Partial<Condition> }).when) ??
    parseWhen(card?.when as Partial<Condition> | undefined)
  );
}

/** The entities the card's conditions read (its own `when` and its entities'), so their changes redraw it. */
export function conditionEntities(entities: readonly (string | EntityConfig)[], card?: CardConfig): string[] {
  const ids = new Set<string>();
  for (const e of entities) {
    const c = typeof e === 'object' && e !== null ? conditionOf(e) : undefined;
    if (c) ids.add(c.entity);
  }
  // Matched (include) entities have no `when` of their own: the card's applies to them.
  const own = parseWhen(card?.when as Partial<Condition> | undefined);
  if (own) ids.add(own.entity);
  return [...ids];
}

/** Two conditions test the same thing (so they share one strip). */
export const sameCondition = (a: Condition, b: Condition) => JSON.stringify(a) === JSON.stringify(b);

/** Whether one state of the condition entity meets the condition. */
export function meets(c: Condition, state: string | undefined): boolean {
  if (state === undefined) return false;
  if (c.state && !c.state.includes(state.trim())) return false;
  if (c.above !== undefined || c.below !== undefined) {
    const v = toReading(state);
    if (v === null) return false;
    if (c.above !== undefined && !(v > c.above)) return false;
    if (c.below !== undefined && !(v < c.below)) return false;
  }
  return true;
}

/** The condition entity's states (text points) as the moments the condition began and stopped holding. */
export function flips(c: Condition, states: readonly Point[]): Flip[] {
  const out: Flip[] = [];
  for (const p of states) {
    const ok = meets(c, p.s);
    if (out.length === 0 || out[out.length - 1].ok !== ok) out.push({ t: p.t, ok });
  }
  return out;
}

/** The stretches the condition held within `range`, as [start, end] pairs, up to `until`. */
export function heldSpans(changes: readonly Flip[], range: Range, until: number): [number, number][] {
  const out: [number, number][] = [];
  const stop = Math.min(range.end, until);
  changes.forEach((f, i) => {
    if (!f.ok) return;
    const start = Math.max(range.start, f.t);
    const end = Math.min(stop, i + 1 < changes.length ? changes[i + 1].t : stop);
    if (end > start) out.push([start, end]);
  });
  return out;
}

const known = (p: Point | undefined) => p !== undefined && (p.v !== null || p.s !== undefined);

/**
 * Keep the readings taken while the condition held; the rest become gaps. Where it starts to
 * hold, the value then in force is repeated (marked `carried`, as it is no new reading), and where
 * it stops, the line is carried on to that moment and broken, so a kept stretch is drawn edge to
 * edge. Before the condition's first known state nothing is kept.
 */
export function maskPoints(points: readonly Point[], changes: readonly Flip[]): Point[] {
  const out: Point[] = [];
  let ok = false;
  let cur: Point | undefined;
  let f = 0;
  const flip = ({ t, ok: next }: Flip) => {
    if (next === ok) return;
    ok = next;
    if (ok) {
      if (known(cur)) out.push({ ...cur!, t, carried: true });
      return;
    }
    if (known(out[out.length - 1])) {
      if (known(cur) && t > out[out.length - 1].t) out.push({ ...cur!, t, carried: true });
      out.push({ t, v: null });
    }
  };
  for (const p of points) {
    while (f < changes.length && changes[f].t <= p.t) flip(changes[f++]);
    if (ok) out.push(p);
    else if (known(out[out.length - 1])) out.push({ t: p.t, v: null });
    cur = p;
  }
  while (f < changes.length) flip(changes[f++]);
  return out;
}

export interface Conditions {
  /** The condition entities' history is still loading. */
  pending: boolean;
  /** Each condition entity's states over the range (text points), by entity id. */
  states: Map<string, Point[]>;
  /** The card, whose own `when` applies to series without one. */
  card?: CardConfig;
}

const stores = new WeakMap<HTMLElement, HistoryStore>();

/**
 * Load (or reuse) the history of every entity the series' conditions read, over `range`: one
 * extra store per card, kept up to date from `hass` while the range is live. Undefined when no
 * series has a condition. A failed load keeps nothing (every conditional series is a gap) rather
 * than showing readings it should hide.
 */
export function loadConditions(
  host: HTMLElement,
  hass: HomeAssistant,
  configs: readonly EntityConfig[],
  range: Range,
  live: boolean,
  onChange: () => void,
  card?: CardConfig,
): Conditions | undefined {
  // Only the entities a drawn series reads: the card's `when` counts once a series has none of its own.
  const ids = [...new Set(configs.map((c) => conditionOf(c, card)?.entity).filter((id): id is string => !!id))];
  if (ids.length === 0) return undefined;
  let store = stores.get(host);
  if (!store) {
    store = new HistoryStore(onChange);
    stores.set(host, store);
  }
  const requests = ids.map((entity) => ({ entity, text: true }));
  const loaded = store.get(hass, requests, range, 'history', { live });
  const states = new Map<string, Point[]>();
  requests.forEach((r) => states.set(r.entity, loaded.data.get(key(r)) ?? []));
  return { pending: loaded.status === 'loading', states, ...(card ? { card } : {}) };
}

/**
 * A chart that loads its own history (box plot, candlestick, day clock, wind rose): the
 * conditions of `ctx`'s series over `range`, and a status that stays `loading` until they are in.
 */
export function chartConditions(
  ctx: {
    host: HTMLElement;
    hass: HomeAssistant;
    items: readonly { config: EntityConfig }[];
    raw: CardConfig;
    requestUpdate(): void;
  },
  range: Range,
  live: boolean,
): Conditions | undefined {
  return loadConditions(
    ctx.host,
    ctx.hass,
    ctx.items.map((e) => e.config),
    range,
    live,
    ctx.requestUpdate,
    ctx.raw,
  );
}

/** A history status, held at `loading` while the conditions' history loads. */
export function conditionStatus<S extends string>(status: S, conditions: Conditions | undefined): S | 'loading' {
  return conditions?.pending && status === 'ready' ? 'loading' : status;
}

/**
 * One series' points with its condition applied (unchanged when it has none). While the
 * condition's history loads, nothing is kept: the frame shows "Loading" meanwhile.
 */
export function conditionalPoints(config: EntityConfig, points: Point[], conditions: Conditions | undefined): Point[] {
  const c = conditionOf(config, conditions?.card);
  if (!c || !conditions) return points;
  return maskPoints(points, flips(c, conditions.states.get(c.entity) ?? []));
}

/** The card draws the faint full series behind conditional ones (line and area charts). */
export const ghostOn = (raw: CardConfig) => raw.when_ghost === true;
/** The card draws a strip under the plot showing when each condition held (line and area charts). */
export const stripOn = (raw: CardConfig) => raw.when_strip === true;

/** Pause a card's condition history when it leaves the page. */
export function pauseConditions(host: HTMLElement): void {
  stores.get(host)?.pause();
}
