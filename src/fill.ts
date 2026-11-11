import type { HassEntity, HomeAssistant } from './types';

/** What a rule can match on. `entity` is only meaningful in `exclude`. */
export const RULE_KEYS = ['label', 'area', 'floor', 'device_class', 'domain', 'entity'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export type Rule = Partial<Record<RuleKey, string[]>>;

/** A rule from YAML: each key takes one value or a list. Empty keys are dropped; no keys at all is no rule. */
export function normalizeRule(raw: unknown, field: 'include' | 'exclude'): Rule | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`"${field}" must list what to match, such as "area" or "device_class"`);
  }
  const allowed = field === 'include' ? RULE_KEYS.filter((k) => k !== 'entity') : RULE_KEYS;
  const rule: Rule = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(allowed as readonly string[]).includes(key)) {
      throw new Error(`"${field}" can't match on "${key}". Use: ${allowed.join(', ')}`);
    }
    const list = (Array.isArray(value) ? value : [value]).filter((v) => v !== undefined && v !== null && v !== '');
    if (list.some((v) => typeof v !== 'string')) throw new Error(`"${field}.${key}" must be text or a list of text`);
    if (list.length) rule[key as RuleKey] = list as string[];
  }
  return Object.keys(rule).length ? rule : undefined;
}

/** States with a number to show, plus the two that mean "no number right now". */
function hasNumber(state: HassEntity): boolean {
  const s = state.state;
  if (s === 'unavailable' || s === 'unknown') return true;
  return s.trim() !== '' && Number.isFinite(Number(s));
}

interface Facts {
  label: string[];
  area?: string;
  floor?: string;
  device_class?: string;
  domain: string;
  entity: string;
}

/** Everything a rule can test, from the state and the entity, device and area registries. */
function factsFor(state: HassEntity, hass: HomeAssistant): Facts {
  const id = state.entity_id;
  const entry = hass.entities?.[id];
  const device = entry?.device_id ? hass.devices?.[entry.device_id] : undefined;
  const area = entry?.area_id ?? device?.area_id ?? undefined;
  const deviceClass = state.attributes?.device_class;
  return {
    label: [...(entry?.labels ?? []), ...(device?.labels ?? [])],
    area,
    floor: area ? (hass.areas?.[area]?.floor_id ?? undefined) : undefined,
    device_class: typeof deviceClass === 'string' ? deviceClass : undefined,
    domain: id.slice(0, id.indexOf('.')),
    entity: id,
  };
}

function hits(rule: Rule, key: RuleKey, facts: Facts): boolean {
  const wanted = rule[key]!;
  const have = facts[key];
  return Array.isArray(have) ? have.some((v) => wanted.includes(v)) : have !== undefined && wanted.includes(have);
}

/** Include: every key it sets must match (any of that key's values). */
function included(rule: Rule, facts: Facts): boolean {
  return (Object.keys(rule) as RuleKey[]).every((key) => hits(rule, key, facts));
}

/** Exclude: any key matching is enough. */
function excluded(rule: Rule | undefined, facts: Facts): boolean {
  return !!rule && (Object.keys(rule) as RuleKey[]).some((key) => hits(rule, key, facts));
}

interface Memo {
  exclude?: Rule;
  states: unknown;
  entities: unknown;
  devices: unknown;
  areas: unknown;
  ids: string[];
}

/** One remembered result per card (each card's normalized include rule is its own object). */
const memos = new WeakMap<Rule, Memo>();

/**
 * Entity ids matching `include` and not `exclude`, by name. Only entities with a number to show
 * (or none yet) match, and never ones hidden in the registry. The last result is reused while
 * the rules and the hass objects it read are the same, since every card update asks again.
 */
export function matchEntities(include: Rule, exclude: Rule | undefined, hass: HomeAssistant): string[] {
  const memo = memos.get(include);
  if (
    memo &&
    memo.exclude === exclude &&
    memo.states === hass.states &&
    memo.entities === hass.entities &&
    memo.devices === hass.devices &&
    memo.areas === hass.areas
  ) {
    return memo.ids;
  }
  const found: { id: string; name: string }[] = [];
  for (const state of Object.values(hass.states)) {
    if (!hasNumber(state) || hass.entities?.[state.entity_id]?.hidden) continue;
    const facts = factsFor(state, hass);
    if (!included(include, facts) || excluded(exclude, facts)) continue;
    const name = state.attributes?.friendly_name;
    found.push({ id: state.entity_id, name: typeof name === 'string' && name ? name : state.entity_id });
  }
  found.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  const ids = found.map((f) => f.id);
  memos.set(include, {
    exclude,
    states: hass.states,
    entities: hass.entities,
    devices: hass.devices,
    areas: hass.areas,
    ids,
  });
  return ids;
}
