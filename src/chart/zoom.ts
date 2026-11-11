import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { localize } from '../localize';
import type { Point, Range } from '../history/types';
import type { ChartContext } from '../styles/index';
import type { CardConfig } from '../types';
import { formatDateTime } from './axes';
import { VIEW_W } from './frame';
import type { ChartSeries, HistoryFrame } from './frame';
import type { Gestures } from './grid';
import { runs } from './paths';
import { extent, linear, padDomain } from './scale';
import { downsample } from './downsample';
import type { Hover } from './tooltip';

/** The part of a chart's span on show, as fractions of it: 0–1 is all of it. */
export interface ZoomWindow {
  from: number;
  to: number;
}

export const FULL: ZoomWindow = { from: 0, to: 1 };

/** Drawing height of the overview strip's coordinate box. */
export const OVERVIEW_H = 40;
/** Points per series in the overview: it is small, so a rough line is enough. */
const OVERVIEW_POINTS = 200;
/** A mouse press moving less than this (px) is a click, not a drag. */
const DRAG_PX = 4;
/** Two taps closer than this (ms) are a double tap. */
const DOUBLE_TAP_MS = 300;
/** Grab distance either side of a brush edge, in px. */
const HANDLE_PX = 10;

export interface ZoomOptions {
  /** Pinch, Ctrl + scroll and drag on the plot. */
  zoom: boolean;
  /** The overview strip under the chart, with a draggable window. */
  overview: boolean;
}

export function validateZoomOptions(raw: CardConfig): void {
  for (const k of ['zoom', 'overview']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
}

export function zoomOptions(raw: CardConfig): ZoomOptions {
  return { zoom: raw.zoom === true, overview: raw.overview === true };
}

// ---------------------------------------------------------------- maths

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep a window inside the span and no narrower than `minSpan` (a fraction). */
export function clampWindow(w: ZoomWindow, minSpan: number): ZoomWindow {
  const min = clamp(minSpan, 0, 1);
  let span = clamp(w.to - w.from, min, 1);
  if (!Number.isFinite(span)) span = 1;
  const from = clamp(Number.isFinite(w.from) ? w.from : 0, 0, 1 - span);
  return { from, to: from + span };
}

/** Whether a window shows less than the whole span. */
export function isZoomed(w: ZoomWindow): boolean {
  return w.from > 1e-9 || w.to < 1 - 1e-9;
}

/**
 * Zoom by `factor` (over 1 zooms in) about the point `at` of the way across the visible window,
 * so the time under the pointer stays under it.
 */
export function zoomAt(w: ZoomWindow, at: number, factor: number, minSpan: number): ZoomWindow {
  const span = w.to - w.from;
  const pivot = w.from + clamp(at, 0, 1) * span;
  const next = clamp(span / factor, minSpan, 1);
  const from = pivot - clamp(at, 0, 1) * next;
  return clampWindow({ from, to: from + next }, minSpan);
}

/** Move a window by `delta` (a fraction of the whole span), stopping at either end. */
export function panBy(w: ZoomWindow, delta: number): ZoomWindow {
  const span = w.to - w.from;
  const from = clamp(w.from + delta, 0, 1 - span);
  return { from, to: from + span };
}

/**
 * Two fingers: the moments under each finger when they went down stay under them as they move.
 * `start` and `now` are the fingers' positions as fractions of the plot's width.
 */
export function pinchWindow(
  w0: ZoomWindow,
  start: [number, number],
  now: [number, number],
  minSpan: number,
): ZoomWindow {
  const span0 = w0.to - w0.from;
  const ta = w0.from + start[0] * span0;
  const tb = w0.from + start[1] * span0;
  const gap = now[1] - now[0];
  // Fingers crossed or together: keep the zoom, follow their middle.
  if (Math.abs(gap) < 0.02 || Math.abs(start[1] - start[0]) < 0.02) {
    return panBy(w0, -(((now[0] + now[1]) / 2 - (start[0] + start[1]) / 2) * span0));
  }
  const span = clamp((tb - ta) / gap, minSpan, 1);
  const from = ta - now[0] * span;
  return clampWindow({ from, to: from + span }, minSpan);
}

/** The window made by dragging from `a` to `b` (fractions of the visible window). */
export function selectWindow(w: ZoomWindow, a: number, b: number, minSpan: number): ZoomWindow {
  const span = w.to - w.from;
  const lo = w.from + clamp(Math.min(a, b), 0, 1) * span;
  const hi = w.from + clamp(Math.max(a, b), 0, 1) * span;
  if (hi - lo >= minSpan) return { from: lo, to: hi };
  const mid = (lo + hi) / 2;
  return clampWindow({ from: mid - minSpan / 2, to: mid + minSpan / 2 }, minSpan);
}

/** The times a window covers. */
export function windowRange(range: Range, w: ZoomWindow): Range {
  const span = range.end - range.start;
  return { start: range.start + w.from * span, end: range.start + w.to * span };
}

/**
 * The points a zoomed chart needs: those inside `view`, and one either side so its lines run on
 * to the edges. Points are sorted by time.
 */
export function visiblePoints(points: Point[], view: Range): Point[] {
  if (points.length === 0) return points;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    // A grouped point covers `t` to `end`: it is visible while any of it is.
    if ((points[mid].end ?? points[mid].t) < view.start) lo = mid + 1;
    else hi = mid;
  }
  const first = Math.max(0, lo - 1);
  let last = lo;
  while (last < points.length && points[last].t <= view.end) last++;
  const out = points.slice(first, Math.min(points.length, last + 1));
  return out.length === points.length ? points : out;
}

