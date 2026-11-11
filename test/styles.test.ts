import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { ChartdeckCard } from '../src/chartdeck-card';
import { litCells } from '../src/styles/segmented';
import { arcPath } from '../src/geometry';
import { DEFAULT_BANDS } from '../src/config';
import { STYLES, isChart } from '../src/styles';
import { bandSegments } from '../src/styles/needle';
import { STYLE_NAMES } from '../src/types';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';

type Card = ChartdeckCard;

const hass = () =>
  makeHass({
    'sensor.a': ['42', { unit_of_measurement: '%', friendly_name: 'A very long entity name that must be truncated' }],
    'sensor.b': 'unavailable',
  });

async function mount(config: Partial<CardConfig>): Promise<Card> {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', entities: ['sensor.a'], ...config });
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('litCells', () => {
  it('lights cells whose centre is inside the span', () => {
    expect(litCells([0, 0.38])).toEqual([true, true, true, true, false, false, false, false, false, false]);
    expect(litCells([0, 0])).toEqual(Array(10).fill(false));
    expect(litCells([0.25, 0.5]).filter(Boolean)).toHaveLength(2);
    expect(litCells([0.25, 0.5])[3]).toBe(true);
    expect(litCells([0.25, 0.5])[4]).toBe(true);
  });
});

describe('styles', () => {
  // Value styles only: whole-card charts are tested on their own.
  const names = STYLE_NAMES.filter((n) => n in STYLES && !isChart(STYLES[n]));

  it('renders every registered style without throwing for available, unavailable and missing entities', async () => {
    for (const style of names) {
      const card = await mount({ style, entities: ['sensor.a', 'sensor.b', 'sensor.missing'] });
      expect(card.shadowRoot!.querySelectorAll('[role=meter]')).toHaveLength(3);
      card.remove();
    }
  });

  it('truncates long names', async () => {
    for (const style of names.filter((n) => n !== 'bar')) {
      const card = await mount({ style });
      expect(q(card, '.name')?.textContent).toContain('truncated');
      card.remove();
    }
  });

  it('segmented lights cells and outlines the target cell', async () => {
    const card = await mount({ style: 'segmented', entities: [{ entity: 'sensor.a', target: 75 }] } as never);
    expect(card.shadowRoot!.querySelectorAll('.cell.on')).toHaveLength(4);
    const marks = card.shadowRoot!.querySelectorAll('.cell.mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute('style')).toContain('--i:7');
  });

  it('segmented value never wraps', () => {
    const css = STYLES.segmented.styles.cssText;
    const rule = css.match(/\.style-segmented \.value \{[^}]*\}/)![0];
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('min-width: min(max(48px, calc(var(--cd-value-ch, 4) * 1ch + 4px)), 35%)');
    expect(rule).not.toMatch(/[^-]width: 48px/);
  });

  it('segmented reserves the longest value width on every row so the cells line up', async () => {
    const short = await mount({ style: 'segmented' });
    expect((q(short, '.content') as HTMLElement).getAttribute('style')).toBe('--cd-value-ch: 4');
    // Status text ("Unavailable", "Entity not found") doesn't widen every row: only real values count.
    const mixed = await mount({ style: 'segmented', entities: ['sensor.a', 'sensor.b', 'sensor.missing'] });
    expect((q(mixed, '.content') as HTMLElement).getAttribute('style')).toBe('--cd-value-ch: 4');
    const none = await mount({ style: 'segmented', entities: ['sensor.missing'] });
    expect((q(none, '.content') as HTMLElement).getAttribute('style')).toBeNull();
  });

  it('segmented status rows show their status on the name line and keep an empty value slot', async () => {
    const card = await mount({ style: 'segmented', entities: ['sensor.a', 'sensor.b', 'sensor.missing'] });
    const rows = [...card.shadowRoot!.querySelectorAll('.entity')];
    const status = (r: Element) => r.querySelector('.name .status')?.textContent ?? null;
    const value = (r: Element) => r.querySelector('.value')?.textContent ?? null;
    expect(rows.map(status)).toEqual([null, 'Unavailable', 'Entity not found']);
    expect(rows.map(value)).toEqual([expect.stringMatching(/\d/), '', '']);
    // The status shows with the name hidden, and with the value hidden too (the sensor is
    // offline either way); a hidden value leaves no empty value slot behind.
    const noName = await mount({ style: 'segmented', entities: ['sensor.b'], show: { name: false } });
    expect(q(noName, '.name .status')?.textContent).toBe('Unavailable');
    expect(q(noName, '.name .label')).toBeNull();
    const noValue = await mount({ style: 'segmented', entities: ['sensor.b'], show: { value: false } });
    expect(q(noValue, '.name .status')?.textContent).toBe('Unavailable');
    expect(q(noValue, '.value')).toBeNull();
  });

  it('thin draws a target marker only when shown', async () => {
    const entities = [{ entity: 'sensor.a', target: 75 }] as never;
    const on = await mount({ style: 'thin', entities });
    expect(q(on, '.target')).not.toBeNull();
    const off = await mount({ style: 'thin', entities, show: { target: false } });
    expect(q(off, '.target')).toBeNull();
  });
});

describe('bar', () => {
  it('draws the text in the theme colour with a white copy clipped to the fill', async () => {
    const card = await mount({ style: 'bar' });
    const layers = card.shadowRoot!.querySelectorAll('.track .text');
    expect(layers).toHaveLength(2);
    expect(layers[0].classList.contains('on-fill')).toBe(false);
    expect(layers[0].hasAttribute('aria-hidden')).toBe(false);
    expect(layers[1].classList.contains('on-fill')).toBe(true);
    expect(layers[1].getAttribute('aria-hidden')).toBe('true');
    expect(layers[1].textContent).toBe(layers[0].textContent);
    const css = STYLES.bar.styles.cssText;
    expect(css).toMatch(/\.style-bar \.text \{[^}]*color: var\(--primary-text-color\)/);
    expect(css).toMatch(/\.style-bar \.text\.on-fill \{[^}]*color: #fff[^}]*clip-path: inset\(/);
    expect(css).toMatch(/\.style-bar \.text\.on-fill \{[^}]*transition:[^}]*clip-path/);
  });

  it('draws no white layer for an unavailable entity', async () => {
    const card = await mount({ style: 'bar', entities: ['sensor.b'] });
    expect(card.shadowRoot!.querySelectorAll('.track .text')).toHaveLength(1);
    expect(q(card, '.on-fill')).toBeNull();
  });
});

describe('tank', () => {
  it('renders a tube with a rising fill and a target marker', async () => {
    const card = await mount({ style: 'tank', entities: [{ entity: 'sensor.a', target: 75 }] } as never);
    expect(q(card, '.tube .fill')).not.toBeNull();
    expect(q(card, '[role=meter]')!.getAttribute('style')).toContain('--end:0.42');
    expect(q(card, '.target')).not.toBeNull();
  });

  it('omits the target marker when show.target is false', async () => {
    const card = await mount({
      style: 'tank',
      entities: [{ entity: 'sensor.a', target: 75 }],
      show: { target: false },
    } as never);
    expect(q(card, '.target')).toBeNull();
  });

  it('lays tiles out on an equal-width grid with the name as wide as its tile', () => {
    const css = STYLES.tank.styles.cssText;
    expect(css).toMatch(
      /\.style-tank \.layout-tiles \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(auto-fit, minmax\(80px, 1fr\)\);/,
    );
    const name = css.match(/\.style-tank \.name \{[^}]*\}/)![0];
    expect(name).toContain('max-width: 100%');
    expect(name).not.toContain('72px');
    // A long status ("Entity not found") wraps within a narrow tile, centred over the tube.
    expect(css).toMatch(/\.style-tank \.value \{[^}]*text-align: center;/);
  });

  it('sizes four tanks without a title to 12 columns and auto rows', async () => {
    const card = await mount({ style: 'tank', entities: ['sensor.a', 'sensor.a', 'sensor.a', 'sensor.a'] });
    expect(card.getGridOptions().columns).toBe(12);
    expect(card.getGridOptions().rows).toBe('auto');
  });
});

