import { css, html, nothing } from 'lit';
import { onFillText } from '../bands';
import type { ValueStyleModule } from './index';
import { iconOverride } from '../resolve';

/** Classic bar: icon, then a 34 px track with name and value inside. */
export const bar: ValueStyleModule = {
  layout: 'rows',
  group: 'bars',
  height: 46,
  minColumnWidth: 160,
  styles: css`
    .style-bar .entity {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 0;
    }
    .style-bar .icon {
      flex: none;
      color: var(--state-icon-color, var(--secondary-text-color));
      --mdc-icon-size: 22px;
    }
    .style-bar .track {
      position: relative;
      flex: 1;
      min-width: 0;
      height: 34px;
      border-radius: 8px;
      overflow: hidden;
      background: var(--cd-track);
    }
    .style-bar .fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(var(--start) * 100%);
      width: calc((var(--end) - var(--start)) * 100%);
      border-radius: 8px;
      background: var(--c-start);
      background-image: linear-gradient(90deg, var(--c-start), var(--c-end));
      transition:
        left var(--cd-duration) var(--cd-easing),
        width var(--cd-duration) var(--cd-easing);
    }
    .style-bar .target {
      position: absolute;
      top: 5px;
      bottom: 5px;
      width: 3px;
      border-radius: 2px;
      left: calc(var(--target) * (100% - 3px));
      background: rgba(255, 255, 255, 0.85);
      transition: left var(--cd-duration) var(--cd-easing);
    }
    .style-bar .text {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      font-size: 14px;
      color: var(--primary-text-color);
    }
    /* A white copy of the text, clipped to the fill so it reads on the colour and the track alike. */
    .style-bar .text.on-fill {
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      clip-path: inset(0 calc((1 - var(--end)) * 100%) 0 calc(var(--start) * 100%));
      transition: clip-path var(--cd-duration) var(--cd-easing);
    }
    /* Light fills (amber, pale custom colours) take dark text instead. */
    .style-bar .text.on-fill.dark {
      color: #1d1f24;
      text-shadow: none;
    }
    /* Mostly see-through fills show the card behind, so the text follows the theme. */
    .style-bar .text.on-fill.theme {
      color: var(--primary-text-color);
      text-shadow: none;
    }
    .style-bar .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .style-bar .value {
      flex: none;
      white-space: nowrap;
      margin-left: auto;
    }
  `,
  render(e, { show, hass }) {
    // An unavailable or missing sensor always says so, even with the value hidden.
    const value = show.value || !e.available;
    const text = html`${show.name ? html`<span class="name">${e.name}</span>` : nothing}${
      value ? html`<span class="value">${e.display}</span>` : nothing
    }`;
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
      <div class="track">
        <div class="fill"></div>
        ${show.target && e.targetPosition !== null && e.available ? html`<div class="target"></div>` : nothing}
        <div class="text">${text}</div>
        ${e.available ? html`<div class="text on-fill ${onFillText(e.band.color)}" aria-hidden="true">${text}</div>` : nothing}
      </div>
    `;
  },
};
