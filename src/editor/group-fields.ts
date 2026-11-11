import { GROUP_LEVELS, parseGroupBy } from '../chart/hierarchy';
import { localize } from '../localize';
import type { ChartEditorContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { entityOptionsForm } from './entity-options';
import type { FieldBinding } from './schemas';

export const GROUP_FIELDS: FieldBinding[] = [{ name: 'group_by', path: ['group_by'], default: [] }];

/** Pick any of floor, area, device and label; they nest in that order. */
export function groupBySchema(hass?: HomeAssistant) {
  return {
    name: 'group_by',
    selector: {
      select: {
        multiple: true,
        mode: 'list',
        options: GROUP_LEVELS.map((value) => ({ value, label: localize(hass, `editor_group_by_${value}`) })),
      },
    },
  };
}

/** The editor always works on a list, so `group_by: area` in YAML shows as ticked. */
export function withGroupList(ctx: ChartEditorContext): ChartEditorContext {
  const raw = ctx.config.group_by;
  if (raw === undefined || Array.isArray(raw)) return ctx;
  let list: string[];
  try {
    list = parseGroupBy(raw);
  } catch {
    return ctx;
  }
  return { ...ctx, config: { ...ctx.config, group_by: list } as CardConfig };
}

/** A text box per listed entity for its own group. */
export function entityGroupsForm(ctx: ChartEditorContext) {
  return entityOptionsForm(ctx, 'entity_groups', 'group', { text: {} });
}

/** Label keys for chartForm: here `group_by` groups by place, not by time as on the history charts. */
export const HIERARCHY_LABELS = { group_by: 'editor_hierarchy_group_by' };
