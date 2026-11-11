import { NOW_MARKER } from '../chart/now-marker';
import { localize } from '../localize';
import type { HomeAssistant } from '../types';
import type { FieldBinding } from './schemas';

/** The "now" line on history charts whose span runs past the present. */
export const NOW_MARKER_FIELDS: FieldBinding[] = [{ name: 'now_marker', path: ['now_marker'], default: 'off' }];

/** Its dropdown (built here, not with chart-editors' `choice`, which imports this file). */
export function nowMarkerSchema(hass?: HomeAssistant) {
  return [
    {
      name: 'now_marker',
      selector: {
        select: {
          mode: 'dropdown',
          options: NOW_MARKER.map((value) => ({ value, label: localize(hass, `editor_now_marker_${value}`) })),
        },
      },
    },
  ];
}
