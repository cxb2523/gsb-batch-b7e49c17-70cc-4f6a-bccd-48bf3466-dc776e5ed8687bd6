import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { LanguageController } from '../src/language-controller';
import {
  AVAILABLE_LANGUAGES,
  LANGUAGE_LOADED_EVENT,
  ensureLanguage,
  languageOf,
  localize,
  onLanguageLoaded,
  registerLanguage,
} from '../src/localize';
import type { HomeAssistant } from '../src/types';

const hassIn = (language: string) => ({ locale: { language } }) as unknown as HomeAssistant;

const LOCALES = join(__dirname, '..', 'src', 'locales');
const read = (file: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALES, file), 'utf8'));
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('localize', () => {
  it('reads English and fills placeholders', () => {
    expect(localize(undefined, 'entity_not_found')).toBe('Entity not found');
    expect(localize(undefined, 'editor_not_found', { entity: 'sensor.x' })).toBe('sensor.x (not found)');
  });

  it('leaves an unknown placeholder alone and returns an unknown key as itself', () => {
    expect(localize(undefined, 'editor_not_found', {})).toBe('{entity} (not found)');
    expect(localize(undefined, 'no_such_key')).toBe('no_such_key');
  });

  it('falls back to English for a language it does not have', () => {
    expect(languageOf(hassIn('xx'))).toBe('en');
    expect(localize(hassIn('xx'), 'unavailable')).toBe('Unavailable');
  });

  it('uses a registered language, region first, and English for what it leaves out', () => {
    registerLanguage('zz', { unavailable: 'Zz unavailable' });
    expect(localize(hassIn('zz'), 'unavailable')).toBe('Zz unavailable');
    expect(localize(hassIn('zz-YY'), 'unavailable')).toBe('Zz unavailable');
    expect(localize(hassIn('zz'), 'entity_not_found')).toBe('Entity not found');
    registerLanguage('zz-YY', { unavailable: 'Regional' });
    expect(localize(hassIn('zz-YY'), 'unavailable')).toBe('Regional');
  });

  it('reads hass.language when there is no locale', () => {
    registerLanguage('qq', { unavailable: 'Qq' });
    expect(localize({ language: 'qq' } as unknown as HomeAssistant, 'unavailable')).toBe('Qq');
  });

  it('answers in English until a bundled language loads, then announces it', async () => {
    const heard = vi.fn();
    const stop = onLanguageLoaded(heard);
    expect(languageOf(hassIn('de'))).toBe('en');
    await ensureLanguage('de');
    expect(heard).toHaveBeenCalled();
    expect(languageOf(hassIn('de-AT'))).toBe('de');
    expect(localize(hassIn('de'), 'unavailable')).toBe(read('de.json').unavailable);
    stop();
  });

  it('resolves at once for English and for a language it does not bundle', async () => {
    await expect(ensureLanguage('en')).resolves.toBeUndefined();
    await expect(ensureLanguage('xx-YY')).resolves.toBeUndefined();
  });
});

describe('locale files', () => {
  const english = read('en.json');
  const files = readdirSync(LOCALES).filter((name) => name.endsWith('.json'));

  it('bundles a file for every available language and nothing else', () => {
    expect(files.map((name) => name.replace('.json', '')).sort()).toEqual([...AVAILABLE_LANGUAGES].sort());
  });

  it.each(files.filter((name) => name !== 'en.json'))('%s has every English key and the same placeholders', (file) => {
    const strings = read(file);
    expect(Object.keys(strings)).toEqual(Object.keys(english));
    for (const [key, text] of Object.entries(english)) {
      expect(typeof strings[key], key).toBe('string');
      expect(strings[key].trim(), key).not.toBe('');
      expect(placeholders(strings[key]), key).toBe(placeholders(text));
    }
  });
});

describe('LanguageController', () => {
  it('asks its element to draw again while connected, and stops once disconnected', () => {
    const host = { addController: vi.fn(), requestUpdate: vi.fn() };
    const controller = new LanguageController(host as never);
    expect(host.addController).toHaveBeenCalledWith(controller);
    controller.hostConnected();
    window.dispatchEvent(new Event(LANGUAGE_LOADED_EVENT));
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
    controller.hostDisconnected();
    window.dispatchEvent(new Event(LANGUAGE_LOADED_EVENT));
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
  });
});
