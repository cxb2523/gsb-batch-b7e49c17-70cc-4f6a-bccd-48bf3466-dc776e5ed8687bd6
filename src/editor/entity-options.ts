import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { localize } from '../localize';
import type { ChartEditorContext } from '../styles/index';
import { cachedSchema } from './chart-editors';
import { entityId, setEntityOption } from './edit';

/**
 * One field per listed entity, for an option a chart reads from each of them (its group, its
 * axis, whether it counts down). Entities matched by `include` have no row of their own, so they
 * aren't listed: they follow the card-wide setting.
 */
export function entityOptionsForm(
  ctx: ChartEditorContext,
  section: string,
  key: string,
  selector: Record<string, unknown>,
  fallback: unknown = undefined,
): TemplateResult {
  const entities = ctx.config.entities ?? [];
  const n = entities.length;
  const schema = cachedSchema(`${section}-${n}`, ctx.hass, () => entities.map((_, i) => ({ name: `e${i}`, selector })));
  const own = (i: number) => {
    const item = entities[i];
    return typeof item === 'object' ? (item as unknown as Record<string, unknown>)[key] : undefined;
  };
  const data: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) data[`e${i}`] = own(i) ?? fallback;
  const label = (s: { name: string }) => {
    const id = entityId(entities[Number(s.name.slice(1))]);
    const name = ctx.hass?.states[id]?.attributes?.friendly_name;
    return typeof name === 'string' && name ? name : id;
  };
  return html`<div class="entity-options" data-section=${section}>
    <div style="margin: 16px 0 4px; font-weight: 500">${localize(ctx.hass, `editor_${section}`)}</div>
    ${
      n === 0
        ? html`<div style="color: var(--secondary-text-color)">
            ${localize(ctx.hass, 'editor_entity_options_none')}
          </div>`
        : html`<ha-form
            .hass=${ctx.hass}
            .data=${data}
            .schema=${schema}
            .computeLabel=${label}
            @value-changed=${(ev: CustomEvent) => {
              ev.stopPropagation();
              const value = (ev.detail?.value ?? {}) as Record<string, unknown>;
              let next = ctx.config;
              for (let i = 0; i < n; i++) {
                const v = value[`e${i}`];
                const wanted = v === fallback || v === '' ? undefined : v;
                if (wanted !== own(i)) next = setEntityOption(next, i, key, wanted);
              }
              if (next !== ctx.config) ctx.commit(next);
            }}
          ></ha-form>`
    }
  </div>`;
}