// ---------------------------------------------------------------- state

type Gesture =
  | { kind: 'pan' | 'select'; x0: number; w0: ZoomWindow; moved: boolean; px: number }
  | { kind: 'pinch'; w0: ZoomWindow; start: [number, number] }
  | { kind: 'left' | 'right' | 'move' | 'new'; f0: number; w0: ZoomWindow; moved: boolean; px: number };

interface ZoomState {
  key: string;
  window: ZoomWindow;
  /** Pointers down on the plot: id → x as a fraction of the plot's width. */
  pointers: Map<number, number>;
  gesture?: Gesture;
  /** A drag-to-zoom in progress, as fractions of the plot. */
  select?: [number, number];
  lastTap?: { at: number; x: number };
}

const states = new WeakMap<HTMLElement, ZoomState>();

function stateOf(host: HTMLElement, key: string): ZoomState {
  let s = states.get(host);
  if (!s || s.key !== key) {
    // A different span (stepped back, or the period changed): start from all of it.
    s = { key, window: FULL, pointers: new Map() };
    states.set(host, s);
  }
  return s;
}

/** Forget a card's zoom (it leaves the page). */
export function stopZoom(host: HTMLElement): void {
  states.delete(host);
}

/** Whether a pan, pinch or drag is under way: the tooltip steps aside meanwhile. */
export function zoomBusy(host: HTMLElement): boolean {
  const g = states.get(host)?.gesture;
  return !!g && (g.kind === 'pinch' || ('moved' in g && g.moved));
}

/** What a chart shows once zoomed: the window, the times it covers, and how to change it. */
export interface ZoomView {
  options: ZoomOptions;
  window: ZoomWindow;
  zoomed: boolean;
  /** The times on show (all of `frame.range` when not zoomed). */
  range: Range;
  /** Smallest window, as a fraction of the span. */
  minSpan: number;
  /** The window now, which may have moved since this view was made (events between draws). */
  current(): ZoomWindow;
  set(w: ZoomWindow): void;
  reset(): void;
}

/** Shortest span a chart can zoom to, in ms: two groups when grouped, else a few minutes. */
export function minZoomMs(frame: Pick<HistoryFrame, 'group'>): number {
  const unit = { hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };
  return frame.group ? 2 * unit[frame.group.unit] : 5 * 60_000;
}

/**
 * The card's zoom over `frame`. It lives on the card, not in its config, and starts again from
 * the whole span when the span itself changes (previous / next, or a new period).
 */