describe('color-mix fallback', () => {
  it('declares a solid fill colour under every gradient', () => {
    for (const name of ['bar', 'thin', 'segmented', 'tank'] as const) {
      const css = STYLES[name].styles.cssText;
      const rules = css.match(/\{[^}]*linear-gradient[^}]*\}/g)!;
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule).toMatch(/background: var\(--c-start\);\s*background-image: linear-gradient\(/);
      }
    }
  });

  it('swaps in a plain track and end colour where color-mix is unsupported', () => {
    const css = (ChartdeckCard.styles as { cssText: string }[]).map((s) => s.cssText).join('');
    const block = css.match(/@supports not \(color: color-mix\(in srgb, red 50%, white\)\) \{[\s\S]*?\}\s*\}/)![0];
    expect(block).toMatch(/:host \{\s*--cd-track: var\(--divider-color, [^;]+\);/);
    expect(block).toMatch(/\.entity \{\s*--c-end: var\(--c-start\) !important;/);
  });
});

describe('static mode', () => {
  it('marks the host static and the shared reset covers pseudo-elements', async () => {
    const card = await mount({ style: 'segmented', animate: false });
    expect(card.hasAttribute('static')).toBe(true);
    const css = (ChartdeckCard.styles as { cssText: string }[]).map((s) => s.cssText).join('');
    expect(css).toMatch(/:host\(\[static\]\) \.entity \*::before/);
    expect(css).toMatch(/:host\(\[static\]\) \.entity \*::after/);
  });
});

