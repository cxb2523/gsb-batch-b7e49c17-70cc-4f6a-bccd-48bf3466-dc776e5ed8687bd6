import { forgetPlotted } from '../chart/export';
import { historyFrame } from '../chart/frame';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { ChartContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { OUT_FLOWS, periodTotal } from './energy';
import type { EnergyFlow, EnergyMarks } from './energy';
import { parsePeriod, periodRange } from './period';
import { zoneFor } from './timezone';

/*
 * A pie or Sankey of the Energy dashboard draws each flow's total over the card's period: the
 * long-term statistics' change, read by the hour (by the day past a month) and added up. Each
 * entity then carries its total as its value, so the pie and Sankey draw it as they would a
 * current reading. A Sankey's flows run from the sources (grid import, solar, battery out) into
 * the house, then out to the grid, the battery and each device; what the devices don't account
 * for is drawn as one more flow.
 */

const DAY_MS = 86_400_000;
/** Spans longer than this are read by the day rather than the hour. */
const HOURLY_UP_TO_MS = 32 * DAY_MS;

const SOURCE_FLOWS: EnergyFlow[] = ['grid_import', 'solar', 'battery_out'];

/** An entity carrying a total as its value, formatted as the entity is; '' with no readings. */
export function withTotal(e: ResolvedEntity, total: number | null, hass: HomeAssistant | undefined): ResolvedEntity {
  const available = total !== null;
  const valueText = available ? formatNumber(total, e.decimals, hass) : '';
  const display = available ? withUnit(valueText, e.unit) : '';
  return { ...e, available, value: total, valueText, display, label: display ? `${e.name}, ${display}` : e.name };
}

/**
 * Where each energy entity runs in a Sankey: sources into the house, the rest out of it. An
 * entity the card lists itself keeps its own `from` and `to`. The energy that comes in and isn't
 * accounted for going out becomes one more flow (untracked use, or simply "used at home" when
 * the card draws no devices), so the house node balances.
 */
export function sankeyItems(items: ResolvedEntity[], hass: HomeAssistant | undefined): ResolvedEntity[] {
  const home = localize(hass, 'energy_node_home');
  let into = 0;
  let out = 0;
  let devices = false;
  const placed = items.map((e) => {
    const flow = (e.config as EnergyMarks).energy_flow;
    if (!flow) return e;
    const v = e.value ?? 0;
    const flowName = localize(hass, `energy_flow_${flow}`);
    let ends: { from: string; to: string };
    if (SOURCE_FLOWS.includes(flow)) {
      into += v;
      ends = { from: flowName, to: home };
    } else {
      out += v;
      if (flow === 'devices') devices = true;
      ends = { from: home, to: OUT_FLOWS.includes(flow) ? flowName : e.name };
    }
    return { ...e, config: { ...e.config, ...ends } };
  });
  const rest = into - out;
  const first = placed.find((e) => (e.config as EnergyMarks).energy_flow);
  // Less than a thousandth of what came in is rounding, not use.
  if (!first || !(rest > into * 0.001)) return placed;
  const name = localize(hass, devices ? 'energy_node_untracked' : 'energy_node_home_use');
  const none = { action: 'none' };
  const config = {
    ...first.config,
    entity: '',
    name,
    from: home,
    to: name,
    color: 'grey',
    statistic: true,
    energy_flow: undefined,
    tap_action: none,
    hold_action: none,
    double_tap_action: none,
  };
  return [...placed, { ...withTotal({ ...first, name }, rest, hass), entityId: '', stateObj: undefined, config }];
}

/** The grouping a span's totals are read with: hours, or days past a month. */
export function totalsGrouping(raw: CardConfig, hass: HomeAssistant | undefined, now = Date.now()): 'hour' | 'day' {
  const span = periodRange(parsePeriod(raw.period as CardConfig['period']), now, zoneFor(hass));
  return span.end - span.start > HOURLY_UP_TO_MS ? 'day' : 'hour';
}

/**
 * The pie's or Sankey's entities with their totals over the card's period, or a message while
 * the statistics load (or when they can't).
 */
export function energyTotals(
  ctx: ChartContext,
  now = Date.now(),
): { items: ResolvedEntity[]; message?: undefined } | { message: string; error?: boolean } {
  const raw: CardConfig = {
    ...ctx.raw,
    source: 'statistics',
    group_by: totalsGrouping(ctx.raw, ctx.hass, now),
    aggregate: 'change',
  };
  const frame = historyFrame({ ...ctx, raw }, now);
  // The chart draws the totals, not these readings: its CSV lists the totals (the card's items).
  forgetPlotted(ctx.host);
  if (frame.status === 'loading') return { message: localize(ctx.hass, 'chart_loading') };
  if (frame.status === 'error') {
    return { message: localize(ctx.hass, 'chart_error', { error: frame.error ?? '' }), error: true };
  }
  let items = frame.series.map((s) => withTotal(s.entity, periodTotal(s.points), ctx.hass));
  const sort = ctx.config.sort;
  if (sort !== 'none') {
    const dir = sort === 'ascending' ? 1 : -1;
    items = [...items].sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return ((a.value ?? 0) - (b.value ?? 0)) * dir;
    });
  }
  if (ctx.config.style === 'sankey') items = sankeyItems(items, ctx.hass);
  return { items };
}