export function zoomView(ctx: ChartContext, frame: HistoryFrame): ZoomView {
  const options = zoomOptions(ctx.raw);
  const total = frame.range.end - frame.range.start;
  const minSpan = total > 0 ? Math.min(1, minZoomMs(frame) / total) : 1;
  const key = `${JSON.stringify(frame.period)}|${frame.back}|${frame.group?.unit ?? ''}|${frame.source}`;
  const state = stateOf(ctx.host, key);
  if (!options.zoom && !options.overview) state.window = FULL;
  const window = clampWindow(state.window, minSpan);
  const set = (w: ZoomWindow) => {
    const next = clampWindow(w, minSpan);
    if (next.from === state.window.from && next.to === state.window.to) return;
    state.window = next;
    ctx.requestUpdate();
  };
  return {
    options,
    window,
    zoomed: isZoomed(window),
    range: windowRange(frame.range, window),
    minSpan,
    current: () => clampWindow(state.window, minSpan),
    set,
    reset: () => set(FULL),
  };
}

// ---------------------------------------------------------------- the plot's gestures

const fracOf = (ev: PointerEvent | WheelEvent | MouseEvent) => {
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    f: rect.width > 0 ? clamp((ev.clientX - rect.left) / rect.width, 0, 1) : 0,
    width: rect.width,
  };
};

/** Keep getting a pointer's moves once it leaves the element (not for synthetic pointers). */
function capture(ev: PointerEvent): void {
  try {
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  } catch {
    // No such active pointer: nothing to capture.
  }
}

/** A hover `leave` that hides the tooltip at once (a mouse leaving), whatever the pointer was. */
const hideHover = (hover: Hover | undefined) => hover?.leave({ pointerType: 'mouse' } as PointerEvent);

/**
 * Pointer, wheel and double-click handlers for the plot, wrapping the tooltip's: a mouse drag
 * selects a span to zoom into (or pans once zoomed), two fingers pinch and pan, Ctrl + scroll
 * (or a trackpad pinch) zooms about the pointer, sideways scroll pans, and a double click or
 * double tap goes back to the whole span. One finger still scrubs the tooltip, and up and down
 * still scroll the page.
 */
