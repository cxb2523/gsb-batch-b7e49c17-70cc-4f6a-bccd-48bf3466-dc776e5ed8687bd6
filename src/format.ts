import type { HomeAssistant } from './types';

export function defaultDecimals(hass: HomeAssistant | undefined, entityId: string, unit: string): number {
  const precision = hass?.entities?.[entityId]?.display_precision;
  if (typeof precision === 'number') return precision;
  return unit === '%' ? 0 : 1;
}

function localeOptions(hass?: HomeAssistant): { locale: string | undefined; grouping: boolean } {
  const language = hass?.locale?.language ?? 'en';
  switch (hass?.locale?.number_format) {
    case 'system':
      return { locale: undefined, grouping: true };
    case 'comma_decimal':
      return { locale: 'en-US', grouping: true };
    case 'decimal_comma':
      return { locale: 'de', grouping: true };
    case 'space_comma':
      return { locale: 'fr', grouping: true };
    case 'none':
      return { locale: 'en-US', grouping: false };
    default:
      return { locale: language, grouping: true };
  }
}

export function formatNumber(value: number, decimals: number, hass?: HomeAssistant): string {
  const { locale, grouping } = localeOptions(hass);
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });
  let text = formatter.format(value === 0 ? 0 : value);
  // Rounding a tiny negative (e.g. -0.04 at 1 decimal) yields "-0.0"; drop the sign.
  if (Number(value.toFixed(decimals)) === 0) text = formatter.format(0);
  return text;
}

export function withUnit(text: string, unit: string): string {
  return unit ? `${text} ${unit}` : text;
}
