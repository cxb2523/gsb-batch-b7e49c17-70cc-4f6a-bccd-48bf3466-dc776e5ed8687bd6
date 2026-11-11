import { css, html, nothing } from 'lit';
import type { ValueStyleModule } from './index';
import { iconOverride } from '../resolve';

const CELLS = 10;

/** Which of the 10 cells are lit: cell i is lit when its centre lies in the span (start exclusive, end inclusive). */
export function litCells(span: [number, number]): boolean[] {
  const [start, end] = span;
  return Array.from({ length: CELLS }, (_, i) => {
    const centre = (i + 0.5) / CELLS;
    return centre > start && centre <= end;
  });
}

/** Segmented bar: ten cells that light in sequence. */
export const segmented: ValueStyleModule = {
  layout: 'rows',
  group: 'bars',
  height: 50,
  minColumnWidth: 180,
  styles: css`
    /* Each row is measured on its own, so a narrow column (columns: 2 or 3) switches layout
       even when the card as a whole is wide. A container can't restyle itself, hence .seg. */
    .style-segmented .entity {
      container-type: inline-size;
      padding: 6px 0;
    }
    .style-segmented .seg {
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }
    .style-segmented .icon {
      flex: none;
      align-self: flex-end;
      color: var(--state-icon-color, var(--secondary-text-color));
      --mdc-icon-size: 22px;
    }
    .style-segmented .body {
      flex: 1;
      min-width: 0;
    }
    .style-segmented .name {
      display: flex;
      gap: 8px;
      font-size: 14px;
      margin-bottom: 6px;
      white-space: nowrap;
      color: var(--primary-text-color);
    }
    .style-segmented .name .label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .style-segmented .name .status {
      flex: none;
      margin-left: auto;
      color: var(--secondary-text-color);
    }
    .style-segmented .cells {
      display: flex;
      gap: 4px;
      height: 20px;
    }
    .style-segmented .cell {
      position: relative;
      flex: 1;
      border-radius: 4px;
      background: var(--cd-track);
    }
    .style-segmented .cell::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 4px;
      background: var(--c-start);
      background-image: linear-gradient(180deg, var(--c-start), var(--c-end));
      opacity: 0;
      transition: opacity calc(var(--cd-duration) / 3) var(--cd-easing);
    }
    .style-segmented .cell.on::before {
      opacity: 1;
      transition-delay: calc(var(--i) * 45ms);
    }
    :host(:not([ready])) .style-segmented .cell::before {
      opacity: 0;
      transition-delay: 0s;
    }
    .style-segmented .cell.mark {
      outline: 2px solid var(--primary-text-color);
      outline-offset: 0;
    }
    /* Every row reserves the card's longest value (--cd-value-ch), so the cell strips line up,
       but never more than about a third (35 %) of the row. */
    .style-segmented .value {
      flex: none;
      min-width: min(max(48px, calc(var(--cd-value-ch, 4) * 1ch + 4px)), 35%);
      white-space: nowrap;
      text-align: right;
      font-size: 14px;
      padding-bottom: 2px;
      color: var(--primary-text-color);
    }
    /* Narrow cards: the value joins the name line so the cells get the full width. */
    @container (max-width: 279px) {
      .style-segmented .seg {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        grid-template-areas:
          'icon name value'
          'icon cells cells';
        column-gap: 12px;
        align-items: end;
      }
      .style-segmented .body {
        display: contents;
      }
      .style-segmented .icon {
        grid-area: icon;
      }
      .style-segmented .name {
        grid-area: name;
      }
      .style-segmented .cells {
        grid-area: cells;
        gap: 2px;
      }
      .style-segmented .value {
        grid-area: value;
        min-width: 0;
        margin-bottom: 6px;
        padding-bottom: 0;
      }
    }
  `,
  render(e, { show, hass }) {
    const lit = e.available ? litCells(e.span) : litCells([0, 0]);
    const mark =
      show.target && e.available && e.targetPosition !== null
        ? Math.min(CELLS - 1, Math.max(0, Math.floor(e.targetPosition * CELLS)))
        : -1;
    // Status text ("Unavailable") is wider than a reading, so it goes on the name line and
    // the row keeps an empty value slot: every row's cells then end at the same place.
    const status = !e.available;
    return html`<div class="seg">
      ${
        show.icon
          ? html`<ha-state-icon
              class="icon"
              .hass=${hass}
              .stateObj=${e.stateObj}
              .icon=${iconOverride(e)}
            ></ha-state-icon>`
          : nothing
      }
      <div class="body">
        ${
          show.name || status
            ? html`<div class="name">
                ${show.name ? html`<span class="label">${e.name}</span>` : nothing}
                ${status ? html`<span class="status">${e.display}</span>` : nothing}
              </div>`
            : nothing
        }
        <div class="cells">
          ${lit.map(
            (on, i) => html`<i class="cell ${on ? 'on' : ''} ${i === mark ? 'mark' : ''}" style="--i:${i}"></i>`,
          )}
        </div>
      </div>
      ${show.value ? html`<span class="value">${e.available ? e.display : ''}</span>` : nothing}
    </div>`;
  },
};