export function zoomGestures(ctx: ChartContext, view: ZoomView, hover?: Hover): Gestures {
  const state = states.get(ctx.host)!;
  const end = () => {
    state.gesture = undefined;
    if (state.select) {
      state.select = undefined;
      ctx.requestUpdate();
    }
  };
  return {
    down(ev) {
      const { f, width } = fracOf(ev);
      state.pointers.set(ev.pointerId, f);
      if (state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        state.gesture = { kind: 'pinch', w0: view.current(), start: a <= b ? [a, b] : [b, a] };
        state.select = undefined;
        hideHover(hover);
        return;
      }
      if (state.pointers.size > 2) return;
      if (ev.pointerType === 'mouse' && ev.button === 0) {
        const w0 = view.current();
        state.gesture = { kind: isZoomed(w0) ? 'pan' : 'select', x0: f, w0, moved: false, px: width };
        capture(ev);
      }
      hover?.move(ev);
    },
    move(ev) {
      if (!state.pointers.has(ev.pointerId)) {
        hover?.move(ev);
        return;
      }
      const { f } = fracOf(ev);
      state.pointers.set(ev.pointerId, f);
      const g = state.gesture;
      if (g?.kind === 'pinch') {
        if (state.pointers.size < 2) return;
        const [a, b] = [...state.pointers.values()];
        view.set(pinchWindow(g.w0, g.start, a <= b ? [a, b] : [b, a], view.minSpan));
        return;
      }
      if (g && (g.kind === 'pan' || g.kind === 'select')) {
        if (!g.moved && Math.abs(f - g.x0) * g.px < DRAG_PX) {
          hover?.move(ev);
          return;
        }
        if (!g.moved) hideHover(hover);
        g.moved = true;
        if (g.kind === 'pan') {
          view.set(panBy(g.w0, -(f - g.x0) * (g.w0.to - g.w0.from)));
        } else {
          state.select = [g.x0, f];
          ctx.requestUpdate();
        }
        return;
      }
      hover?.move(ev);
    },
    up(ev) {
      const { f, width } = fracOf(ev);
      const g = state.gesture;
      state.pointers.delete(ev.pointerId);
      if (g?.kind === 'pinch') {
        // The second finger lifting ends the pinch; the first doesn't then start scrubbing.
        if (state.pointers.size === 0) state.gesture = undefined;
        return;
      }
      if (g?.kind === 'select' && g.moved) view.set(selectWindow(g.w0, g.x0, f, view.minSpan));
      const tapped = !g || !('moved' in g) || !g.moved;
      end();
      if (ev.pointerType !== 'mouse' && tapped) {
        const now = ev.timeStamp || Date.now();
        const last = state.lastTap;
        if (last && now - last.at < DOUBLE_TAP_MS && Math.abs(f - last.x) * width < 30) {
          state.lastTap = undefined;
          view.reset();
        } else {
          state.lastTap = { at: now, x: f };
        }
      }
    },
    cancel(ev) {
      state.pointers.delete(ev.pointerId);
      // A stray third finger going doesn't end a pinch.
      if (state.gesture?.kind === 'pinch' && state.pointers.size >= 2) return;
      end();
      hover?.leave(ev);
    },
    leave(ev) {
      // Mouse capture keeps a drag going outside the plot; it ends on release.
      if (state.gesture && ev.pointerType === 'mouse') return;
      state.pointers.delete(ev.pointerId);
      hover?.leave(ev);
    },
    wheel(ev) {
      const { f } = fracOf(ev);
      if (ev.ctrlKey || ev.metaKey) {
        // Ctrl + scroll, and a trackpad pinch (which browsers send as Ctrl + scroll).
        ev.preventDefault();
        const step = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
        view.set(zoomAt(view.current(), f, Math.exp(-clamp(step, -100, 100) / 200), view.minSpan));
        return;
      }
      const sideways = ev.shiftKey && ev.deltaX === 0 ? ev.deltaY : ev.deltaX;
      const w = view.current();
      if (isZoomed(w) && Math.abs(sideways) > Math.abs(ev.shiftKey ? 0 : ev.deltaY)) {
        ev.preventDefault();
        const { width } = fracOf(ev);
        view.set(panBy(w, (sideways / Math.max(width, 1)) * (w.to - w.from)));
      }
    },
    dblclick() {
      view.reset();
    },
  };
}

/** The drag-to-zoom band and the reset button, over the plot. */
export function zoomLayer(ctx: ChartContext, view: ZoomView): TemplateResult | typeof nothing {
  const state = states.get(ctx.host);
  const sel = state?.select;
  const band = sel
    ? html`<div
        class="zoom-select"
        style="left:${Math.min(...sel) * 100}%;width:${Math.abs(sel[1] - sel[0]) * 100}%"
      ></div>`
    : nothing;
  const reset = view.zoomed
    ? html`<button
        class="zoom-reset"
        title=${localize(ctx.hass, 'zoom_reset')}
        @pointerdown=${(ev: Event) => ev.stopPropagation()}
        @click=${(ev: Event) => {
          ev.stopPropagation();
          view.reset();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${ZOOM_OUT}></path></svg>
        <span>${localize(ctx.hass, 'zoom_reset')}</span>
      </button>`
    : nothing;
  if (band === nothing && reset === nothing) return nothing;
  return html`${band}${reset}`;
}

const ZOOM_OUT =
  'M15.5,14H14.71L14.43,13.73C15.41,12.59 16,11.11 16,9.5A6.5,6.5 0 0,0 9.5,3A6.5,6.5 0 0,0 3,9.5A6.5,6.5 0 0,0 9.5,16C11.11,16 12.59,15.41 13.73,14.43L14,14.71V15.5L19,20.5L20.5,19L15.5,14M9.5,14C7,14 5,12 5,9.5C5,7 7,5 9.5,5C12,5 14,7 14,9.5C14,12 12,14 9.5,14M7,9H12V10H7V9Z';

// ---------------------------------------------------------------- overview strip

