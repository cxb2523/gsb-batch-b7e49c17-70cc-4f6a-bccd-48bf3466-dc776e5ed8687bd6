import type { HassEntity, HomeAssistant } from '../../src/types';

export function makeHass(
  states: Record<string, string | [string, Record<string, unknown>]>,
  overrides: Partial<HomeAssistant> = {},
): HomeAssistant {
  const built: Record<string, HassEntity> = {};
  for (const [id, spec] of Object.entries(states)) {
    const [state, attributes] = typeof spec === 'string' ? [spec, {}] : spec;
    built[id] = { entity_id: id, state, attributes };
  }
  return {
    states: built,
    locale: { language: 'en', number_format: 'language' },
    themes: { darkMode: false },
    formatEntityState: (stateObj: HassEntity) => {
      if (stateObj.state === 'unavailable') return 'Unavailable';
      if (stateObj.state === 'unknown') return 'Unknown';
      return stateObj.state;
    },
    ...overrides,
  };
}
