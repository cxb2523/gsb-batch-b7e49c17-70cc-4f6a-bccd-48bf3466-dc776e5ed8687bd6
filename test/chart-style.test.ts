import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { html, svg } from 'lit';
import { makeHass } from './helpers/hass';
import type { CardConfig } from '../src/types';

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

const { STYLES, isChart } = await import('../src/styles/index');
const { STYLE_NAMES } = await import('../src/types');
await import('../src/chartdeck-card');
await import('../src/editor/chartdeck-card-editor');

const disconnect = vi.fn();
const fake = {
  layout: 'chart' as const,
  group: 'history' as const,
  styles: (await import('lit')).css``,
  height: 200,
  thumbnail: () => svg`<rect width="10" height="10" />`,
  render: vi.fn((ctx) => html`<div class="fake">${ctx.items.map((e: { name: string }) => e.name).join(',')}</div>`),
  validate: (raw: CardConfig) => {
    if (raw.fake_option === 'bad') throw new Error('"fake_option" is bad');
  },
  watch: (raw: CardConfig) => (typeof raw.fake_entity === 'string' ? [raw.fake_entity] : []),
  editor: () => html`<div class="fake-editor">options</div>`,
  disconnect,
};
(STYLES as Record<string, unknown>).fake = fake;
(STYLE_NAMES as string[]).push('fake');
afterAll(() => {
  delete (STYLES as Record<string, unknown>).fake;
  (STYLE_NAMES as string[]).pop();
});

type Card = HTMLElement & {
  setConfig(c: CardConfig): void;
  hass?: unknown;
  updateComplete: Promise<boolean>;
  getGridOptions(): Record<string, unknown>;
  getCardSize(): number;
  shouldUpdate(changed: Map<string, unknown>): boolean;
};

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'fake', ...config } as CardConfig);
  card.hass = makeHass({
    'sensor.a': ['1', { friendly_name: 'A' }],
    'sensor.b': ['2', { friendly_name: 'B' }],
    'sensor.w': '3',
  });
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

afterEach(() => {
  document.body.innerHTML = '';
  disconnect.mockClear();
});

describe('whole-card chart styles', () => {
  it('is recognised as a chart', () => {
    expect(isChart(fake)).toBe(true);
    expect(isChart(STYLES.bar)).toBe(false);
  });

  it('draws once for the whole card, with the sorted and limited entities', async () => {
    const card = await mount({ entities: ['sensor.a', 'sensor.b'], sort: 'descending', limit: 1 });
    expect(card.shadowRoot!.querySelector('.chart .fake')!.textContent).toBe('B');
    expect(card.shadowRoot!.querySelector('.entities')).toBeNull();
    const ctx = fake.render.mock.calls.at(-1)![0];
    expect(ctx.raw.style).toBe('fake');
    expect(ctx.host).toBe(card);
  });

  it('checks its own options when the config is set', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() => card.setConfig({ type: 'x', style: 'fake', fake_option: 'bad' } as CardConfig)).toThrow(/fake_option/);
  });

  it('redraws for entities it watches', async () => {
    const card = await mount({ entities: ['sensor.a'], fake_entity: 'sensor.w' });
    const prev = card.hass as ReturnType<typeof makeHass>;
    const next = { ...prev, states: { ...prev.states, 'sensor.w': { ...prev.states['sensor.w'], state: '4' } } };
    card.hass = next;
    expect(card.shouldUpdate(new Map([['hass', prev]]))).toBe(true);
  });

  it('sizes as a full-width block from its estimated height', async () => {
    const card = await mount({ entities: ['sensor.a'], title: 'T' });
    expect(card.getGridOptions()).toMatchObject({ columns: 12, min_columns: 6 });
    expect(card.getCardSize()).toBe(Math.ceil((73 + 16 + 200) / 50));
  });

  it('lets the style clean up when the card leaves or switches style', async () => {
    const card = await mount({ entities: ['sensor.a'] });
    card.setConfig({ type: 'custom:chartdeck-card', style: 'bar', entities: ['sensor.a'] });
    expect(disconnect).toHaveBeenCalledTimes(1);
    card.setConfig({ type: 'custom:chartdeck-card', style: 'fake', entities: ['sensor.a'] });
    card.remove();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});

describe('editor with chart styles', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return ed;
  }

  it('groups the style picker and draws chart thumbnails from the style', async () => {
    const ed = await editor({});
    const groups = [...ed.shadowRoot!.querySelectorAll('.styles')].map((g) => g.getAttribute('data-group'));
    expect(groups.slice(0, 3)).toEqual(['bars', 'gauges', 'history']);
    expect(ed.shadowRoot!.querySelector('.style[data-style="fake"] svg rect')).not.toBeNull();
    expect(ed.shadowRoot!.querySelector('.style-group')!.textContent).toBe('Bars');
  });

  it('shows the Chart section only for a chart style with options', async () => {
    expect((await editor({})).shadowRoot!.querySelector('.section-chart')).toBeNull();
    document.body.innerHTML = '';
    const ed = await editor({ style: 'fake' });
    expect(ed.shadowRoot!.querySelector('.section-chart .fake-editor')).not.toBeNull();
  });
});

describe('per-entity chart options', () => {
  it('come from the chart style, and value styles have none', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'bar', entities: ['sensor.a'] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const list = () => ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect(list().chartFields).toBeUndefined();
    (fake as Record<string, unknown>).entityFields = () => ({
      schema: [{ name: 'group', selector: { text: {} } }],
      fields: [{ name: 'group', path: ['group'] }],
    });
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'fake', entities: ['sensor.a'] } as CardConfig);
    await ed.updateComplete;
    expect((list().chartFields as { fields: unknown[] }).fields).toEqual([{ name: 'group', path: ['group'] }]);
    delete (fake as Record<string, unknown>).entityFields;
  });
});
