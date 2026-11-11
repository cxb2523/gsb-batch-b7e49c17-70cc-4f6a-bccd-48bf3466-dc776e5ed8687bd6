import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { stageEdges, stagePercents, stageWidths, trapezoid } from '../src/styles/funnel';
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

function hass() {
  return makeHass({
    'sensor.solar': ['24.6', { friendly_name: 'Solar produced', unit_of_measurement: 'kWh' }],
    'sensor.home': ['18.4', { friendly_name: 'Used at home', unit_of_measurement: 'kWh' }],
    'sensor.battery': ['7.2', { friendly_name: 'Through battery', unit_of_measurement: 'kWh' }],
    'sensor.dark': ['unavailable', { friendly_name: 'After dark' }],
  });
}

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'funnel',
    entities: ['sensor.solar', 'sensor.home', 'sensor.battery'],
    ...config,
  } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('funnel maths', () => {
  it('sizes stages against the largest, with nothing for missing or non-positive values', () => {
    expect(stageWidths([20, 10, null, -5, 5])).toEqual([100, 50, 0, 0, 25]);
    expect(stageWidths([null, 0])).toEqual([0, 0]);
  });

  it('gives percentages of the first or the previous stage', () => {
    expect(stagePercents([200, 150, 30], 'first')).toEqual([100, 75, 15]);
    expect(stagePercents([200, 150, 30], 'previous')).toEqual([100, 75, 20]);
    expect(stagePercents([0, 5, null], 'first')).toEqual([null, null, null]);
    expect(stagePercents([10, null, 5], 'previous')).toEqual([100, null, null]);
    expect(stagePercents([10, 5], 'none')).toEqual([null, null]);
  });

  it('joins each funnel stage to the next, tapering the last and around gaps', () => {
    expect(stageEdges([100, 50, 0, 20], 'funnel')).toEqual([
      { top: 100, bottom: 50 },
      { top: 50, bottom: 40 },
      { top: 0, bottom: 0 },
      { top: 20, bottom: 16 },
    ]);
  });

  it('builds a pyramid up from the first stage to a point', () => {
    expect(stageEdges([100, 50, 25], 'pyramid')).toEqual([
      { top: 50, bottom: 100 },
      { top: 25, bottom: 50 },
      { top: 0, bottom: 25 },
    ]);
    expect(stageEdges([100, 0, 25], 'pyramid')[0]).toEqual({ top: 80, bottom: 100 });
  });

  it('centres a trapezoid in a 100 × 10 box', () => {
    expect(trapezoid(100, 50)).toBe('0,0 100,0 75,10 25,10');
    expect(trapezoid(0, 25)).toBe('50,0 50,0 62.5,10 37.5,10');
  });
});