/** Each series as a thin line across the whole span, for the overview strip. */
export function overviewLines(series: readonly ChartSeries[], range: Range): SVGTemplateResult {
  const span = extent(series.map((s) => s.points));
  if (!span) return svg``;
  const [lo, hi] = padDomain(span);
  const x = linear([range.start, range.end], [0, VIEW_W]);
  const y = linear([lo, hi], [OVERVIEW_H - 2, 2]);
  return svg`${series.map((s) => {
    const d = runs(downsample(s.points, OVERVIEW_POINTS))
      .map((run) =>
        run.length === 1
          ? `M${x(run[0].t).toFixed(1)},${y(run[0].v as number).toFixed(1)}h0.5`
          : `M${run.map((p) => `${x(p.t).toFixed(1)},${y(p.v as number).toFixed(1)}`).join('L')}`,
      )
      .join('');
    return svg`<path d=${d} fill="none" stroke=${s.color}></path>`;
  })}`;
}

/**
 * The overview: the whole span drawn small, with the zoomed window over it. Drag the window to
 * move it, its edges to resize it, or across the strip to choose a new one; tap the strip to
 * centre the window there; double-tap to show everything again. Arrow keys move the window,
 * up and down (or + and −) zoom, and Escape resets.
 */
export function overviewStrip(
  ctx: ChartContext,
  view: ZoomView,
  range: Range,
  content: SVGTemplateResult,
): TemplateResult {
  const state = states.get(ctx.host)!;
  const w = view.window;
  const pos = (ev: PointerEvent) => fracOf(ev);
  const down = (ev: PointerEvent) => {
    if (ev.button > 0) return;
    ev.stopPropagation();
    const { f, width } = pos(ev);
    const w = view.current();
    const tol = HANDLE_PX / Math.max(width, 1);
    let kind: 'left' | 'right' | 'move' | 'new' = 'new';
    if (isZoomed(w)) {
      if (Math.abs(f - w.from) <= tol) kind = 'left';
      else if (Math.abs(f - w.to) <= tol) kind = 'right';
      else if (f > w.from && f < w.to) kind = 'move';
    }
    state.gesture = { kind, f0: f, w0: w, moved: false, px: width };
    capture(ev);
  };
  const move = (ev: PointerEvent) => {
    const g = state.gesture;
    if (!g || !('f0' in g)) return;
    const { f } = pos(ev);
    if (!g.moved && Math.abs(f - g.f0) * g.px < DRAG_PX) return;
    g.moved = true;
    const { w0 } = g;
    if (g.kind === 'move') view.set(panBy(w0, f - g.f0));
    else if (g.kind === 'left') view.set({ from: Math.min(f, w0.to - view.minSpan), to: w0.to });
    else if (g.kind === 'right') view.set({ from: w0.from, to: Math.max(f, w0.from + view.minSpan) });
    else view.set(selectWindow(FULL, g.f0, f, view.minSpan));
  };
  const up = () => {
    const g = state.gesture;
    if (!g || !('f0' in g)) return;
    state.gesture = undefined;
    if (!g.moved && g.kind === 'new' && isZoomed(g.w0)) {
      // A tap beside the window centres it there.
      const span = g.w0.to - g.w0.from;
      view.set({ from: g.f0 - span / 2, to: g.f0 + span / 2 });
    }
  };
  const key = (ev: KeyboardEvent) => {
    const w = view.current();
    const span = w.to - w.from;
    const centre = 0.5;
    const actions: Record<string, () => ZoomWindow> = {
      ArrowLeft: () => panBy(w, -span / 4),
      ArrowRight: () => panBy(w, span / 4),
      ArrowUp: () => zoomAt(w, centre, 1.5, view.minSpan),
      ArrowDown: () => zoomAt(w, centre, 1 / 1.5, view.minSpan),
      '+': () => zoomAt(w, centre, 1.5, view.minSpan),
      '=': () => zoomAt(w, centre, 1.5, view.minSpan),
      '-': () => zoomAt(w, centre, 1 / 1.5, view.minSpan),
      Home: () => panBy(w, -1),
      End: () => panBy(w, 1),
      Escape: () => FULL,
    };
    const act = actions[ev.key];
    if (!act) return;
    ev.preventDefault();
    ev.stopPropagation();
    view.set(act());
  };
  const shown = windowRange(range, w);
  const valuetext = localize(ctx.hass, 'zoom_window', {
    from: formatDateTime(shown.start, ctx.hass),
    to: formatDateTime(shown.end, ctx.hass),
  });
  const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
  return html`<div
    class="overview ${view.zoomed ? 'zoomed' : ''}"
    @pointerdown=${down}
    @pointermove=${move}
    @pointerup=${up}
    @pointercancel=${() => (state.gesture = undefined)}
    @dblclick=${(ev: Event) => {
      ev.stopPropagation();
      view.reset();
    }}
  >
    <svg class="overview-lines" viewBox="0 0 ${VIEW_W} ${OVERVIEW_H}" preserveAspectRatio="none" aria-hidden="true">
      ${content}
    </svg>
    <div class="overview-shade" style="left:0;width:${pct(w.from)}"></div>
    <div class="overview-shade" style="left:${pct(w.to)};right:0"></div>
    <div
      class="overview-window"
      style="left:${pct(w.from)};width:${pct(w.to - w.from)}"
      tabindex="0"
      role="slider"
      aria-label=${localize(ctx.hass, 'zoom_window_label')}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow=${Math.round(((w.from + w.to) / 2) * 100)}
      aria-valuetext=${valuetext}
      @keydown=${key}
    >
      <span class="overview-handle left"></span><span class="overview-handle right"></span>
    </div>
  </div>`;
}

