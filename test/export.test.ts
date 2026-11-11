import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  copyText,
  csvField,
  exportFileName,
  plottedCsv,
  saveFile,
  snapshotSvg,
  svgToPng,
  toYaml,
  placeExport,
} from '../src/chart/export';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of [
  'ha-form',
  'ha-expansion-panel',
  'ha-selector',
  'ha-entity-picker',
  'ha-icon-picker',
  'ha-icon-button',
  'ha-switch',
]) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const H = 3_600_000;
const sec = (msAgo: number) => (now - msAgo) / 1000;

function hassWith() {
  const hass = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['unavailable', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => ({
    'sensor.in': [
      { s: '19', lu: sec(20 * H) },
      { s: '21', lu: sec(2 * H) },
    ],
    'sensor.out': [
      { s: '5', lu: sec(20 * H) },
      { s: 'unavailable', lu: sec(4 * H) },
    ],
  })) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig> = {}) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
    export: true,
    ...config,
  } as CardConfig);
  card.hass = hassWith();
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel) as HTMLElement | null;
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll<HTMLElement>(sel)];
const flush = async (card: Card) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
  }
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('export formats', () => {
  it('writes CSV fields, quoting only what needs it', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField(1.5)).toBe('1.5');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('lists every drawn reading of a history chart, gaps and carried values left out', () => {
    const csv = plottedCsv(
      [
        {
          entity: { entityId: 'sensor.in', unit: '°C' },
          points: [
            { t: 0, v: 1, carried: true },
            { t: 1000, v: 2 },
            { t: 2000, v: null },
          ],
        },
      ],
      [],
    );
    expect(csv).toBe('timestamp,entity,value,unit\r\n1970-01-01T00:00:01.000Z,sensor.in,2,°C\r\n');
  });

  it('lists energy drawn below the axis as positive, as the tooltip reads it', () => {
    const csv = plottedCsv(
      [
        {
          entity: { entityId: 'sensor.grid_out', unit: 'kWh', config: { energy_below: true } },
          points: [{ t: 0, v: -1.5 }],
        },
      ],
      [],
    );
    expect(csv.split('\r\n')[1]).toBe('1970-01-01T00:00:00.000Z,sensor.grid_out,1.5,kWh');
  });

  it('lists current values for a chart of current values', () => {
    const csv = plottedCsv(
      undefined,
      [
        { entityId: 'sensor.a', unit: 'W', value: 5 },
        { entityId: 'sensor.b', unit: 'W', value: null },
      ],
      0,
    );
    expect(csv.split('\r\n')).toEqual(['timestamp,entity,value,unit', '1970-01-01T00:00:00.000Z,sensor.a,5,W', '']);
  });

  it('writes YAML the way the code editor shows a card', () => {
    const yaml = toYaml({
      type: 'custom:chartdeck-card',
      style: 'line',
      title: 'Room: "front"',
      entities: ['sensor.in', { entity: 'sensor.out', name: 'Out', color: 'red' }],
      period: { last: 24, unit: 'hour' },
      show: {},
      list: [],
      flag: true,
      word: 'yes',
      nothing: null,
      skipped: undefined,
      nested: [[1, 2], {}, []],
      'odd key': 1,
      '': '',
    });
    expect(yaml).toBe(
      [
        'type: "custom:chartdeck-card"',
        'style: line',
        'title: "Room: \\"front\\""',
        'entities:',
        '  - sensor.in',
        '  - entity: sensor.out',
        '    name: Out',
        '    color: red',
        'period:',
        '  last: 24',
        '  unit: hour',
        'show: {}',
        'list: []',
        'flag: true',
        'word: "yes"',
        'nothing: null',
        'nested:',
        '  -',
        '    - 1',
        '    - 2',
        '  - {}',
        '  - []',
        '"odd key": 1',
        '"": ""',
        '',
      ].join('\n'),
    );
    expect(toYaml([])).toBe('[]\n');
    expect(toYaml({})).toBe('{}\n');
    expect(toYaml(Infinity)).toBe('null\n');
  });

  it('names files after the title and the day', () => {
    expect(exportFileName('Living Room · Temp', 'png', 0)).toBe('living-room-temp-1970-01-01.png');
    expect(exportFileName('Café', 'csv', 0)).toBe('cafe-1970-01-01.csv');
    expect(exportFileName(undefined, 'svg', 0)).toBe('chartdeck-1970-01-01.svg');
  });
});