describe('funnel chart', () => {
  it('draws one stage per entity, top down, with percentages of the first and labels', async () => {
    const card = await mount({});
    const stages = qa(card, '.stage.entity');
    expect(stages.map((s) => s.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(qa(card, '.percent').map(text)).toEqual(['100%', '75%', '29%']);
    expect(qa(card, '.label').map(text)).toEqual([
      'Solar produced 24.6 kWh',
      'Used at home 18.4 kWh',
      'Through battery 7.2 kWh',
    ]);
    const first = qa(card, 'polygon')[0];
    expect(first.getAttribute('points')).toBe(trapezoid(100, (18.4 / 24.6) * 100));
    expect(first.getAttribute('fill')).toContain('--primary-color');
    expect(qa(card, 'polygon')[1].getAttribute('fill')).toContain('--warning-color');
    // Amber takes dark text.
    expect(qa(card, '.percent')[1].classList.contains('dark')).toBe(true);
    expect(stages[0].getAttribute('aria-label')).toBe('Solar produced, 24.6 kWh, 100%');
    expect(card.shadowRoot!.querySelector('.funnel')!.getAttribute('aria-label')).toBe(
      'Funnel of Solar produced, Used at home, Through battery',
    );
  });

  it('stacks a pyramid from the bottom, and shows shares of the stage before', async () => {
    const card = await mount({ shape: 'pyramid', percent_of: 'previous' } as Partial<CardConfig>);
    const stages = qa(card, '.stage.entity');
    expect(stages.map((s) => s.getAttribute('data-index'))).toEqual(['2', '1', '0']);
    expect(qa(card, '.percent').map(text)).toEqual(['39%', '75%', '100%']);
    expect(qa(card, 'polygon')[0].getAttribute('points')!.startsWith('50,0 50,0')).toBe(true);
    expect(card.shadowRoot!.querySelector('.funnel')!.getAttribute('aria-label')).toMatch(/^Pyramid of/);
  });

  it('hides percentages and labels when asked', async () => {
    const card = await mount({ percent_of: 'none', show: { name: false, value: false } } as Partial<CardConfig>);
    expect(qa(card, '.percent')).toHaveLength(0);
    expect(qa(card, '.label')).toHaveLength(0);
    expect(card.shadowRoot!.querySelector('.funnel.no-labels')).not.toBeNull();
  });

  it('colours by band and by an entity’s own colour', async () => {
    const card = await mount({
      color_by: 'bands',
      severity: [
        { from: 0, color: 'red' },
        { from: 10, color: 'green' },
      ],
    } as Partial<CardConfig>);
    const fills = qa(card, 'polygon').map((p) => p.getAttribute('fill'));
    expect(fills[0]).toContain('--success-color');
    expect(fills[2]).toContain('--error-color');
    document.body.innerHTML = '';
    const own = await mount({
      entities: [{ entity: 'sensor.solar', color: '#ffeb3b' }, 'sensor.home'],
    } as Partial<CardConfig>);
    expect(qa(own, 'polygon')[0].getAttribute('fill')).toBe('#ffeb3b');
    expect(qa(own, '.percent')[0].classList.contains('dark')).toBe(true);
  });

  it('draws an unavailable or missing stage as an empty outline with its state', async () => {
    const card = await mount({ entities: ['sensor.solar', 'sensor.dark', 'sensor.missing'] });
    expect(qa(card, 'polygon.empty')).toHaveLength(2);
    expect(qa(card, '.percent').map(text)).toEqual(['100%']);
    expect(qa(card, '.label').map(text)).toEqual([
      'Solar produced 24.6 kWh',
      'After dark Unavailable',
      'sensor.missing Entity not found',
    ]);
    expect(qa(card, '.stage.unavailable')).toHaveLength(2);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'funnel', entities: ['sensor.a'], ...extra } as CardConfig);
    expect(set({ shape: 'cone' })).toThrow(/"shape" must be one of: funnel, pyramid/);
    expect(set({ percent_of: 'last' })).toThrow(/percent_of/);
    expect(set({ color_by: 'mood' })).toThrow(/color_by/);
    expect(set({ shape: 'pyramid', percent_of: 'none', color_by: 'bands' })).not.toThrow();
  });

  it('opens more-info from a stage', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const stage = qa(card, '.stage.entity')[1] as HTMLElement;
    stage.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    stage.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.home']);
  });
});

describe('funnel editor', () => {
  it('shows the Chart section and writes shape, percentages and colour', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'funnel', entities: ['sensor.solar'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({ funnel_shape: 'funnel', funnel_percent_of: 'first', funnel_color_by: 'series' });
    const labels = (form.computeLabel as (s: { name: string }) => string)({ name: 'funnel_percent_of' });
    expect(labels).toBe('Percentages');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), funnel_shape: 'pyramid', funnel_color_by: 'bands' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, shape: 'pyramid', color_by: 'bands' });
    expect(
      ed.shadowRoot!.querySelector('.styles[data-group="totals"] .style[data-style="funnel"] svg polygon'),
    ).not.toBeNull();
  });
});
