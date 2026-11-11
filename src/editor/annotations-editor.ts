import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { ANNOTATION_TYPES, POINT_AT, timeList } from '../chart/annotations';
import { THRESHOLD_ZONES } from '../chart/threshold-history';
import type { Annotation, AnnotationType } from '../chart/annotations';
import { languageOf, localize } from '../localize';
import type { ChartEditorContext } from '../styles/index';
import type { Band, CardConfig, HomeAssistant } from '../types';
import './bands-editor';

const DELETE_ICON = 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';

/** The fields each kind of annotation has, after its kind; label and colour come last. */
const FIELDS: Record<AnnotationType, string[]> = {
  line: ['value', 'dash', 'history', 'zone'],
  band: ['from', 'to'],
  time: ['times'],
  state: ['entity', 'state', 'shade'],
  point: ['at', 'series'],
};

/** A field's default: setting it back removes the key. */
const DEFAULTS: Record<string, unknown> = { dash: true, shade: false, at: 'max', history: false, zone: 'none' };

function select(hass: HomeAssistant | undefined, prefix: string, values: readonly string[]) {
  return {
    select: {
      mode: 'dropdown',
      options: values.map((value) => ({ value, label: localize(hass, `editor_annotation_${prefix}_${value}`) })),
    },
  };
}

const schemas = new Map<string, unknown[]>();

/** One annotation's form: its kind, its own fields, then label and colour. */
export function annotationSchema(type: AnnotationType, hass: HomeAssistant | undefined, entities: string[]) {
  const k = `${type}|${languageOf(hass)}|${entities.join(',')}`;
  let schema = schemas.get(k);
  if (schema) return schema;
  const selectors: Record<string, unknown> = {
    value: { text: {} },
    from: { text: {} },
    to: { text: {} },
    times: { text: {} },
    entity: { entity: {} },
    series: { entity: { include_entities: entities } },
    state: { text: {} },
    shade: { boolean: {} },
    dash: { boolean: {} },
    at: select(hass, 'at', POINT_AT),
    history: { boolean: {} },
    zone: select(hass, 'zone', ['none', ...THRESHOLD_ZONES]),
  };
  schema = [
    { name: 'type', selector: select(hass, 'type', ANNOTATION_TYPES) },
    ...FIELDS[type].map((name) => ({ name, selector: selectors[name] })),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'label', selector: { text: {} } },
        { name: 'color', selector: { text: {} } },
      ],
    },
  ];
  schemas.set(k, schema);
  return schema;
}

/** An annotation as form data: values as text, times joined, defaults filled in. */
export function annotationData(a: Annotation): Record<string, unknown> {
  const data: Record<string, unknown> = { type: a.type };
  for (const name of [...FIELDS[a.type], 'label', 'color']) {
    const key = name === 'series' ? 'entity' : name;
    let v = (a as unknown as Record<string, unknown>)[key];
    if (name === 'times') v = timeList(a.times).join(', ');
    else if ((name === 'value' || name === 'from' || name === 'to') && v !== undefined) v = String(v);
    data[name] = v ?? DEFAULTS[name];
  }
  return data;
}

/**
 * Form data back to an annotation. Blank fields and defaults are left out, numbers typed as text
 * become numbers, and times become a list. A new kind keeps only the label and colour.
 */
export function annotationFromData(data: Record<string, unknown>, before: Annotation): Annotation {
  const type = (data.type as AnnotationType) ?? before.type;
  const out: Record<string, unknown> = { type };
  const names = type === before.type ? [...FIELDS[type], 'label', 'color'] : ['label', 'color'];
  for (const name of names) {
    let v = data[name];
    if (typeof v === 'string') v = v.trim();
    if (v === undefined || v === '' || v === DEFAULTS[name]) continue;
    if ((name === 'value' || name === 'from' || name === 'to') && Number.isFinite(Number(v))) v = Number(v);
    if (name === 'times') v = timeList(v as string);
    out[name === 'series' ? 'entity' : name] = v;
  }
  // The zone's bands have their own editor under the form: keep them while the kind stays.
  if (type === before.type && before.severity !== undefined) out.severity = before.severity;
  return out as unknown as Annotation;
}

/** A line with its zone's bands set, or removed when there are none. */
export function withSeverity(a: Annotation, bands: Band[] | undefined): Annotation {
  const next = { ...a };
  if (bands && bands.length) next.severity = bands;
  else delete next.severity;
  return next;
}

