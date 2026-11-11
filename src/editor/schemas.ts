import { languageOf, localize } from '../localize';
import type { CardConfig, HomeAssistant } from '../types';
import { setOption } from './edit';
import { MAX_LINE_WIDTH, MIN_LINE_WIDTH } from '../chart/series-style';
import { GHOST_SPANS } from '../gauge';
import { convertibleUnits } from '../units';

/** One ha-form field and where it lives in the card config. */
export interface FieldBinding {
  name: string;
  path: string[];
  /** The value the card uses when the key is absent; setting it removes the key. */
  default?: unknown;
}

export const TITLE_FIELDS: FieldBinding[] = [{ name: 'title', path: ['title'] }];

/** The Display section's on/off switches, drawn as compact rows by the editor itself. */
export const DISPLAY_TOGGLE_FIELDS: FieldBinding[] = [
  { name: 'show_name', path: ['show', 'name'], default: true },
  { name: 'show_value', path: ['show', 'value'], default: true },
  { name: 'show_icon', path: ['show', 'icon'], default: true },
  { name: 'show_target', path: ['show', 'target'], default: true },
  { name: 'show_legend', path: ['show', 'legend'], default: false },
  { name: 'animate', path: ['animate'], default: true },
  { name: 'hide_unavailable', path: ['hide_unavailable'], default: false },
];

/** The Colours section's switch, drawn like the Display ones. */
export const COLOUR_TOGGLE_FIELDS: FieldBinding[] = [{ name: 'color_icon', path: ['color_icon'], default: false }];

/** The rest of the Display section, in an ha-form. */
export const DISPLAY_FIELDS: FieldBinding[] = [
  { name: 'columns', path: ['columns'] },
  { name: 'sort', path: ['sort'], default: 'none' },
  { name: 'limit', path: ['limit'] },
  { name: 'decimals', path: ['decimals'] },
  { name: 'unit', path: ['unit'] },
];

export const ACTION_FIELDS: FieldBinding[] = [
  { name: 'tap_action', path: ['tap_action'], default: { action: 'more-info' } },
  { name: 'hold_action', path: ['hold_action'], default: { action: 'none' } },
  { name: 'double_tap_action', path: ['double_tap_action'], default: { action: 'none' } },
];

/** Ring, arc and needle options, under the style picker. Empty angles use the style's own. */
export const GAUGE_FIELDS: FieldBinding[] = [
  { name: 'start_angle', path: ['start_angle'] },
  { name: 'end_angle', path: ['end_angle'] },
  { name: 'center', path: ['center'], default: 'value' },
  { name: 'center_text', path: ['center_text'] },
  { name: 'tick_labels', path: ['tick_labels'], default: false },
  { name: 'ghost', path: ['ghost'], default: 'off' },
];

const gaugeSchemas = new Map<string, unknown[]>();

/**
 * The gauge options for a style: the text field only while the centre shows custom text, and tick
 * labels only on the needle (ring and arc have no scale).
 */
export function gaugeSchema(hass: HomeAssistant | undefined, style: string, center: unknown) {
  const text = center === 'text';
  const key = `${languageOf(hass)}|${style}|${text}`;
  let schema = gaugeSchemas.get(key);
  if (!schema) {
    const angle = { number: { min: -360, max: 360, step: 1, mode: 'box', unit_of_measurement: '°' } };
    schema = [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'start_angle', selector: angle },
          { name: 'end_angle', selector: angle },
        ],
      },
      {
        name: 'center',
        selector: {
          select: {
            mode: 'dropdown',
            options: ['value', 'band', 'name', 'text', 'none'].map((value) => ({
              value,
              label: localize(hass, `editor_center_mode_${value}`),
            })),
          },
        },
      },
      ...(text ? [{ name: 'center_text', selector: { text: {} } }] : []),
      ...(style === 'needle' ? [{ name: 'tick_labels', selector: { boolean: {} } }] : []),
      {
        name: 'ghost',
        selector: {
          select: {
            mode: 'dropdown',
            options: GHOST_SPANS.map((value) => ({ value, label: localize(hass, `editor_ghost_${value}`) })),
          },
        },
      },
    ];
    gaugeSchemas.set(key, schema);
  }
  return schema;
}

/** Per-entity overrides edited through ha-form; paths are relative to the entity object. */
export const ENTITY_TEXT_FIELDS: FieldBinding[] = [
  { name: 'name', path: ['name'] },
  { name: 'unit', path: ['unit'] },
  { name: 'decimals', path: ['decimals'] },
];