describe('narrow cards', () => {
  // jsdom can't evaluate container queries; check the rules are there (behaviour is checked on ha-dev).
  const NARROW = /@container \(max-width: 279px\)/;
  it('makes the card content a size container', async () => {
    const shared = (await import('../src/styles/shared')).shared.cssText;
    expect(shared).toMatch(/\.content \{[^}]*container-type: inline-size;/);
  });
  it('puts the segmented value on the name line with full-width cells below 280px', () => {
    const css = STYLES.segmented.styles.cssText;
    expect(css).toMatch(NARROW);
    const narrow = css.slice(css.search(NARROW));
    expect(narrow).toMatch(
      /\.style-segmented \.seg \{[^}]*display: grid;[^}]*grid-template-areas:\s*'icon name value'\s*'icon cells cells';/,
    );
    expect(narrow).toMatch(/\.style-segmented \.body \{\s*display: contents;/);
    expect(narrow).toMatch(/\.style-segmented \.cells \{[^}]*grid-area: cells;[^}]*gap: 2px;/);
    expect(narrow).toMatch(/\.style-segmented \.value \{[^}]*grid-area: value;/);
  });
  it('measures each segmented row on its own, so narrow columns switch layout too', async () => {
    const css = STYLES.segmented.styles.cssText;
    expect(css).toMatch(/\.style-segmented \.entity \{[^}]*container-type: inline-size;/);
    const card = await mount({ style: 'segmented', columns: 2, entities: ['sensor.a', 'sensor.b'] } as never);
    const seg = card.shadowRoot!.querySelector('.entity > .seg');
    expect(seg).not.toBeNull();
    expect(seg!.querySelector('.cells')).not.toBeNull();
  });
  it('never shrinks or wraps the thin and bar values; names truncate instead', () => {
    for (const name of ['thin', 'bar'] as const) {
      const css = STYLES[name].styles.cssText;
      expect(css, name).toMatch(new RegExp(`\\.style-${name} \\.value \\{[^}]*flex: none;[^}]*white-space: nowrap;`));
      expect(css, name).toMatch(new RegExp(`\\.style-${name} \\.name \\{[^}]*text-overflow: ellipsis;`));
    }
  });
});