/** The card config with its annotation list replaced (and the key gone once it is empty). */
export function withAnnotations(config: CardConfig, list: Annotation[]): CardConfig {
  const next = { ...config };
  if (list.length) next.annotations = list;
  else delete next.annotations;
  return next;
}

/** Starting values for a new annotation of each kind. */
function fresh(type: AnnotationType, config: CardConfig): Annotation {
  if (type === 'line') return { type, value: 0 };
  if (type === 'band') return { type, from: 0, to: 1 };
  if (type === 'time') return { type, times: ['07:00'] };
  if (type === 'state') {
    const first = (config.entities ?? [])[0];
    return { type, entity: typeof first === 'string' ? first : (first?.entity ?? 'sensor.example'), state: 'on' };
  }
  return { type, at: 'max' };
}

/**
 * The Annotations part of a history chart's editor: one form per annotation, each with a remove
 * button, then a row of buttons to add one of each kind.
 */
export function annotationsEditor(ctx: ChartEditorContext): TemplateResult {
  const list = Array.isArray(ctx.config.annotations) ? (ctx.config.annotations as Annotation[]) : [];
  const entities = (ctx.config.entities ?? []).map((e) => (typeof e === 'string' ? e : e.entity));
  const t = (k: string) => localize(ctx.hass, k);
  const replace = (i: number, a?: Annotation) => {
    const next = [...list];
    if (a) next[i] = a;
    else next.splice(i, 1);
    ctx.commit(withAnnotations(ctx.config, next));
  };
  return html`<style>
      .annotations-title {
        font-weight: 500;
        margin: 16px 0 4px;
      }
      .annotation {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px;
        align-items: start;
        padding: 8px 0;
        border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      }
      .annotation-bands-title {
        margin: 8px 0 0;
        color: var(--secondary-text-color);
      }
      .annotation-add {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        color: var(--secondary-text-color);
      }
      .annotation-add button {
        padding: 4px 10px;
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
        border-radius: 8px;
        background: none;
        color: var(--primary-color);
        font: inherit;
        cursor: pointer;
      }
      .annotation-add button:focus-visible {
        outline: 2px solid var(--primary-color, #03a9f4);
        outline-offset: 2px;
      }
    </style>
    <div class="annotations">
      <div class="annotations-title">${t('editor_annotations')}</div>
      ${list.map(
        (a, i) =>
          html`<div class="annotation" data-index=${i}>
            <div class="annotation-fields">
              <ha-form
                data-section="annotation"
                .hass=${ctx.hass}
                .data=${annotationData(a)}
                .schema=${annotationSchema(ANNOTATION_TYPES.includes(a.type) ? a.type : 'line', ctx.hass, entities)}
                .computeLabel=${(s: { name: string }) => t(`editor_annotation_${s.name}`)}
                @value-changed=${(ev: CustomEvent) => {
                  ev.stopPropagation();
                  replace(i, annotationFromData((ev.detail?.value ?? {}) as Record<string, unknown>, a));
                }}
              ></ha-form>
              ${
                a.type === 'line' && a.zone !== undefined
                  ? html`<div class="annotation-bands">
                      <div class="annotation-bands-title">${t('editor_annotation_severity')}</div>
                      <cd-bands-editor
                        .hass=${ctx.hass}
                        .bands=${a.severity}
                        @value-changed=${(ev: CustomEvent) => {
                          ev.stopPropagation();
                          replace(i, withSeverity(a, ev.detail?.value as Band[] | undefined));
                        }}
                      ></cd-bands-editor>
                    </div>`
                  : nothing
              }
            </div>
            <ha-icon-button
              class="remove"
              .path=${DELETE_ICON}
              .label=${t('editor_annotation_remove')}
              @click=${() => replace(i)}
            ></ha-icon-button>
          </div>`,
      )}
      <div class="annotation-add">
        <span>${t('editor_annotation_add')}</span>
        ${ANNOTATION_TYPES.map(
          (type) =>
            html`<button
              type="button"
              data-type=${type}
              @click=${() => ctx.commit(withAnnotations(ctx.config, [...list, fresh(type, ctx.config)]))}
            >
              + ${t(`editor_annotation_add_${type}`)}
            </button>`,
        )}
      </div>
    </div>`;
}
