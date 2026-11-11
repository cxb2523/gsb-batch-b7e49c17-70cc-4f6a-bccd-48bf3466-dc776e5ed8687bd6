import { css, html, nothing } from 'lit';
import type { ValueStyleModule } from './index';
import { iconOverride } from '../resolve';

/** Vertical tank: a 40 x 140 tube that fills from the bottom. */
export const tank: ValueStyleModule = {
  layout: 'tiles',
  group: 'bars',
  height: 230,
  tilesPerRow: 4,
  minColumnWidth: 80,
  styles: css`
    .style-tank .entity {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      padding: 6px 0;
    }
    /* Equal-width tiles, so tubes are evenly spaced and wrapped rows line up. */
    .style-tank .layout-tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      align-items: end;
    }
    .style-tank .icon {
      color: var(--state-icon-color, var(--secondary-text-color));
      --mdc-icon-size: 22px;
    }
    .style-tank .value {
      font-size: 13px;
      text-align: center;
      color: var(--primary-text-color);
    }
    .style-tank .tube {
      position: relative;
      width: 40px;
      height: 140px;
      border-radius: 10px;
      overflow: hidden;
      background: var(--cd-track);
    }
    .style-tank .fill {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(var(--start) * 100%);
      height: calc((var(--end) - var(--start)) * 100%);
      border-radius: 10px;
      background: var(--c-start);
      background-image: linear-gradient(0deg, var(--c-start), var(--c-end));
      transition:
        bottom var(--cd-duration) var(--cd-easing),
        height var(--cd-duration) var(--cd-easing);
    }
    .style-tank .target {
      position: absolute;
      left: 0;
      right: 0;
      height: 3px;
      bottom: calc(var(--target) * (100% - 3px));
      background: var(--primary-text-color);
      transition: bottom var(--cd-duration) var(--cd-easing);
    }
    .style-tank .name {
      max-width: 100%;
      font-size: 12px;
      color: var(--secondary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  render(e, { show, hass }) {
    return html`
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
      ${show.value || !e.available ? html`<span class="value">${e.display}</span>` : nothing}
      <div class="tube">
        <div class="fill"></div>
        ${show.target && e.targetPosition !== null && e.available ? html`<div class="target"></div>` : nothing}
      </div>
      ${show.name ? html`<span class="name">${e.name}</span>` : nothing}
    `;
  },
};
