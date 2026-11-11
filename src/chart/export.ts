import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';
import { shownValue } from '../history/energy';
import type { Point } from '../history/types';
import { embedFonts, withGeneric } from './export-fonts';

/*
 * The export menu (`export: true`): save the chart as a PNG or SVG, copy the plotted values as
 * CSV, or copy the card's YAML. Everything happens in the browser with its own APIs (Blob, a
 * canvas, the clipboard, a download link); nothing is sent anywhere. Each API is checked before
 * use, and copying falls back to saving a file where the clipboard isn't allowed (a dashboard
 * served over plain http).
 */

export function validateExport(raw: CardConfig): void {
  if (raw.export !== undefined && typeof raw.export !== 'boolean') throw new Error('"export" must be true or false');
}

// ---------------------------------------------------------------------------------------------
// Plotted values, kept per card by the history frame, for the CSV.

/** One series as last drawn: whose it is and its points. */
export interface PlottedSeries {
  entity: Pick<ResolvedEntity, 'entityId' | 'unit'> & { config?: unknown };
  points: Point[];
}

const plotted = new WeakMap<HTMLElement, PlottedSeries[]>();

/** Remember what a history chart drew, so the CSV can list it. */
export function rememberPlotted(host: HTMLElement, series: PlottedSeries[]): void {
  plotted.set(host, series);
}

/**
 * Forget what was drawn, so the CSV lists the card's current values: a new config (the style may
 * no longer draw history), or a chart of totals that read history only to add it up.
 */
export function forgetPlotted(host: HTMLElement): void {
  plotted.delete(host);
}

/** One CSV field: quoted when it holds a comma, quote or line break. */
export function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/**
 * The values a chart drew as CSV (timestamp, entity, value, unit): every reading of a history
 * chart, or each entity's current value for a chart of current values. Gaps are left out.
 */
export function plottedCsv(
  series: PlottedSeries[] | undefined,
  items: Pick<ResolvedEntity, 'entityId' | 'unit' | 'value'>[],
  now = Date.now(),
): string {
  const rows: (string | number)[][] = [['timestamp', 'entity', 'value', 'unit']];
  if (series) {
    for (const s of series) {
      for (const p of s.points) {
        if (p.v === null || p.carried) continue;
        // Energy drawn below the axis (grid export, battery charging) reads positive, as in the tooltip.
        const v = s.entity.config ? shownValue({ config: s.entity.config }, p.v) : p.v;
        rows.push([new Date(p.t).toISOString(), s.entity.entityId, v, s.entity.unit]);
      }
    }
  } else {
    const at = new Date(now).toISOString();
    for (const e of items) if (e.value !== null) rows.push([at, e.entityId, e.value, e.unit]);
  }
  return toCsv(rows);
}

// ---------------------------------------------------------------------------------------------
// YAML of the card's config.

const PLAIN = /^[A-Za-z_][A-Za-z0-9_.\-/ ]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return String(value);
  const text = String(value);
  if (text !== '' && PLAIN.test(text) && !RESERVED.test(text) && !text.endsWith(' ')) return text;
  return JSON.stringify(text);
}

