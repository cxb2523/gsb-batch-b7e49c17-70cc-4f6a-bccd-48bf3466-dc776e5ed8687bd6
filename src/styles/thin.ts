import { css, html, nothing } from 'lit';
import type { ValueStyleModule } from './index';
import { iconOverride } from '../resolve';

/** Thin bar: name and value above an 8 px track. */
export const thin: ValueStyleModule = {
  layout: 'rows',
  group: 'bars',
  height: 44,
  minColumnWidth: 140,
  styles: css`
    .style-thin .entity {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 0;
    }
    .style-thin .icon {
      flex: none;
      color: var(--state-icon-color, var(--secondary-text-color));
      --mdc-icon-size: 22px;
    }
    .style-thin .body {
      flex: 1;
      min-width: 0;
    }
    .style-thin .top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 14px;
      margin-bottom: 7px;
      color: var(--primary-text-color);
    }
    .style-thin .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .style-thin .value {
      flex: none;
      white-space: nowrap;
      margin-left: auto;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .style-thin .track {
      position: relative;
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
      background: var(--cd-track);
    }
    .style-thin .fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(var(--start) * 100%);
      width: calc((var(--end) - var(--start)) * 100%);
      border-radius: 4px;
      background: var(--c-start);
      background-image: linear-gradient(90deg, var(--c-start), var(--c-end));
      transition:
        left var(--cd-duration) var(--cd-easing),
        width var(--cd-duration) var(--cd-easing);
    }
    .style-thin .target {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      left: calc(var(--target) * (100% - 2px));
      background: var(--primary-text-color);
      transition: left var(--cd-duration) var(--cd-easing);
    }
  `,
  render(e, { show, hass }) {
    // An unavailable or missing sensor always says so, even with the value hidden.
    const value = show.value || !e.available;
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
      <div class="body">
        ${
          show.name || value
            ? html`<div class="top">
                ${show.name ? html`<span class="name">${e.name}</span>` : nothing}
                ${value ? html`<span class="value">${e.display}</span>` : nothing}
              </div>`
            : nothing
        }
        <div class="track">
          <div class="fill"></div>
          ${show.target && e.targetPosition !== null && e.available ? html`<div class="target"></div>` : nothing}
        </div>
      </div>
    `;
  },
};
