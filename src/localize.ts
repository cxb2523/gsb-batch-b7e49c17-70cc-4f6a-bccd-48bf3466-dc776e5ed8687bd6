import type { HomeAssistant } from './types';
import en from './locales/en.json';

/*
 * Every sentence the card and its editor show is looked up here by key, so a dashboard set to
 * another language reads in that language. English is compiled into the bundle; every other
 * language is a chunk of its own beside it in dist/ (and on each release), fetched once, the first
 * time the page's language asks for it. That request goes out as this module loads, so the chunk
 * is normally here before the first card draws. Until it is, a sentence falls back to English
 * rather than to a raw key, and every card and editor draws again when the language lands.
 *
 * A language is tried most specific first - "pt-BR" reads pt-BR.json if there is one, then
 * pt.json - and anything a locale leaves out falls back to English, so a partial translation is
 * better than none rather than broken.
 */

const FALLBACK = 'en';

const LANGUAGES: Record<string, Record<string, string>> = { [FALLBACK]: en };

// One loader per bundled language; a dynamic import each, so rollup makes each one a chunk.
const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  nl: () => import('./locales/nl.json'),
  pt: () => import('./locales/pt.json'),
};

const loading = new Map<string, Promise<void>>();

/** Fired on window once a language's strings have arrived, so what is on screen can be drawn again. */
export const LANGUAGE_LOADED_EVENT = 'chartdeck-language-loaded';

/** The languages that can be loaded, English included. */
export const AVAILABLE_LANGUAGES = [FALLBACK, ...Object.keys(LOADERS)];

/** "pt-BR" is worth trying as "pt" too, most specific first. */
function candidatesFor(language: string): string[] {
  const candidates = [language];
  if (language.includes('-')) candidates.push(language.split('-')[0]);
  return candidates;
}

/**
 * Makes a language's strings available, fetching its chunk the first time. Resolves at once for
 * English, for a language already here, and for one this card does not have.
 */
export function ensureLanguage(language: string): Promise<void> {
  const wanted = candidatesFor(language).find((candidate) => LOADERS[candidate] !== undefined);
  if (!wanted || LANGUAGES[wanted]) return Promise.resolve();
  let pending = loading.get(wanted);
  if (!pending) {
    pending = LOADERS[wanted]()
      .then((module) => registerLanguage(wanted, module.default))
      .catch(() => {
        // Left in English; asked for again the next time something needs the language.
        loading.delete(wanted);
      });
    loading.set(wanted, pending);
  }
  return pending;
}

/** Puts a language's strings in place without fetching anything: the loader's last step, and the tests' way in. */
export function registerLanguage(code: string, strings: Record<string, string>): void {
  LANGUAGES[code] = strings;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LANGUAGE_LOADED_EVENT));
}

/** Calls back whenever a language lands; returns what to call to stop listening. */
export function onLanguageLoaded(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(LANGUAGE_LOADED_EVENT, listener);
  return () => window.removeEventListener(LANGUAGE_LOADED_EVENT, listener);
}

/** The language the user asked for, e.g. `de` or `pt-BR`. */
function requestedLanguage(hass: HomeAssistant | undefined): string {
  return hass?.locale?.language ?? hass?.language ?? FALLBACK;
}

/**
 * The language the strings are coming from right now: the user's, once its chunk is here,
 * otherwise English (and the chunk is asked for). Editor schemas are cached under this, so a cache
 * filled in English before the language arrived is passed over once it has.
 */
export function languageOf(hass: HomeAssistant | undefined): string {
  const requested = requestedLanguage(hass);
  const here = candidatesFor(requested).find((candidate) => LANGUAGES[candidate] !== undefined);
  if (here) return here;
  void ensureLanguage(requested);
  return FALLBACK;
}

/** Look up a string for the user's language, falling back to English, then to the key. */
export function localize(hass: HomeAssistant | undefined, key: string, vars?: Record<string, string | number>): string {
  const template = LANGUAGES[languageOf(hass)][key] ?? LANGUAGES[FALLBACK][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/*
 * Asked for as the resource loads, from the language Home Assistant keeps on its root element or
 * stores for the user, so the chunk is normally here before the first card draws.
 */
function pageLanguage(): string | undefined {
  if (typeof document !== 'undefined') {
    const hass = (document.querySelector('home-assistant') as { hass?: HomeAssistant } | null)?.hass;
    const live = hass?.locale?.language ?? hass?.language;
    if (live) return live;
  }
  try {
    // Home Assistant stores the user's chosen language here, JSON-encoded.
    const stored = JSON.parse(globalThis.localStorage?.getItem('selectedLanguage') ?? 'null');
    if (typeof stored === 'string' && stored) return stored;
  } catch {
    // Anything unreadable is the same as nothing stored.
  }
  return undefined;
}

{
  const language = pageLanguage();
  if (language) void ensureLanguage(language);
}
