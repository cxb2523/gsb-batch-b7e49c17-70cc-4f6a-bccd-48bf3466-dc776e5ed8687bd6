import { html, svg } from 'lit';
import type { TemplateResult } from 'lit';
import type { StyleName } from '../types';

const TRACK = 'var(--divider-color, rgba(127, 127, 127, 0.3))';
const FILL = 'var(--primary-color, #03a9f4)';
const TEXT = 'var(--secondary-text-color, #727272)';

/** Point on a circle, angle in degrees clockwise from 12 o'clock. */
function point(cx: number, cy: number, r: number, deg: number): [string, string] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [(cx + r * Math.cos(rad)).toFixed(2), (cy + r * Math.sin(rad)).toFixed(2)];
}

function polar(cx: number, cy: number, r: number, deg: number): string {
  return point(cx, cy, r, deg).join(' ');
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const large = to - from > 180 ? 1 : 0;
  return `M ${polar(cx, cy, r, from)} A ${r} ${r} 0 ${large} 1 ${polar(cx, cy, r, to)}`;
}

function drawing(style: StyleName) {
  switch (style) {
    case 'bar':
      return svg`
        <rect x="6" y="9" width="52" height="9" rx="3" fill=${TRACK} />
        <rect x="6" y="9" width="36" height="9" rx="3" fill=${FILL} />
        <rect x="6" y="23" width="52" height="9" rx="3" fill=${TRACK} />
        <rect x="6" y="23" width="22" height="9" rx="3" fill=${FILL} />`;
    case 'thin':
      return svg`
        <rect x="6" y="8" width="24" height="3" rx="1.5" fill=${TEXT} opacity="0.6" />
        <rect x="6" y="14" width="52" height="3" rx="1.5" fill=${TRACK} />
        <rect x="6" y="14" width="38" height="3" rx="1.5" fill=${FILL} />
        <rect x="6" y="23" width="18" height="3" rx="1.5" fill=${TEXT} opacity="0.6" />
        <rect x="6" y="29" width="52" height="3" rx="1.5" fill=${TRACK} />
        <rect x="6" y="29" width="20" height="3" rx="1.5" fill=${FILL} />`;
    case 'segmented':
      return svg`${[0, 1].map((row) =>
        Array.from({ length: 8 }, (_, i) => {
          const lit = i < (row === 0 ? 6 : 3);
          return svg`<rect x=${6 + i * 6.75} y=${row === 0 ? 9 : 23} width="5" height="9" rx="1.5"
            fill=${lit ? FILL : TRACK} />`;
        }),
      )}`;
    case 'tank':
      return svg`${[14, 36].map(
        (x, i) => svg`
          <rect x=${x} y="5" width="14" height="30" rx="4" fill=${TRACK} />
          <rect x=${x} y=${i === 0 ? 13 : 23} width="14" height=${i === 0 ? 22 : 12} rx="4" fill=${FILL} />`,
      )}`;
    case 'ring':
      return svg`
        <circle cx="32" cy="20" r="14" fill="none" stroke=${TRACK} stroke-width="5" />
        <path d=${arc(32, 20, 14, 0, 250)} fill="none" stroke=${FILL} stroke-width="5" stroke-linecap="round" />`;
    case 'arc':
      return svg`
        <path d=${arc(32, 21, 14, -135, 135)} fill="none" stroke=${TRACK} stroke-width="5" stroke-linecap="round" />
        <path d=${arc(32, 21, 14, -135, 40)} fill="none" stroke=${FILL} stroke-width="5" stroke-linecap="round" />`;
    case 'needle': {
      const [tipX, tipY] = point(32, 32, 18, 25);
      return svg`
        <path d=${arc(32, 32, 22, -90, 90)} fill="none" stroke=${TRACK} stroke-width="5" />
        <path d=${arc(32, 32, 22, -90, 25)} fill="none" stroke=${FILL} stroke-width="5" />
        <line x1="32" y1="32" x2=${tipX} y2=${tipY} stroke=${TEXT} stroke-width="2.5" stroke-linecap="round" />
        <circle cx="32" cy="32" r="3" fill=${TEXT} />`;
    }
    default:
      // Chart styles draw their own thumbnails.
      return svg``;
  }
}

/** A small (64 × 40) preview of a style for the editor's style picker, in theme colours. */
export function thumbnail(style: StyleName): TemplateResult {
  return html`<svg class="thumbnail" viewBox="0 0 64 40" width="64" height="40" aria-hidden="true">
    ${drawing(style)}
  </svg>`;
}