function yamlKey(key: string): string {
  return PLAIN.test(key) && !RESERVED.test(key) && !key.includes(' ') ? key : JSON.stringify(key);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A JSON-like value as block YAML, the way Home Assistant's code editor shows a card. */
export function toYaml(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}[]\n`;
    return value
      .map((item) => {
        if (isObject(item) && Object.keys(item).length > 0) {
          const inner = toYaml(item, `${indent}  `);
          return `${indent}- ${inner.slice(indent.length + 2)}`;
        }
        if (Array.isArray(item) && item.length > 0) return `${indent}-\n${toYaml(item, `${indent}  `)}`;
        return `${indent}- ${isObject(item) ? '{}' : Array.isArray(item) ? '[]' : yamlScalar(item)}\n`;
      })
      .join('');
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return `${indent}{}\n`;
    return entries
      .map(([k, v]) => {
        if ((isObject(v) && Object.keys(v).length > 0) || (Array.isArray(v) && v.length > 0)) {
          return `${indent}${yamlKey(k)}:\n${toYaml(v, `${indent}  `)}`;
        }
        const scalar = isObject(v) ? '{}' : Array.isArray(v) ? '[]' : yamlScalar(v);
        return `${indent}${yamlKey(k)}: ${scalar}\n`;
      })
      .join('');
  }
  return `${indent}${yamlScalar(value)}\n`;
}

/** A file name from the card's title and the date: "living-room-2026-11-08.png". */
export function exportFileName(title: string | undefined, ext: string, now = Date.now()): string {
  const slug = (title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const day = new Date(now).toISOString().slice(0, 10);
  return `${slug || 'chartdeck'}-${day}.${ext}`;
}

// ---------------------------------------------------------------------------------------------
// A picture of the chart: its SVG drawings and HTML parts (labels, columns, swatches) redrawn as
// one SVG, with the theme's colours written in so it looks the same outside the page.

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Computed properties written onto each SVG element, so it draws the same without the card's CSS. */
const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stop-color',
  'stop-opacity',
  'opacity',
  'visibility',
  'display',
  'transform',
  'transform-origin',
  'transform-box',
  'vector-effect',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
];

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const px = (n: number) => Math.round(n * 100) / 100;

function visibleColor(color: string): boolean {
  if (!color || color === 'transparent') return false;
  // rgba(r, g, b, a) or rgb(r g b / a): only a fourth part is the alpha.
  const parts = /^rgba?\(([^)]*)\)$/
    .exec(color.trim())?.[1]
    .split(/[\s,/]+/)
    .filter(Boolean);
  return !parts || parts.length < 4 || parseFloat(parts[3]) > 0;
}

/** An inline SVG copied with every element's computed look written on it as a style attribute. */
function inlineSvg(source: SVGSVGElement, x: number, y: number, w: number, h: number): string {
  const copy = source.cloneNode(true) as SVGSVGElement;
  const from = [source, ...source.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((el, i) => {
    const style = getComputedStyle(el);
    const props = SVG_PROPS.map((p) => [p, style.getPropertyValue(p)] as const).filter(([, v]) => v !== '');
    const target = to[i] as Element;
    target.removeAttribute('class');
    if (props.length) target.setAttribute('style', props.map(([p, v]) => `${p}:${v}`).join(';'));
  });
  copy.setAttribute('x', String(px(x)));
  copy.setAttribute('y', String(px(y)));
  copy.setAttribute('width', String(px(w)));
  copy.setAttribute('height', String(px(h)));
  copy.removeAttribute('role');
  return new XMLSerializer().serializeToString(copy);
}

function ownText(el: Element): Text[] {
  return [...el.childNodes].filter((n): n is Text => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
}

/**
 * The chart in `root` (the card's content) as a standalone SVG: the card's background, its
 * title, each drawing, and the HTML around them (backgrounds, borders and text) as shapes and text
 * at the same places. `skip` leaves elements out (the export menu itself).
 */
export function snapshotSvg(
  root: HTMLElement,
  options: { title?: string; background: string; color: string; skip?: (el: Element) => boolean },
): { svg: string; width: number; height: number } {
  const box = root.getBoundingClientRect();
  const top = options.title ? 44 : 0;
  const width = Math.max(1, Math.ceil(box.width));
  const height = Math.max(1, Math.ceil(box.height + top));
  const parts: string[] = [`<rect width="${width}" height="${height}" rx="12" fill="${esc(options.background)}"/>`];
  if (options.title) {
    const family = withGeneric(getComputedStyle(root).fontFamily || 'Roboto, Noto');
    parts.push(
      `<text x="16" y="30" font-family="${esc(family)}" font-size="20" fill="${esc(options.color)}">${esc(options.title)}</text>`,
    );
  }
  const at = (r: DOMRect) => ({ x: r.left - box.left, y: r.top - box.top + top, w: r.width, h: r.height });
  const walk = (el: Element) => {
    if (options.skip?.(el)) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
    const r = at(el.getBoundingClientRect());
    if (el instanceof SVGSVGElement) {
      if (r.w > 0 && r.h > 0) parts.push(inlineSvg(el, r.x, r.y, r.w, r.h));
      return;
    }
    const opacity = Number(style.opacity);
    const alpha = opacity < 1 ? ` opacity="${opacity}"` : '';
    if (r.w > 0 && r.h > 0 && visibleColor(style.backgroundColor)) {
      const rx = Math.min(parseFloat(style.borderTopLeftRadius) || 0, r.w / 2, r.h / 2);
      parts.push(
        `<rect x="${px(r.x)}" y="${px(r.y)}" width="${px(r.w)}" height="${px(r.h)}" rx="${px(rx)}" fill="${esc(style.backgroundColor)}"${alpha}/>`,
      );
    }
    const sides: [string, number, number, number, number][] = [
      ['Top', r.x, r.y, r.x + r.w, r.y],
      ['Bottom', r.x, r.y + r.h, r.x + r.w, r.y + r.h],
      ['Left', r.x, r.y, r.x, r.y + r.h],
      ['Right', r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    ];
    for (const [side, x1, y1, x2, y2] of sides) {
      const w = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
      const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const color = style.getPropertyValue(`border-${side.toLowerCase()}-color`);
      if (w > 0 && kind !== 'none' && kind !== 'hidden' && visibleColor(color)) {
        const dash =
          kind === 'dashed'
            ? ` stroke-dasharray="${w * 3} ${w * 2}"`
            : kind === 'dotted'
              ? ` stroke-dasharray="${w} ${w}"`
              : '';
        parts.push(
          `<line x1="${px(x1)}" y1="${px(y1)}" x2="${px(x2)}" y2="${px(y2)}" stroke="${esc(color)}" stroke-width="${w}"${dash}${alpha}/>`,
        );
      }
    }
    for (const node of ownText(el)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      // The text's own box; the element's where the browser can't measure a range.
      const t = at(
        typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : el.getBoundingClientRect(),
      );
      const size = parseFloat(style.fontSize) || 14;
      const deco =
        style.textDecorationLine && style.textDecorationLine !== 'none'
          ? ` text-decoration="${esc(style.textDecorationLine)}"`
          : '';
      parts.push(
        `<text x="${px(t.x)}" y="${px(t.y + (t.h + size * 0.7) / 2)}" font-family="${esc(withGeneric(style.fontFamily))}" font-size="${size}" font-weight="${esc(style.fontWeight)}" fill="${esc(style.color)}"${deco}${alpha}>${esc((node.textContent ?? '').replace(/\s+/g, ' ').trim())}</text>`,
      );
    }
    for (const child of el.children) walk(child);
  };
  for (const child of root.children) walk(child);
  const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return { svg, width, height };
}

/** Draw an SVG onto a canvas at `scale` and return it as a PNG, or null where the browser can't. */
export async function svgToPng(svgText: string, width: number, height: number, scale = 2): Promise<Blob | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  if (!context || typeof canvas.toBlob !== 'function') return null;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await (typeof img.decode === 'function'
    ? img.decode()
    : new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image'));
      }));
  context.scale(scale, scale);
  context.drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/** Offer a file to save, through a temporary download link. False where the browser can't. */
export function saveFile(blob: Blob, name: string): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') {
    return false;
  }
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** Put text on the clipboard. False where the page may not (plain http, a refused permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// The menu.

export type ExportAction = 'png' | 'svg' | 'csv' | 'yaml';
export const EXPORT_ACTIONS: ExportAction[] = ['png', 'svg', 'csv', 'yaml'];

/** What the menu works from: the card, its config and entities, and where its drawing is. */
export interface ExportContext {
  host: HTMLElement;
  hass: HomeAssistant | undefined;
  raw: CardConfig;
  items: ResolvedEntity[];
  /** The card's content box, to picture. */
  content(): HTMLElement | null;
  requestUpdate(): void;
}

interface MenuState {
  open: boolean;
  status?: string;
  statusTimer?: ReturnType<typeof setTimeout>;
  outside?: (ev: Event) => void;
}

const menus = new WeakMap<HTMLElement, MenuState>();

function menuState(host: HTMLElement): MenuState {
  let state = menus.get(host);
  if (!state) {
    state = { open: false };
    menus.set(host, state);
  }
  return state;
}

function setOpen(ctx: ExportContext, open: boolean): void {
  const state = menuState(ctx.host);
  if (state.open === open) return;
  state.open = open;
  if (state.outside) {
    window.removeEventListener('pointerdown', state.outside, true);
    state.outside = undefined;
  }
  if (open) {
    // A press anywhere outside the menu closes it.
    state.outside = (ev: Event) => {
      const inside = ev.composedPath().some((el) => el instanceof Element && el.classList.contains('export'));
      if (!inside) setOpen(ctx, false);
    };
    window.addEventListener('pointerdown', state.outside, true);
  }
  ctx.requestUpdate();
}

function report(ctx: ExportContext, key: string, vars?: Record<string, string>): void {
  const state = menuState(ctx.host);
  state.status = localize(ctx.hass, key, vars);
  if (state.statusTimer !== undefined) clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => {
    state.status = undefined;
    state.statusTimer = undefined;
    ctx.requestUpdate();
  }, 2500);
  ctx.requestUpdate();
}

/** Stop listening for outside presses and the status timer: the card left the page. */
export function stopExport(host: HTMLElement): void {
  const state = menus.get(host);
  if (!state) return;
  if (state.outside) window.removeEventListener('pointerdown', state.outside, true);
  if (state.statusTimer !== undefined) clearTimeout(state.statusTimer);
  menus.delete(host);
}

function themeColors(host: HTMLElement): { background: string; color: string } {
  const style = getComputedStyle(host);
  const card = host.shadowRoot?.querySelector('ha-card');
  const cardBg = card ? getComputedStyle(card).backgroundColor : '';
  const background = visibleColor(cardBg)
    ? cardBg
    : style.getPropertyValue('--card-background-color').trim() ||
      style.getPropertyValue('--ha-card-background').trim() ||
      '#ffffff';
  const color = style.color || style.getPropertyValue('--primary-text-color').trim() || '#212121';
  return { background, color };
}

/** Text to copy, or a file of it where the clipboard is out of reach. */
async function copyOrSave(ctx: ExportContext, text: string, type: string, ext: string): Promise<void> {
  if (await copyText(text)) return report(ctx, 'export_copied');
  if (saveFile(new Blob([text], { type }), exportFileName(ctx.raw.title, ext))) return report(ctx, 'export_saved_file');
  report(ctx, 'export_failed');
}

/** Run one of the menu's actions. */
export async function runExport(ctx: ExportContext, action: ExportAction): Promise<void> {
  try {
    if (action === 'csv') {
      return await copyOrSave(ctx, plottedCsv(plotted.get(ctx.host), ctx.items), 'text/csv', 'csv');
    }
    if (action === 'yaml') {
      return await copyOrSave(ctx, toYaml(ctx.raw), 'text/yaml', 'yaml');
    }
    const root = ctx.content();
    if (!root) return report(ctx, 'export_failed');
    const theme = themeColors(ctx.host);
    const picture = snapshotSvg(root, {
      title: ctx.raw.title,
      ...theme,
      skip: (el) => el.classList.contains('export'),
    });
    // The card's font goes into the picture when the page can hand it over (see export-fonts.ts).
    const svg = await embedFonts(picture.svg, getComputedStyle(root).fontFamily);
    if (action === 'svg') {
      const ok = saveFile(new Blob([svg], { type: 'image/svg+xml' }), exportFileName(ctx.raw.title, 'svg'));
      return report(ctx, ok ? 'export_saved' : 'export_failed');
    }
    const png = await svgToPng(svg, picture.width, picture.height, 2);
    const ok = png !== null && saveFile(png, exportFileName(ctx.raw.title, 'png'));
    report(ctx, ok ? 'export_saved' : 'export_failed');
  } catch {
    report(ctx, 'export_failed');
  }
}

const DOTS =
  'M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z';

/**
 * With a title, centre the ⋮ button on the title's text line, inside the title row. The row's
 * height depends on the theme (Home Assistant draws it inside ha-card), so it is measured once
 * ha-card has drawn.
 */
export function placeExport(host: HTMLElement): void {
  const menu = host.shadowRoot?.querySelector<HTMLElement>('.export.titled');
  const card = host.shadowRoot?.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>('ha-card');
  if (!menu || !card) return;
  const place = () => {
    const header =
      card.shadowRoot?.querySelector<HTMLElement>('.card-header') ??
      ([...card.children].find((c) => c.classList.contains('card-header')) as HTMLElement | undefined);
    if (!header?.offsetHeight) return;
    const style = getComputedStyle(header);
    const padTop = parseFloat(style.paddingTop) || 0;
    const line = header.offsetHeight - padTop - (parseFloat(style.paddingBottom) || 0);
    const size = menu.offsetHeight || 32;
    // Centred on the text, but never lower than the title row's bottom (the chart starts there).
    const centred = header.offsetTop + padTop + line / 2 - size / 2;
    const top = Math.max(4, Math.round(Math.min(centred, header.offsetTop + header.offsetHeight - size)));
    menu.style.top = `${top}px`;
  };
  place();
  void card.updateComplete?.then(place);
}

/** The ⋮ button and, while open, its menu. Only for chart styles with `export: true`. */
export function exportMenu(ctx: ExportContext): TemplateResult | typeof nothing {
  if (ctx.raw.export !== true) return nothing;
  const state = menuState(ctx.host);
  const t = (k: string) => localize(ctx.hass, k);
  const choose = (action: ExportAction) => (ev: Event) => {
    ev.stopPropagation();
    setOpen(ctx, false);
    void runExport(ctx, action);
  };
  const keys = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && state.open) {
      ev.stopPropagation();
      setOpen(ctx, false);
      (ctx.host.shadowRoot?.querySelector('.export-button') as HTMLElement | null)?.focus();
      return;
    }
    if (!state.open || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')) return;
    ev.preventDefault();
    const items = [...(ctx.host.shadowRoot?.querySelectorAll<HTMLElement>('.export-item') ?? [])];
    const at = items.indexOf(ctx.host.shadowRoot?.activeElement as HTMLElement);
    const next = ev.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  // With a title the button sits in the title row. Without one it gets a row of its own above the
  // chart, so it never covers period buttons, header values or the plot.
  return html`<div class="export ${ctx.raw.title ? 'titled' : 'inline'}" @keydown=${keys}>
    ${state.status ? html`<span class="export-status" role="status">${state.status}</span>` : nothing}
    <button
      class="export-button"
      type="button"
      aria-label=${t('export_menu')}
      aria-haspopup="menu"
      aria-expanded=${state.open ? 'true' : 'false'}
      @click=${(ev: Event) => {
        ev.stopPropagation();
        setOpen(ctx, !state.open);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${DOTS}></path></svg>
    </button>
    ${
      state.open
        ? html`<div class="export-menu" role="menu" aria-label=${t('export_menu')}>
            ${EXPORT_ACTIONS.map(
              (action) =>
                html`<button
                  class="export-item"
                  type="button"
                  role="menuitem"
                  data-action=${action}
                  @click=${choose(action)}
                >
                  <span>${t(`export_${action}`)}</span><span class="export-hint">${t(`export_${action}_hint`)}</span>
                </button>`,
            )}
          </div>`
        : nothing
    }
  </div>`;
}

export const exportStyles = css`
  ha-card:has(> .export) {
    position: relative;
  }
  .export {
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* Titled: in the title row's right-hand end, clear of the chart. */
  .export.titled {
    position: absolute;
    top: 12px;
    right: 8px;
  }
  /* Untitled: a short row of its own, right-aligned; the chart starts just under it. */
  .export.inline {
    position: relative;
    justify-content: flex-end;
    padding: 4px 4px 0;
  }
  .export.inline + .content,
  .export.inline + .content:has(> .chart > .frame.compact) {
    padding-top: 0;
  }
  ha-card:has(.frame.compact) > .export.inline {
    padding: 2px 2px 0;
  }
  ha-card:has(.frame.compact) > .export .export-button {
    width: 28px;
    height: 28px;
  }
  .export-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--secondary-text-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 70%, transparent);
    cursor: pointer;
  }
  .export-button svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  .export-button:hover,
  .export-button[aria-expanded='true'] {
    background: color-mix(in srgb, var(--primary-text-color) 10%, var(--card-background-color, #fff));
  }
  .export-button:focus-visible,
  .export-item:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }
  .export-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 200px;
    max-width: calc(100vw - 32px);
    padding: 4px;
    border-radius: 8px;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
  }
  .export-item {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 10px;
    border: none;
    border-radius: 4px;
    font: inherit;
    font-size: 0.875em;
    text-align: start;
    color: var(--primary-text-color);
    background: none;
    cursor: pointer;
    white-space: nowrap;
  }
  .export-item:hover {
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
  }
  .export-hint {
    font-size: 0.85em;
    color: var(--secondary-text-color);
  }
  .export-status {
    font-size: 0.75em;
    padding: 2px 8px;
    border-radius: 10px;
    color: var(--primary-text-color);
    background: color-mix(in srgb, var(--primary-text-color) 10%, var(--card-background-color, #fff));
    white-space: nowrap;
  }
`;
