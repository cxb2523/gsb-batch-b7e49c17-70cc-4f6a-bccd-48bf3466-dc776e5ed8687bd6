import type { CSSResult, SVGTemplateResult, TemplateResult } from 'lit';
import type { FieldBinding } from '../editor/schemas';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant, NormalizedConfig, ShowOptions, StyleName } from '../types';
import { area } from './area';
import { bar } from './bar';
import { box } from './box-plot';
import { bubble } from './bubble';
import { columnChart } from './column';
import { combined } from './combined';
import { heatmap } from './heatmap';
import { spiral } from './spiral';
import { histogram } from './histogram';
import { line } from './line';
import { needle } from './needle';
import { pictograph } from './pictograph';
import { pie } from './pie';
import { arc, ring } from './radial';
import { rings } from './rings';
import { scatter } from './scatter';
import { segmented } from './segmented';
import { tank } from './tank';
import { battery } from './battery';
import { thin } from './thin';
import { waffle } from './waffle';
import { funnel } from './funnel';
import { radar } from './radar';
import { polarArea } from './polar-area';
import { treemap } from './treemap';
import { marimekko } from './marimekko';
import { icicle, sunburst } from './sunburst';
import { groupedBars } from './grouped-bars';
import { bullet } from './bullet';
import { lollipop } from './lollipop';
import { waterfall } from './waterfall';
import { slope } from './slope';
import { dumbbell } from './dumbbell';
import { rangeArea } from './range-area';
import { sparklineStyle } from './sparkline';
import { streamgraph } from './streamgraph';
import { candlestick } from './candlestick';
import { violin } from './violin';
import { beeswarm } from './beeswarm';
import { stripPlot } from './strip-plot';
import { sankey } from './sankey';
import { chord } from './chord';
import { timeline } from './timeline';
import { climate } from './climate';
import { windRoseStyle } from './wind-rose';
import { day_clock } from './day-clock';
import { cyclePlot } from './cycle-plot';
import { trend } from './trend';

export interface RenderContext {
  show: ShowOptions;
  hass: HomeAssistant;
  /** Ask the card to draw again, for a value style that loads something (the gauges' ghost). */
  requestUpdate?(): void;
}

/** Where a style sits in the editor's style picker. */
export type StyleGroup = 'bars' | 'gauges' | 'history' | 'totals' | 'compare' | 'distribution';
export const STYLE_GROUPS: StyleGroup[] = ['bars', 'gauges', 'history', 'totals', 'compare', 'distribution'];

/** A style that draws each entity in its own row or tile. */
export interface ValueStyleModule {
  layout: 'rows' | 'tiles';
  group: StyleGroup;
  styles: CSSResult;
  /** The inside of one entity only; the card supplies the `.entity` wrapper. */
  render(e: ResolvedEntity, ctx: RenderContext): TemplateResult;
  /** Pixels per row (rows layout) or per tile (tiles layout), for sizing. */
  height: number;
  /** Tiles layout: tiles per row when `columns` is unset (default 3). */
  tilesPerRow?: number;
  /** Narrowest a column may get (px) before a set `columns` count drops to fewer. */
  minColumnWidth?: number;
}

/** What a whole-card style draws from. */
export interface ChartContext {
  /** The card's entities, resolved, sorted and limited, as for the value styles. */
  items: ResolvedEntity[];
  config: NormalizedConfig;
  /** The card's YAML, for options only this style reads. */
  raw: CardConfig;
  hass: HomeAssistant;
  /** Ask the card to draw again (after loading data, or on a pointer move). */
  requestUpdate(): void;
  /** The card element, for styles that measure or listen. */
  host: HTMLElement;
}

/** Extras for a style's own editor section. */
export interface ChartEditorContext {
  hass?: HomeAssistant;
  config: CardConfig;
  /** Replace the card config (the editor fires config-changed). */
  commit(config: CardConfig): void;
}

/**
 * A style that draws all the card's entities together, as one chart. Options only it reads stay
 * in the raw config: it checks them in `validate` and edits them in `editor`, so adding a chart
 * touches this registry and little else.
 */
export interface ChartStyleModule {
  layout: 'chart';
  group: StyleGroup;
  styles: CSSResult;
  render(ctx: ChartContext): TemplateResult;
  /** Estimated height in px, for masonry sizing. */
  height: number;
  /** Sections grid size, when not the full-width default (a small tile-like chart). */
  gridOptions?: { columns: number; min_columns: number; min_rows: number };
  /** A 64 × 40 picture for the style picker, in theme colours. */
  thumbnail(): SVGTemplateResult;
  /** Throw a readable Error for an invalid option this style reads. */
  validate?(raw: CardConfig): void;
  /** The editor's Chart section for this style. */
  editor?(ctx: ChartEditorContext): TemplateResult;
  /**
   * Options this style reads from each entity (a series colour, a group…), shown in that entity's
   * options in the editor. `config` is the card's, for fields whose default follows a card option.
   */
  entityFields?(hass: HomeAssistant | undefined, config: CardConfig): EntityFields;
  /** Entity ids, other than the card's own, whose changes should redraw it. */
  watch?(raw: CardConfig): string[];
  /** Called when the card leaves the page: stop subscriptions and timers. */
  disconnect?(host: HTMLElement): void;
}

/** A chart style's per-entity form: an ha-form schema and where each field lives on the entity. */
export interface EntityFields {
  schema: unknown[];
  fields: FieldBinding[];
}

export type StyleModule = ValueStyleModule | ChartStyleModule;

export function isChart(style: StyleModule): style is ChartStyleModule {
  return style.layout === 'chart';
}

export const STYLES: Record<StyleName, StyleModule> = {
  bar,
  thin,
  segmented,
  tank,
  battery,
  ring,
  needle,
  arc,
  line,
  column: columnChart,
  area,
  combined,
  pie,
  rings,
  pictograph,
  waffle,
  histogram,
  scatter,
  bubble,
  heatmap,
  spiral,
  box,
  funnel,
  radar,
  polar_area: polarArea,
  treemap,
  marimekko,
  sunburst,
  icicle,
  grouped_bars: groupedBars,
  bullet,
  lollipop,
  waterfall,
  slope,
  dumbbell,
  range_area: rangeArea,
  sparkline: sparklineStyle,
  streamgraph,
  candlestick,
  violin,
  beeswarm,
  strip_plot: stripPlot,
  sankey,
  chord,
  timeline,
  climate,
  wind_rose: windRoseStyle,
  day_clock,
  cycle_plot: cyclePlot,
  trend,
};