describe('browser APIs, each checked first', () => {
  it('copies when the clipboard allows, and says no when it is missing or refuses', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('x')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('x');
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    expect(await copyText('x')).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(await copyText('x')).toBe(false);
  });

  it('saves through a temporary link, and says no without object URLs', () => {
    const create = vi.fn(() => 'blob:x');
    vi.stubGlobal(
      'URL',
      Object.assign(function () {}, { createObjectURL: create, revokeObjectURL: vi.fn() }),
    );
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    expect(saveFile(new Blob(['a']), 'a.csv')).toBe(true);
    expect(clicked).toEqual(['a.csv']);
    expect(document.querySelector('a')).toBeNull();
    vi.stubGlobal('URL', {});
    expect(saveFile(new Blob(['a']), 'a.csv')).toBe(false);
    vi.stubGlobal('URL', {
      createObjectURL: () => {
        throw new Error('no');
      },
    });
    expect(saveFile(new Blob(['a']), 'a.csv')).toBe(false);
  });

  it('gives no PNG where there is no canvas to draw on', async () => {
    // jsdom has no canvas: getContext returns null.
    expect(await svgToPng('<svg xmlns="http://www.w3.org/2000/svg"/>', 10, 10)).toBeNull();
  });

  it('draws onto a canvas at twice the size where there is one', async () => {
    const drawn: number[][] = [];
    const context = { scale: vi.fn(), drawImage: (_: unknown, ...a: number[]) => drawn.push(a) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    let size: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) {
      size = [this.width, this.height];
      cb(new Blob(['png'], { type: 'image/png' }));
    });
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { value: async () => {}, configurable: true });
    const blob = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg"/>', 100, 50);
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    expect(blob?.type).toBe('image/png');
    expect(size).toEqual([200, 100]);
    expect(context.scale).toHaveBeenCalledWith(2, 2);
    expect(drawn).toEqual([[0, 0, 100, 50]]);
  });
});

describe('a picture of the chart', () => {
  it('copies drawings with their colours written in, and HTML as shapes and text', () => {
    const root = document.createElement('div');
    root.innerHTML = `<div class="skip">menu</div>
      <span style="background-color: rgb(255, 0, 0); border-top-left-radius: 50px; border-top-width: 1px; border-top-style: dashed; border-top-color: rgb(0, 0, 255)">Name &amp; <b>value</b></span>
      <span style="display:none">hidden</span>
      <i style="background-color: rgba(0, 0, 0, 0)"></i><i style="background-color: rgb(0 0 0 / 0)"></i>
      <svg viewBox="0 0 10 10" class="plot" role="img"><path class="line" d="M0 0L10 10" style="stroke: rgb(1, 2, 3)"></path></svg>`;
    document.body.appendChild(root);
    const span = root.querySelector('span')!;
    span.getBoundingClientRect = () => ({ left: 10, top: 5, width: 40, height: 20 }) as DOMRect;
    root.querySelector('svg')!.getBoundingClientRect = () => ({ left: 0, top: 30, width: 200, height: 100 }) as DOMRect;
    const { svg, width, height } = snapshotSvg(root, {
      title: 'Temps <1>',
      background: '#111',
      color: '#eee',
      skip: (el) => el.classList.contains('skip'),
    });
    expect(width).toBe(1);
    expect(height).toBe(44);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('fill="#111"');
    expect(svg).toContain('>Temps &lt;1&gt;</text>');
    expect(svg).not.toContain('menu');
    expect(svg).not.toContain('hidden');
    expect(svg.match(/<rect/g)).toHaveLength(2);
    expect(svg).toContain('fill="rgb(255, 0, 0)"');
    expect(svg).toContain('stroke="rgb(0, 0, 255)"');
    expect(svg).toContain('stroke-dasharray="3 2"');
    expect(svg).toContain('>Name &amp;</text>');
    expect(svg).toContain('>value</text>');
    // The plot keeps its shape, sized as drawn, with its computed stroke inline and no classes.
    expect(svg).toMatch(/<svg[^>]*x="0" y="74" width="200" height="100"/);
    expect(svg).toContain('stroke: rgb(1, 2, 3)'.replace(': ', ':'));
    expect(svg).not.toContain('class="line"');
  });
});