describe('bar text over the fill', () => {
  it('is dark on light fills and white otherwise', async () => {
    const amber = await mount({ style: 'bar', severity: [{ from: 0, color: 'amber' }] } as never);
    expect(q(amber, '.text.on-fill')!.classList.contains('dark')).toBe(true);
    const plain = await mount({ style: 'bar' });
    expect(q(plain, '.text.on-fill')!.classList.contains('dark')).toBe(false);
    const css = STYLES.bar.styles.cssText;
    expect(css).toMatch(/\.style-bar \.text\.on-fill\.dark \{\s*color: #1d1f24;\s*text-shadow: none;/);
  });
});

describe('unavailable entities', () => {
  it('share one treatment: empty mark, secondary-colour value, name in normal text colour', async () => {
    const shared = (await import('../src/styles/shared')).shared.cssText;
    expect(shared).toMatch(/\.entity\.unavailable \.value \{\s*color: var\(--secondary-text-color\);/);
    for (const name of STYLE_NAMES.filter((n) => !isChart(STYLES[n]))) {
      const css = STYLES[name].styles.cssText;
      // No style recolours the name (or the whole text block) of an unavailable entity.
      expect(css, name).not.toMatch(/\.unavailable[^{]*(\.text|\.name)[^{]*\{/);
      const card = await mount({ style: name, entities: ['sensor.b'] });
      const entity = q(card, '.entity')!;
      expect(entity.classList.contains('unavailable'), name).toBe(true);
      if (name === 'segmented') {
        // Segmented shows the status on the name line (secondary colour) so its cells line up.
        expect(entity.querySelector('.name .status')!.textContent, name).toBe('Unavailable');
        expect(css).toMatch(/\.style-segmented \.name \.status \{[^}]*color: var\(--secondary-text-color\);/);
        expect(entity.querySelector('.on-fill, .target'), name).toBeNull();
      } else if (['bar', 'thin', 'tank'].includes(name)) {
        expect(entity.querySelector('.value')!.textContent, name).toBe('Unavailable');
        expect(entity.querySelector('.on-fill, .target'), name).toBeNull();
      } else {
        expect(entity.querySelector('.na'), name).not.toBeNull();
      }
    }
  });
});

describe('tile heights', () => {
  it('declares the heights measured on ha-dev (needle 137 px, ring 153 px, arc 133 px, rounded up)', async () => {
    expect(STYLES.needle.height).toBe(140);
    expect(STYLES.ring.height).toBe(155);
    expect(STYLES.arc.height).toBe(135);
    // One needle, no title: 16 + 140 = 156 px -> 4 rows of 50 (3 with the old 130).
    const card = await mount({ style: 'needle' });
    expect(card.getCardSize()).toBe(4);
  });
});

describe('ring and arc', () => {
  it('ring draws the value path with pathLength 100', async () => {
    const card = await mount({ style: 'ring' });
    expect(q(card, '.value-arc')!.getAttribute('pathLength')).toBe('100');
  });

  it('puts the dash pattern in inline style as plain numbers', async () => {
    const card = await mount({ style: 'ring' });
    const style = q(card, '.value-arc')!.getAttribute('style')!;
    expect(style).toContain('stroke-dasharray: 42 100');
    expect(style).toContain('stroke-dashoffset: 0');
    const centred = await mount({ style: 'arc', entities: [{ entity: 'sensor.a', min: -100, max: 100 }] } as never);
    const s2 = q(centred, '.value-arc')!.getAttribute('style')!;
    expect(s2).toContain('stroke-dasharray: 21 100');
    expect(s2).toContain('stroke-dashoffset: -50');
  });

  it('draws the arc empty until ready without calc() on custom properties', () => {
    const css = STYLES.ring.styles.cssText;
    expect(css).not.toMatch(/stroke-dash[a-z]*:\s*calc/);
    expect(css).toMatch(
      /:host\(:not\(\[ready\]\)\) \.radial \.value-arc \{\s*stroke-dasharray: 0 100 !important;\s*stroke-dashoffset: 0 !important;/,
    );
    expect(css).toMatch(/\.radial \.value-arc \{[^}]*transition:[^}]*stroke-dasharray[^}]*stroke-dashoffset/);
  });

  it('falls back to a solid stroke if the gradient reference fails', async () => {
    const card = await mount({ style: 'ring' });
    const arc = q(card, '.value-arc')!;
    expect(arc.getAttribute('stroke')).toMatch(/^url\(#cd-g-\d+\) #2f6fe4$/);
    expect(card.shadowRoot!.querySelector('stop')!.hasAttribute('stop-color')).toBe(false);
  });

  it('adds no paint fallback for a colour the browser cannot parse, which would void the stroke', async () => {
    const supports = (_p: string, v: string) => !v.startsWith('oklch');
    vi.stubGlobal('CSS', { supports });
    try {
      const card = await mount({ style: 'ring', severity: [{ from: 0, color: 'oklch(70% 0.1 200)' }] } as never);
      expect(q(card, '.value-arc')!.getAttribute('stroke')).toMatch(/^url\(#cd-g-\d+\)$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds no paint fallback for a theme variable, which an attribute cannot resolve', async () => {
    const card = await mount({
      style: 'ring',
      severity: [{ from: 0, color: 'var(--my-colour)' }],
    } as never);
    expect(q(card, '.value-arc')!.getAttribute('stroke')).toMatch(/^url\(#cd-g-\d+\)$/);
  });

  it('arc track spans 270 degrees', async () => {
    const card = await mount({ style: 'arc' });
    expect(q(card, '.track')!.getAttribute('d')).toBe(arcPath(60, 60, 46, -135, 135));
  });

  it('gives two cards distinct gradient ids', async () => {
    const a = await mount({ style: 'ring' });
    const b = await mount({ style: 'ring' });
    const idA = q(a, 'linearGradient')!.id;
    const idB = q(b, 'linearGradient')!.id;
    expect(idA).toMatch(/^cd-g-\d+$/);
    expect(idA).not.toBe(idB);
  });

  it('hides the value path when the span is empty', async () => {
    const card = await mount({ style: 'ring', entities: [{ entity: 'sensor.a', min: 50, max: 100 }] } as never);
    expect(q(card, '.value-arc')!.classList.contains('empty')).toBe(true);
  });

  it('shrinks a long centre value so it stays inside the dial', async () => {
    // The disc inside the ring is 68 units across; at 22px "123,456.78" is ~107 units wide
    // and was drawn over the ring itself.
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({
      type: 'custom:chartdeck-card',
      style: 'ring',
      entities: [{ entity: 'sensor.big', max: 200000, decimals: 2 }, 'sensor.a'],
    } as never);
    card.hass = makeHass({
      'sensor.big': ['123456.78', { unit_of_measurement: 'kWh' }],
      'sensor.a': ['42', { unit_of_measurement: '%' }],
    });
    document.body.appendChild(card);
    await card.updateComplete;
    const [big, small] = [...card.shadowRoot!.querySelectorAll<SVGTextElement>('text.value')];
    expect(big.textContent).toBe('123,456.78');
    const size = parseFloat(big.getAttribute('style')!.match(/font-size:\s*([\d.]+)px/)![1]);
    // About half an em per character: the text must fit in ~62 of the disc's 68 units.
    expect(size * 0.5 * big.textContent!.length).toBeLessThanOrEqual(62);
    expect(small.getAttribute('style')).toBeNull();
  });

  it('draws a target tick and shows no value arc when unavailable', async () => {
    const t = await mount({ style: 'arc', entities: [{ entity: 'sensor.a', target: 75 }] } as never);
    expect(q(t, '.tick')).not.toBeNull();
    const u = await mount({ style: 'arc', entities: ['sensor.b'] });
    expect(q(u, '.value-arc')).toBeNull();
    expect(q(u, '.na')).not.toBeNull();
  });
});

describe('bandSegments', () => {
  it('maps bands to clipped 0..1 segments', () => {
    expect(
      bandSegments(
        [
          { from: 0, color: 'green' },
          { from: 60, color: 'amber' },
          { from: 85, color: 'red' },
        ],
        0,
        100,
      ),
    ).toEqual([
      { from: 0, to: 0.6, color: 'green' },
      { from: 0.6, to: 0.85, color: 'amber' },
      { from: 0.85, to: 1, color: 'red' },
    ]);
    expect(
      bandSegments(
        [
          { from: 0, color: 'green' },
          { from: 200, color: 'red' },
        ],
        0,
        100,
      ),
    ).toEqual([{ from: 0, to: 1, color: 'green' }]);
    expect(bandSegments(DEFAULT_BANDS, -10, 10)).toEqual([{ from: 0, to: 1, color: 'primary' }]);
  });

  it('colours the scale below the first band with the first band, as bandFor does', () => {
    expect(
      bandSegments(
        [
          { from: 0, color: 'green' },
          { from: 60, color: 'amber' },
          { from: 85, color: 'red' },
        ],
        -20,
        100,
      )[0],
    ).toEqual({ from: 0, to: 80 / 120, color: 'green' });
  });
});

describe('needle', () => {
  it('renders a needle and hides it when unavailable', async () => {
    const ok = await mount({ style: 'needle' });
    expect(q(ok, '.needle')).not.toBeNull();
    const na = await mount({ style: 'needle', entities: ['sensor.b'] });
    expect(q(na, '.needle')).toBeNull();
    expect(q(na, '.na')).not.toBeNull();
  });

  it('rotates the needle with an inline numeric transform', async () => {
    const card = await mount({ style: 'needle' });
    expect(q(card, '.needle')!.getAttribute('style')).toBe('transform: rotate(-14.4deg)');
    const css = STYLES.needle.styles.cssText;
    expect(css).not.toMatch(/rotate\(calc/);
    expect(css).toMatch(/\.needle-gauge \.needle \{[^}]*transform-box: view-box;[^}]*transform-origin: 65px 66px;/);
    expect(css).toMatch(
      /:host\(:not\(\[ready\]\)\) \.needle-gauge \.needle \{\s*transform: rotate\(-90deg\) !important;/,
    );
  });

  it('draws a target marker only when shown', async () => {
    const on = await mount({ style: 'needle', entities: [{ entity: 'sensor.a', target: 75 }] } as never);
    expect(q(on, '.target-mark')).not.toBeNull();
  });
});

describe('missing entity icon', () => {
  const icon = (card: Card) => q(card, 'ha-state-icon') as (HTMLElement & { icon?: string }) | null;

  for (const style of ['bar', 'thin', 'segmented', 'tank', 'needle'] as const) {
    it(`${style} draws a placeholder icon so the row lines up with the others`, async () => {
      const missing = await mount({ style, entities: ['sensor.missing'] });
      expect(icon(missing)?.icon).toBe('mdi:help-circle-outline');
      const custom = await mount({ style, entities: [{ entity: 'sensor.missing', icon: 'mdi:water' }] } as never);
      expect(icon(custom)?.icon).toBe('mdi:water');
      const present = await mount({ style });
      expect(icon(present)?.icon).toBeUndefined();
      const hidden = await mount({ style, entities: ['sensor.missing'], show: { icon: false } });
      expect(icon(hidden)).toBeNull();
    });
  }

  for (const style of ['ring', 'arc'] as const) {
    it(`${style} keeps a missing entity's hollow free for its status text`, async () => {
      const missing = await mount({ style, entities: ['sensor.missing'] });
      expect(icon(missing)).toBeNull();
    });
  }
});

describe('bar text on see-through fills', () => {
  it('uses the theme text colour, not white, over a mostly transparent fill', async () => {
    const card = await mount({ style: 'bar', severity: [{ from: 0, color: 'rgba(255, 255, 255, 0.15)' }] } as never);
    expect(q(card, '.text.on-fill')!.classList.contains('theme')).toBe(true);
    const css = (ChartdeckCard.styles as unknown as { cssText: string }[]).map((x) => x.cssText).join('\n');
    expect(css).toMatch(
      /\.style-bar \.text\.on-fill\.theme \{[^}]*color: var\(--primary-text-color\);[^}]*text-shadow: none;/,
    );
  });
});

describe('ring and arc centre', () => {
  for (const style of ['ring', 'arc'] as const) {
    it(`${style} centres the icon when the value is hidden`, async () => {
      const card = await mount({ style, show: { value: false } });
      expect(q(card, '.radial .icon')!.classList.contains('centre')).toBe(true);
    });

    it(`${style} keeps the icon above the value when both are shown`, async () => {
      const card = await mount({ style });
      expect(q(card, '.radial .icon')!.classList.contains('centre')).toBe(false);
    });

    it(`${style} centres the value when the icon is hidden`, async () => {
      const card = await mount({ style, show: { icon: false } });
      expect(q(card, '.radial .value')!.getAttribute('y')).toBe('64');
    });
  }

  it('styles a centred icon in the middle of the dial', () => {
    const css = (ChartdeckCard.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');
    expect(css).toMatch(/\.radial \.icon\.centre \{[^}]*top: 48\.39cqw;[^}]*transform: translate\(-50%, -50%\);/);
  });
});

describe('needle without its value', () => {
  it('closes up the space the value used', async () => {
    const card = await mount({ style: 'needle', show: { value: false } });
    const svgEl = q(card, '.needle-gauge svg')!;
    expect(svgEl.getAttribute('viewBox')).toBe('0 0 130 82');
    expect(svgEl.classList.contains('compact')).toBe(true);
  });

  it('keeps the full height when the value is shown', async () => {
    const shown = await mount({ style: 'needle' });
    expect(q(shown, '.needle-gauge svg')!.getAttribute('viewBox')).toBe('0 0 130 104');
    const na = await mount({ style: 'needle', entities: ['sensor.b'] });
    expect(q(na, '.needle-gauge svg')!.getAttribute('viewBox')).toBe('0 0 130 104');
    expect([...q(na, '.na')!.querySelectorAll('tspan')].map((t) => t.getAttribute('y'))).toEqual(['94']);
  });

  it('keeps a status that fits on one line under a full-height needle', async () => {
    const card = await mount({ style: 'needle', entities: ['sensor.missing'] });
    expect([...q(card, '.na')!.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['Entity not found']);
  });

  it('fits a long status under a full-height needle instead of spilling past the tile', async () => {
    const long = 'A really quite extraordinarily long status';
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'needle', entities: ['sensor.x'] });
    card.hass = makeHass({ 'sensor.x': 'weird' }, { formatEntityState: () => long });
    document.body.appendChild(card);
    await card.updateComplete;
    const na = q(card, '.na')!;
    const size = parseFloat(na.getAttribute('style')!.match(/font-size: ([\d.]+)px/)![1]);
    const lines = [...na.querySelectorAll('tspan')].map((t) => t.textContent!);
    expect(lines.length).toBe(2);
    expect(Math.max(...lines.map((l) => l.length)) * 0.58 * size).toBeLessThanOrEqual(126);
  });

  it('closes up unavailable and missing needles too, with their status inside the dial', async () => {
    const card = await mount({
      style: 'needle',
      entities: ['sensor.a', 'sensor.b', 'sensor.missing'],
      show: { value: false },
    });
    const svgs = [...card.shadowRoot!.querySelectorAll('.needle-gauge svg')];
    expect(svgs.map((s) => s.getAttribute('viewBox'))).toEqual(Array(3).fill('0 0 130 82'));
    expect(svgs.every((s) => s.classList.contains('compact'))).toBe(true);
    const [na, missing] = [...card.shadowRoot!.querySelectorAll('.na')];
    // Above the hub (cy 66, r 6), shrunk to fit between the ticks.
    expect([...na.querySelectorAll('tspan')].map((t) => [t.textContent, t.getAttribute('y')])).toEqual([
      ['Unavailable', '55'],
    ]);
    expect(na.getAttribute('style')).toBe('font-size: 9px');
    const lines = [...missing.querySelectorAll('tspan')];
    expect(lines.map((t) => t.textContent)).toEqual(['Entity', 'not found']);
    expect(Number(lines[1].getAttribute('y'))).toBe(55);
    // The first line's cap height (~0.75 em) clears the top tick, which ends at y 30.
    const size = parseFloat(missing.getAttribute('style')!.match(/font-size: ([\d.]+)px/)![1]);
    expect(Number(lines[0].getAttribute('y')) - 0.75 * size).toBeGreaterThan(31);
  });
});

describe('arc crop', () => {
  it('crops the arc drawing to its open bottom, keeping the centre where it was', async () => {
    const arc = await mount({ style: 'arc' });
    expect(q(arc, '.radial svg')!.getAttribute('viewBox')).toBe('0 0 120 100');
    expect(q(arc, '.radial')!.classList.contains('cropped')).toBe(true);
    expect(q(arc, '.radial .value')!.getAttribute('y')).toBe('70');
    const ring = await mount({ style: 'ring' });
    expect(q(ring, '.radial svg')!.getAttribute('viewBox')).toBe('0 0 120 120');
    expect(q(ring, '.radial')!.classList.contains('cropped')).toBe(false);
    const css = STYLES.arc.styles.cssText;
    expect(css).toMatch(/\.radial\.cropped \.dial \{\s*aspect-ratio: 124 \/ 100;/);
    // The centred icon sits on the dial centre (y 60), not half the (cropped) dial height.
    expect(css).toMatch(/\.radial \.icon\.centre \{[^}]*top: 48\.39cqw;/);
  });
});

describe('gauges in very narrow cards', () => {
  it('scales the ring and arc dial down with its tile, keeping the icon in place', () => {
    const css = STYLES.ring.styles.cssText;
    // The dial is a size container, so it can't size the tile itself: the gauge has a definite
    // width that only shrinks when the tile is narrower (else the dial collapses to the name).
    expect(css).toMatch(/\.radial \{[^}]*width: 124px;[^}]*max-width: 100%;/);
    expect(css).toMatch(
      /\.radial \.dial \{[^}]*container-type: inline-size;[^}]*width: min\(124px, 100%\);[^}]*aspect-ratio: 124 \/ 120;/,
    );
    expect(css).toMatch(/\.radial svg \{[^}]*width: 100%;[^}]*height: 100%;/);
    expect(css).toMatch(/\.radial \.icon \{[^}]*top: 25cqw;[^}]*--mdc-icon-size: 14\.52cqw;/);
  });

  it('scales the needle dial down with its tile', () => {
    const css = STYLES.needle.styles.cssText;
    // A definite width: a percentage-wide svg would otherwise report its 300 px default size
    // and make every needle tile a full row.
    expect(css).toMatch(/\.needle-gauge \{[^}]*width: 130px;[^}]*max-width: 100%;/);
    expect(css).toMatch(
      /\.needle-gauge svg \{[^}]*width: min\(130px, 100%\);[^}]*height: auto;[^}]*aspect-ratio: 130 \/ 104;/,
    );
    expect(css).toMatch(/\.needle-gauge svg\.compact \{\s*aspect-ratio: 130 \/ 82;/);
  });
});