export const zoomStyles = css`
  .plot-area.zoomable {
    touch-action: pan-y;
  }
  .plot-area.zoomable.zoomed {
    cursor: grab;
  }
  .plot-area.zoomable.zoomed:active {
    cursor: grabbing;
  }
  .zoom-select {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--primary-color) 15%, transparent);
    border-left: 1px solid var(--primary-color);
    border-right: 1px solid var(--primary-color);
    pointer-events: none;
    z-index: 1;
  }
  .zoom-reset {
    position: absolute;
    top: 2px;
    right: 2px;
    /* Under the tooltip: the box only covers it while the pointer is away from the corner. */
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 6px;
    font: inherit;
    font-size: 11px;
    line-height: 18px;
    color: var(--primary-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary-color) 40%, transparent);
    border-radius: 12px;
    cursor: pointer;
  }
  .zoom-reset svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }
  .zoom-reset:hover {
    background: color-mix(in srgb, var(--primary-color) 12%, var(--card-background-color, #fff));
  }
  .zoom-reset:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }
  .frame.compact .zoom-reset span {
    display: none;
  }
  .frame.compact .zoom-reset {
    padding: 2px;
  }
  .overview {
    position: relative;
    grid-column: 2;
    grid-row: 3;
    height: 32px;
    margin-top: 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
    touch-action: none;
    cursor: crosshair;
    user-select: none;
    -webkit-user-select: none;
  }
  .frame.compact .overview {
    height: 22px;
    margin-top: 4px;
  }
  .overview-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .overview-lines path {
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    opacity: 0.8;
  }
  .overview-shade {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--card-background-color, #fff) 60%, transparent);
    pointer-events: none;
  }
  .overview-window {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--primary-color) 70%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--primary-color) 8%, transparent);
    cursor: grab;
  }
  .overview:not(.zoomed) .overview-window {
    border-color: transparent;
    background: none;
    cursor: crosshair;
  }
  .overview-window:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }
  .overview-handle {
    position: absolute;
    top: 50%;
    width: 4px;
    height: 14px;
    border-radius: 2px;
    background: var(--primary-color);
    transform: translate(-50%, -50%);
    cursor: ew-resize;
  }
  .overview-handle.left {
    left: 0;
  }
  .overview-handle.right {
    left: 100%;
  }
  .overview:not(.zoomed) .overview-handle {
    display: none;
  }
  .plot-wrap.has-overview {
    grid-template-rows: minmax(0, 1fr) auto auto;
    height: 220px;
  }
  .frame.compact .plot-wrap.has-overview {
    height: 140px;
  }
`;
