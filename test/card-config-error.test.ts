import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The element registers itself on import; only its type is used below.
import '../src/chartdeck-card';
import type { ChartdeckCard } from '../src/chartdeck-card';
import { registerLanguage } from '../src/localize';
import { resetLimitWarnings } from '../src/resolve';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

/*
 * What the card shows when the YAML is wrong, and how it finds its way back once the YAML is
 * fixed. A broken config must not throw its way out of setConfig: the card explains the field
 * in its own content area, in the user's language, and draws again as soon as it validates.
 */

type Card = ChartdeckCard & {
  shouldUpdate(changed: Map<string, unknown>): boolean;
};

const base = (extra: Partial<CardConfig> = {}): CardConfig => ({
  type: 'custom:chartdeck-card',
  entities: ['sensor.load', 'sensor.solar'],
  ...extra,
});

const states = () =>
  makeHass({
    'sensor.load': ['42.25', { unit_of_measurement: 'W', friendly_name: 'Load' }],
    'sensor.solar': ['80', { unit_of_measurement: 'W', friendly_name: 'Solar' }],
  });

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

/** Mount with a config that is expected to validate; throws if it does not. */
async function mount(config: CardConfig, hass: HomeAssistant = states()): Promise<Card> {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

/** Mount with a config that fails validation (setConfig must not throw). */
async function mountBroken(config: CardConfig, hass: HomeAssistant = states()): Promise<Card> {
  const card = document.createElement('chartdeck-card') as Card;
  expect(() => card.setConfig(config)).not.toThrow();
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const hintText = (card: Card) => q(card, '.hint')?.textContent?.trim();

describe('chartdeck-card config errors', () => {
  beforeEach(() => resetLimitWarnings());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('draws a valid config without an error hint', async () => {
    const card = await mount(base());
    expect(qa(card, '[role=meter]')).toHaveLength(2);
    expect(q(card, '.hint')).toBeNull();
  });

  it('shows the field and the reason instead of drawing, and does not throw', async () => {
    const card = await mountBroken(base({ min: 10, max: 5 }));
    expect(qa(card, '[role=meter]')).toHaveLength(0);
    expect(q(card, '.hint.error')).not.toBeNull();
    expect(hintText(card)).toBe('Invalid configuration: "max" (5) must be greater than "min" (10)');
  });

  it.each([
    ['an unknown style', { style: 'nonsense' as unknown as CardConfig['style'] }, /Unknown style "nonsense"/],
    [
      'entities that are not a list',
      { entities: 'sensor.load' as unknown as CardConfig['entities'] },
      /"entities" must be a list/,
    ],
    ['decimals out of range', { decimals: 30 }, /"decimals" must be a whole number from 0 to 20/],
  ])('explains %s', async (_name, extra, expected) => {
    const card = await mountBroken(base(extra));
    expect(qa(card, '[role=meter]')).toHaveLength(0);
    expect(hintText(card)).toMatch(expected);
  });

  it('renders only the message, never the exception object', async () => {
    const card = await mountBroken(base({ min: 10, max: 5 }));
    const text = card.shadowRoot!.textContent!;
    // A string was handed to the template, not the Error itself.
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('at normalizeConfig');
    expect(q(card, '.hint.error')!.childElementCount).toBe(0);
  });

  it('keeps the title while showing the error', async () => {
    const card = await mountBroken(base({ title: 'Power', min: 10, max: 5 }));
    const header = q(card, 'ha-card') as HTMLElement & { header?: string };
    expect(header.header).toBe('Power');
  });

  it('recovers and draws again when the YAML is fixed', async () => {
    const card = await mountBroken(base({ min: 10, max: 5 }));
    expect(qa(card, '[role=meter]')).toHaveLength(0);
    card.setConfig(base({ entities: ['sensor.solar'] }));
    await card.updateComplete;
    expect(q(card, '.hint')).toBeNull();
    const meters = qa(card, '[role=meter]');
    expect(meters).toHaveLength(1);
    expect(meters[0].getAttribute('aria-label')).toBe('Solar, 80.0 W');
  });

  it('forgets the broken config, its watches and its error when fixed', async () => {
    // A config must not leak entities or watches from the earlier (broken) one: the valid
    // config that follows draws only what it lists.
    const card = await mount(base({ entities: ['sensor.load'] }));
    expect(qa(card, '[role=meter]')).toHaveLength(1);
    card.setConfig(base({ entities: ['sensor.load', 'sensor.solar'], min: 10, max: 5 }));
    await card.updateComplete;
    expect(qa(card, '[role=meter]')).toHaveLength(0);

    card.setConfig(base({ entities: ['sensor.load', 'sensor.solar'], max: 50 }));
    await card.updateComplete;
    const meters = qa(card, '[role=meter]');
    expect(meters).toHaveLength(2);
    expect(meters[0].getAttribute('aria-label')).toBe('Load, 42.3 W');
  });

  it('stops watching entities from the config that broke', async () => {
    // A valid config watches its limit entity; the broken one that follows fails before it is
    // watched, so that watch must be dropped rather than kept alongside the error.
    const hass = makeHass({ 'sensor.load': '42.25', 'sensor.cap': '200' });
    const card = await mount(base({ entities: ['sensor.load'], max: 'sensor.cap' }), hass);
    card.setConfig(base({ entities: ['sensor.load'], max: 'sensor.cap', decimals: 30 }));
    await card.updateComplete;
    const prev = card.hass!;
    const next = { ...prev, states: { ...prev.states, 'sensor.cap': { ...prev.states['sensor.cap'], state: '300' } } };
    card.hass = next;
    expect(card.shouldUpdate(new Map([['hass', prev]]))).toBe(false);
  });

  it('does not redraw for an unrelated entity while the error is shown', async () => {
    const card = await mountBroken(base({ min: 10, max: 5 }));
    const prev = card.hass!;
    const next = { ...prev, states: { ...prev.states, 'sensor.load': { ...prev.states['sensor.load'], state: '50' } } };
    card.hass = next;
    // No config and nothing watched: the same entity states, so nothing to draw.
    expect(card.shouldUpdate(new Map([['hass', prev]]))).toBe(false);
  });

  it('falls back to English for a language that has no config_error, and uses one that has', async () => {
    registerLanguage('zz-cfg', {});
    const fallback = await mountBroken(base({ min: 10, max: 5 }), makeHass({}, { locale: { language: 'zz-cfg' } }));
    expect(hintText(fallback)).toBe('Invalid configuration: "max" (5) must be greater than "min" (10)');

    registerLanguage('zz-cfg2', { config_error: 'Config {error}' });
    const translated = await mountBroken(base({ min: 10, max: 5 }), makeHass({}, { locale: { language: 'zz-cfg2' } }));
    expect(hintText(translated)).toBe('Config "max" (5) must be greater than "min" (10)');
  });

  it('draws again in the new language once its strings arrive', async () => {
    const card = await mountBroken(base({ min: 10, max: 5 }));
    expect(hintText(card)).toBe('Invalid configuration: "max" (5) must be greater than "min" (10)');
    card.hass = makeHass({}, { locale: { language: 'zz-late' } });
    await card.updateComplete;
    // Nothing to read yet: still English.
    expect(hintText(card)).toBe('Invalid configuration: "max" (5) must be greater than "min" (10)');
    registerLanguage('zz-late', { config_error: 'Late {error}' });
    await card.updateComplete;
    expect(hintText(card)).toBe('Late "max" (5) must be greater than "min" (10)');
  });

  it('shows an option checked while the config is normalized, such as a gauge centre', async () => {
    const card = await mountBroken({
      type: 'custom:chartdeck-card',
      style: 'ring',
      entities: ['sensor.load'],
      center: 'middle' as never,
    });
    expect(qa(card, '[role=meter]')).toHaveLength(0);
    expect(hintText(card)).toContain('"center" must be one of:');
  });
});

describe('entity and rule hints stay distinct', () => {
  beforeEach(() => resetLimitWarnings());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps a missing entity in its slot, marked unavailable, with no card hint', async () => {
    const card = await mount(base({ entities: ['sensor.nope', 'sensor.solar', 'sensor.load'], sort: 'ascending' }));
    expect(q(card, '.hint')).toBeNull();
    const meters = qa(card, '[role=meter]');
    expect(meters).toHaveLength(3);
    expect(meters[2].hasAttribute('aria-valuenow')).toBe(false);
    expect(meters[2].classList.contains('unavailable')).toBe(true);
    expect(meters[2].getAttribute('aria-label')).toContain('Entity not found');
    // The others still draw their values.
    expect(meters[0].getAttribute('aria-valuenow')).toBe('42.25');
    expect(meters[1].getAttribute('aria-valuenow')).toBe('80');
  });

  it('says none are available when hide_unavailable hides every one', async () => {
    const card = await mount(
      { type: 'custom:chartdeck-card', entities: ['sensor.u'], hide_unavailable: true },
      makeHass({ 'sensor.u': 'unavailable' }),
    );
    expect(qa(card, '[role=meter]')).toHaveLength(0);
    expect(hintText(card)).toBe('None of these entities are available.');
  });

  it('says no rule matched without confusing it with a missing entity', async () => {
    const card = await mount({ type: 'custom:chartdeck-card', include: { device_class: 'moisture' } });
    expect(qa(card, '[role=meter]')).toHaveLength(0);
    expect(hintText(card)).toBe('No entities match right now.');

    // A missing listed entity is not a rule miss: it keeps its own slot instead.
    const listed = await mount(base({ entities: ['sensor.nope'] }));
    expect(q(listed, '.hint')).toBeNull();
    expect(listed.shadowRoot!.textContent).toContain('Entity not found');
    expect(hintText(listed)).toBeUndefined();
  });

  it('says none available, not no match, when a rule matched only unavailable entities', async () => {
    // The rule did match (the battery sensors are there), they are just unavailable: hiding them
    // leaves an empty card that should not claim the rule found nothing.
    const hass = makeHass({
      'sensor.a': ['unavailable', { device_class: 'battery' }],
      'sensor.b': ['unknown', { device_class: 'battery' }],
      'sensor.x': '5',
    });
    const rule = {
      type: 'custom:chartdeck-card' as const,
      include: { device_class: 'battery' },
      hide_unavailable: true,
    };
    const ruled = await mount(rule, hass);
    expect(hintText(ruled)).toBe('None of these entities are available.');
    // Without hiding, they draw as unavailable entities instead.
    const shown = await mount({ ...rule, hide_unavailable: false }, hass);
    expect(qa(shown, '[role=meter]')).toHaveLength(2);
    expect(qa(shown, '.entity.unavailable')).toHaveLength(2);
    expect(q(shown, '.hint')).toBeNull();
  });

  it('takes each hint from its own localization key', async () => {
    registerLanguage('zz-hints', {
      no_matches: 'ZZ no matches',
      none_available: 'ZZ none available',
      entity_not_found: 'ZZ not found',
    });
    const hass = (s: Record<string, string>) => makeHass(s, { locale: { language: 'zz-hints' } });
    const none = await mount({ type: 'custom:chartdeck-card', include: { device_class: 'moisture' } }, hass({}));
    const hidden = await mount(
      { type: 'custom:chartdeck-card', entities: ['sensor.u'], hide_unavailable: true },
      hass({ 'sensor.u': 'unavailable' }),
    );
    const missing = await mount(base({ entities: ['sensor.nope'] }), hass({}));
    expect(hintText(none)).toBe('ZZ no matches');
    expect(hintText(hidden)).toBe('ZZ none available');
    expect(missing.shadowRoot!.textContent).toContain('ZZ not found');
    expect(new Set([hintText(none), hintText(hidden)])).toEqual(new Set(['ZZ no matches', 'ZZ none available']));
  });
});