describe('the export menu on a card', () => {
  it('is not there unless asked for, nor on a value style', async () => {
    expect(q(await mount({ export: undefined }), '.export')).toBeNull();
    expect(q(await mount({ style: 'bar' }), '.export')).toBeNull();
  });

  it('centres the button on the title line once ha-card has drawn its header', async () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<ha-card><div class="export titled"></div></ha-card>';
    const card = root.querySelector('ha-card') as HTMLElement & { updateComplete?: Promise<unknown> };
    const menu = root.querySelector('.export') as HTMLElement;
    placeExport(host); // no header yet: left where the stylesheet puts it
    expect(menu.style.top).toBe('');
    const header = document.createElement('h1');
    header.className = 'card-header';
    header.style.padding = '12px 16px 16px';
    Object.defineProperty(header, 'offsetHeight', { value: 76 });
    Object.defineProperty(header, 'offsetTop', { value: 0 });
    card.attachShadow({ mode: 'open' }).appendChild(header);
    card.updateComplete = Promise.resolve();
    placeExport(host);
    await card.updateComplete;
    // Text line 12..60, centre 36; a 32 px button from 20.
    expect(menu.style.top).toBe('20px');

    // A short title row drawn in the light DOM: the button stays inside it.
    const other = document.createElement('div');
    other.attachShadow({ mode: 'open' }).innerHTML =
      '<ha-card><div class="card-header" style="padding: 16px 16px 0px"></div><div class="export titled"></div></ha-card>';
    const short = other.shadowRoot!.querySelector('.card-header') as HTMLElement;
    Object.defineProperty(short, 'offsetHeight', { value: 40 });
    Object.defineProperty(short, 'offsetTop', { value: 0 });
    placeExport(other);
    expect((other.shadowRoot!.querySelector('.export') as HTMLElement).style.top).toBe('8px');
    placeExport(document.createElement('div'));
  });

  it('gets a row of its own above the chart when the card has no title', async () => {
    const card = await mount({});
    const menu = q(card, '.export')!;
    expect(menu.classList.contains('inline')).toBe(true);
    expect(menu.classList.contains('titled')).toBe(false);
    expect(menu.nextElementSibling!.classList.contains('content')).toBe(true);
  });

  it('opens from the ⋮ button, closes on Escape or a press outside', async () => {
    const card = await mount({ title: 'Temps' });
    const button = q(card, '.export-button')!;
    expect(q(card, '.export')!.classList.contains('titled')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    await card.updateComplete;
    expect(qa(card, '.export-item').map((b) => [...b.children].map((c) => c.textContent).join(' '))).toEqual([
      'Save as PNG picture, 2×',
      'Save as SVG vector',
      'Copy CSV plotted values',
      "Copy YAML this card's config",
    ]);
    // Arrow keys walk the items.
    const items = qa(card, '.export-item');
    items[0].focus();
    q(card, '.export')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(card.shadowRoot!.activeElement).toBe(items[1]);
    q(card, '.export')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(card.shadowRoot!.activeElement).toBe(items[0]);
    q(card, '.export')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await card.updateComplete;
    expect(q(card, '.export-menu')).toBeNull();
    button.click();
    await card.updateComplete;
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    await card.updateComplete;
    expect(q(card, '.export-menu')).toBeNull();
  });

  it('copies the plotted readings as CSV and the config as YAML', async () => {
    const copied: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => void copied.push(t) } });
    const card = await mount();
    q(card, '.export-button')!.click();
    await card.updateComplete;
    q(card, '.export-item[data-action="csv"]')!.click();
    await flush(card);
    const rows = copied[0].trim().split('\r\n');
    expect(rows[0]).toBe('timestamp,entity,value,unit');
    expect(rows.filter((r) => r.includes('sensor.in')).map((r) => r.split(',')[2])).toEqual(['19', '21', '21']);
    expect(rows.filter((r) => r.includes('sensor.out')).map((r) => r.split(',')[2])).toEqual(['5']);
    expect(q(card, '.export-status')!.textContent).toBe('Copied');
    q(card, '.export-button')!.click();
    await card.updateComplete;
    q(card, '.export-item[data-action="yaml"]')!.click();
    await flush(card);
    expect(copied[1]).toContain('style: line\n');
    expect(copied[1]).toContain('export: true\n');
  });

  it('copies current values from a chart of current values', async () => {
    const copied: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (t: string) => void copied.push(t) } });
    const card = await mount({ style: 'pie' });
    q(card, '.export-button')!.click();
    await card.updateComplete;
    q(card, '.export-item[data-action="csv"]')!.click();
    await flush(card);
    expect(
      copied[0]
        .trim()
        .split('\r\n')
        .slice(1)
        .map((r) => r.split(',').slice(1).join(',')),
    ).toEqual(['sensor.in,21,°C']);
  });

  it('saves a file when the clipboard is out of reach, and says when nothing works', async () => {
    vi.stubGlobal('navigator', {});
    const saved: string[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(function () {}, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    const card = await mount({ title: 'Temps' });
    q(card, '.export-button')!.click();
    await card.updateComplete;
    q(card, '.export-item[data-action="yaml"]')!.click();
    await flush(card);
    expect(saved[0]).toMatch(/^temps-\d{4}-\d\d-\d\d\.yaml$/);
    expect(q(card, '.export-status')!.textContent).toBe("Saved as a file: the clipboard isn't available here");
    q(card, '.export-button')!.click();
    await card.updateComplete;
    q(card, '.export-item[data-action="svg"]')!.click();
    await flush(card);
    expect(saved[1]).toMatch(/^temps-.*\.svg$/);
    expect(q(card, '.export-status')!.textContent).toBe('Saved');
    // No canvas in jsdom: the PNG can't be made, and the card says so.
    q(card, '.export-button')!.click();
    await card.updateComplete;
    q(card, '.export-item[data-action="png"]')!.click();
    await flush(card);
    expect(q(card, '.export-status')!.textContent).toBe("Couldn't export from this browser");
    vi.stubGlobal('URL', {});
    q(card, '.export-button')!.click();
    await card.updateComplete;
    q(card, '.export-item[data-action="csv"]')!.click();
    await flush(card);
    expect(q(card, '.export-status')!.textContent).toBe("Couldn't export from this browser");
  });

  it('clears its status after a moment and lets go when the card leaves', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } });
    const card = await mount();
    q(card, '.export-button')!.click();
    await card.updateComplete;
    vi.useFakeTimers();
    q(card, '.export-item[data-action="yaml"]')!.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(q(card, '.export-status')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
    await flush(card);
    expect(q(card, '.export-status')).toBeNull();
    q(card, '.export-button')!.click();
    await card.updateComplete;
    const remove = vi.spyOn(window, 'removeEventListener');
    card.remove();
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
  });

  it('checks the option', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() =>
      card.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], export: 'yes' } as unknown as CardConfig),
    ).toThrow('"export" must be true or false');
  });
});

describe('export in the editor', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', entities: ['sensor.in'], ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events };
  }

  it('is a switch in the Display section of chart styles only', async () => {
    const { ed, events } = await editor({ style: 'line' });
    const toggle = ed.shadowRoot!.querySelector('ha-switch[data-name="export"]') as HTMLElement & { checked: boolean };
    expect(toggle).not.toBeNull();
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(events.at(-1)!.export).toBe(true);
    const bar = await editor({ style: 'bar' });
    expect(bar.ed.shadowRoot!.querySelector('ha-switch[data-name="export"]')).toBeNull();
  });
});
