import { svg } from 'lit';
import { disconnectXY, renderXY, validateXY, xyEditor, xyEntityFields, xyStyles } from '../chart/scatter-plot';
import type { ChartStyleModule } from './index';

/** One entity's readings against another's (or against time), as dots. */
export const scatter: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 240,
  styles: xyStyles,
  thumbnail: () => svg`
    <g fill="var(--primary-color, #03a9f4)">
      <circle cx="10" cy="32" r="2.5" /><circle cx="17" cy="27" r="2.5" /><circle cx="22" cy="29" r="2.5" />
      <circle cx="28" cy="21" r="2.5" /><circle cx="34" cy="23" r="2.5" /><circle cx="40" cy="15" r="2.5" />
      <circle cx="47" cy="17" r="2.5" /><circle cx="53" cy="9" r="2.5" />
    </g>
    <g fill="var(--warning-color, #f59e0b)">
      <circle cx="14" cy="18" r="2.5" /><circle cx="31" cy="33" r="2.5" /><circle cx="50" cy="28" r="2.5" />
    </g>`,
  validate: (raw) => validateXY(raw, 'scatter'),
  editor: xyEditor('scatter'),
  entityFields: () => xyEntityFields(),
  disconnect: disconnectXY,
  render: (ctx) => renderXY(ctx, 'scatter'),
};
