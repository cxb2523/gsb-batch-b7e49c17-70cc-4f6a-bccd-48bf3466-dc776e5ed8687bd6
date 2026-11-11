import { svg } from 'lit';
import { disconnectXY, renderXY, validateXY, xyEditor, xyEntityFields, xyStyles } from '../chart/scatter-plot';
import type { ChartStyleModule } from './index';

/** A scatter of one entity against another, each dot sized by a third. */
export const bubble: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 270,
  styles: xyStyles,
  thumbnail: () => svg`
    <g fill="var(--primary-color, #03a9f4)" fill-opacity="0.6">
      <circle cx="14" cy="28" r="4" /><circle cx="27" cy="20" r="7" /><circle cx="44" cy="24" r="5" />
      <circle cx="52" cy="11" r="8" /><circle cx="36" cy="33" r="3" />
    </g>`,
  validate: (raw) => validateXY(raw, 'bubble'),
  editor: xyEditor('bubble'),
  entityFields: () => xyEntityFields(),
  disconnect: disconnectXY,
  render: (ctx) => renderXY(ctx, 'bubble'),
};
