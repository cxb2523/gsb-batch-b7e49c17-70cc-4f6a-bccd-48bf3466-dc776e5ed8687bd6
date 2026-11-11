import { describe, expect, it } from 'vitest';
import { STYLE_NAMES } from '../src/types';
import { CONDITION_STYLES, STRIP_STYLES } from '../src/editor/condition-fields';
import { CUMULATIVE_STYLES } from '../src/history/transform-cumulative';
import { DERIVATIVE_STYLES } from '../src/history/transform-derivative';

/** Numeric history charts that load through the shared history frame. */
const FRAME_CHARTS = [
  'line',
  'area',
  'column',
  'combined',
  'range_area',
  'sparkline',
  'streamgraph',
  'beeswarm',
  'violin',
  'histogram',
  'heatmap',
  'dumbbell',
  'slope',
  'trend',
  'waterfall',
  'spiral',
  'strip_plot',
  'cycle_plot',
];

describe('per-entity option style lists', () => {
  const lists = { CONDITION_STYLES, STRIP_STYLES, CUMULATIVE_STYLES, DERIVATIVE_STYLES };

  it('only name styles that exist', () => {
    for (const [name, list] of Object.entries(lists)) {
      const unknown = list.filter((s) => !(STYLE_NAMES as readonly string[]).includes(s));
      expect(unknown, name).toEqual([]);
    }
  });

  it('offer when, cumulative and derivative on every numeric frame chart', () => {
    for (const list of [CONDITION_STYLES, CUMULATIVE_STYLES, DERIVATIVE_STYLES]) {
      expect(FRAME_CHARTS.filter((s) => !list.includes(s))).toEqual([]);
    }
  });
});
