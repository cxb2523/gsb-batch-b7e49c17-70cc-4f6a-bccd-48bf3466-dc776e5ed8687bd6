export function position(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function fillSpan(value: number, min: number, max: number): [number, number] {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [0, 0];
  }
  const end = position(value, min, max);
  if (min < 0 && max > 0) {
    const zero = position(0, min, max);
    return end < zero ? [end, zero] : [zero, end];
  }
  return [0, end];
}