export const ENTITY_ATTRIBUTE_FIELDS: FieldBinding[] = [{ name: 'attribute', path: ['attribute'] }];

/** Per-series options, shown only when the card is a chart. */
export const ENTITY_SERIES_FIELDS: FieldBinding[] = [
  { name: 'series_color', path: ['color'] },
  { name: 'curve', path: ['curve'] },
  { name: 'line_width', path: ['line_width'] },
  { name: 'dash', path: ['dash'], default: false },
  { name: 'on_top', path: ['on_top'], default: false },
];

/** Line width in px, for the card and for each series. */
export const LINE_WIDTH_SELECTOR = {
  number: { min: MIN_LINE_WIDTH, max: MAX_LINE_WIDTH, step: 0.5, mode: 'box', unit_of_measurement: 'px' },
};

const seriesFields = new Map<boolean, FieldBinding[]>();

/**
 * The series fields, with the dots switch showing the card's setting until the entity sets its
 * own; switching it back to the card's setting removes the entity's key.
 */
export function entitySeriesFields(cardDots: boolean): FieldBinding[] {
  let fields = seriesFields.get(cardDots);
  if (!fields) {
    fields = [...ENTITY_SERIES_FIELDS, { name: 'dots', path: ['dots'], default: cardDots }];
    seriesFields.set(cardDots, fields);
  }
  return fields;
}

/** Absent per-entity actions inherit the card's, so there are no defaults here. */
export const ENTITY_ACTION_FIELDS: FieldBinding[] = ACTION_FIELDS.map(({ name, path }) => ({ name, path }));

// Schemas are built once (or once per language) so ha-form isn't handed a new array on every render.
const TITLE_SCHEMA = [{ name: 'title', selector: { text: {} } }];
const ACTIONS_SCHEMA = ACTION_FIELDS.map(({ name }) => ({ name, selector: { ui_action: {} } }));
const ENTITY_TEXT_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'name', selector: { text: {} } },
      { name: 'unit', selector: { text: {} } },
      { name: 'decimals', selector: { number: { min: 0, max: 20, mode: 'box' } } },
    ],
  },
];

const attributeSchemas = new Map<string, unknown[]>();

/** The attribute picker lists the chosen entity's attributes, so there is one schema per entity. */
export function entityAttributeSchema(entityId: string) {
  let schema = attributeSchemas.get(entityId);
  if (!schema) {
    schema = [{ name: 'attribute', selector: { attribute: { entity_id: entityId } } }];
    attributeSchemas.set(entityId, schema);
  }
  return schema;
}

let seriesCache: { language: string; schema: unknown[] } | undefined;

/** Colour, line shape, width, dashes, dots and drawing order for one series. Empty ones follow the card. */
export function entitySeriesSchema(hass?: HomeAssistant) {
  const language = languageOf(hass);
  if (seriesCache?.language !== language) {
    const t = (key: string) => localize(hass, key);
    seriesCache = {
      language,
      schema: [
        {
          type: 'grid',
          name: '',
          schema: [
            { name: 'series_color', selector: { text: {} } },
            {
              name: 'curve',
              selector: {
                select: {
                  mode: 'dropdown',
                  options: ['smooth', 'straight', 'step'].map((value) => ({
                    value,
                    label: t(`editor_curve_${value}`),
                  })),
                },
              },
            },
          ],
        },
        {
          type: 'grid',
          name: '',
          schema: [
            { name: 'line_width', selector: LINE_WIDTH_SELECTOR },
            { name: 'dash', selector: { boolean: {} } },
            { name: 'dots', selector: { boolean: {} } },
            { name: 'on_top', selector: { boolean: {} } },
          ],
        },
      ],
    };
  }
  return seriesCache.schema;
}

export function titleSchema() {
  return TITLE_SCHEMA;
}

export function actionsSchema() {
  return ACTIONS_SCHEMA;
}

const unitSchemas = new Map<string, unknown[]>();

/**
 * Name, unit and decimals. When the sensor's unit is one the card converts (W, °F, m/s…), the unit
 * offers the units it converts to; any other text can still be typed and is shown as written.
 */
export function entityTextSchema(sensorUnit?: string) {
  const units = convertibleUnits(sensorUnit);
  if (units.length === 0) return ENTITY_TEXT_SCHEMA;
  const key = units[0];
  let schema = unitSchemas.get(key);
  if (!schema) {
    const grid = ENTITY_TEXT_SCHEMA[0];
    schema = [
      {
        ...grid,
        schema: grid.schema.map((field) =>
          field.name === 'unit'
            ? { name: 'unit', selector: { select: { mode: 'dropdown', custom_value: true, options: units } } }
            : field,
        ),
      },
    ];
    unitSchemas.set(key, schema);
  }
  return schema;
}

export function entityActionsSchema() {
  return ACTIONS_SCHEMA;
}

function buildDisplaySchema(hass?: HomeAssistant) {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'columns', selector: { number: { min: 1, max: 6, mode: 'box' } } },
        {
          name: 'sort',
          selector: {
            select: {
              mode: 'dropdown',
              options: ['none', 'ascending', 'descending'].map((value) => ({
                value,
                label: localize(hass, `editor_sort_${value}`),
              })),
            },
          },
        },
        { name: 'limit', selector: { number: { min: 1, mode: 'box' } } },
        { name: 'decimals', selector: { number: { min: 0, max: 20, mode: 'box' } } },
        { name: 'unit', selector: { text: {} } },
      ],
    },
  ];
}

/** The keys each rule form offers, in order. */
export const RULE_FIELDS = {
  include: ['device_class', 'area', 'floor', 'label', 'domain'],
  exclude: ['entity', 'device_class', 'area', 'floor', 'label', 'domain'],
} as const;

/** Device classes and domains present in this home, offered (with typing allowed) in the rule forms. */
function ruleOptions(hass?: HomeAssistant): { deviceClasses: string[]; domains: string[] } {
  const deviceClasses = new Set<string>();
  const domains = new Set<string>();
  for (const state of Object.values(hass?.states ?? {})) {
    const dc = state.attributes?.device_class;
    if (typeof dc === 'string' && dc) deviceClasses.add(dc);
    domains.add(state.entity_id.slice(0, state.entity_id.indexOf('.')));
  }
  return { deviceClasses: [...deviceClasses].sort(), domains: [...domains].sort() };
}

function ruleSelector(key: string, options: { deviceClasses: string[]; domains: string[] }) {
  const pick = (values: string[]) => ({
    select: { multiple: true, custom_value: true, mode: 'dropdown', options: values },
  });
  switch (key) {
    case 'device_class':
      return pick(options.deviceClasses);
    case 'domain':
      return pick(options.domains);
    case 'entity':
      return { entity: { multiple: true } };
    default:
      return { [key]: { multiple: true } };
  }
}

const ruleCache = new Map<string, { key: string; schema: unknown[] }>();

/** The include or exclude form, rebuilt only when the home's device classes or domains change. */
export function ruleSchema(field: 'include' | 'exclude', hass?: HomeAssistant) {
  const options = ruleOptions(hass);
  const key = `${options.deviceClasses.join()}|${options.domains.join()}`;
  const cached = ruleCache.get(field);
  if (cached?.key === key) return cached.schema;
  const schema = RULE_FIELDS[field].map((name) => ({
    name: `${field}_${name}`,
    selector: ruleSelector(name, options),
  }));
  ruleCache.set(field, { key, schema });
  return schema;
}

let displayCache: { language: string; schema: ReturnType<typeof buildDisplaySchema> } | undefined;

/** The Display schema, rebuilt only when the user's language changes. */
export function displaySchema(hass?: HomeAssistant) {
  const language = languageOf(hass);
  if (displayCache?.language !== language) displayCache = { language, schema: buildDisplaySchema(hass) };
  return displayCache.schema;
}

function getIn(config: CardConfig, path: string[]): unknown {
  let node: unknown = config;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** ha-form data for `fields`: the raw value, or the default so toggles show the effective value. */
export function formData(config: CardConfig, fields: FieldBinding[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = getIn(config, field.path) ?? field.default;
    if (value !== undefined) data[field.name] = value;
  }
  return data;
}

/**
 * Apply an ha-form value to `config`. Only fields whose value actually changed are written, so an
 * untouched config round-trips exactly; a value equal to its default removes the key.
 */
export function applyFormData(config: CardConfig, fields: FieldBinding[], value: Record<string, unknown>): CardConfig {
  const before = formData(config, fields);
  let next = config;
  for (const field of fields) {
    const v = value[field.name];
    if (deepEqual(before[field.name], v)) continue;
    next = setOption(next, field.path, field.default !== undefined && deepEqual(v, field.default) ? undefined : v);
  }
  return next;
}
