const fmt = (n: number): string => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);

export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const rr = String(Number(r.toFixed(2)));
  const sweep = endDeg - startDeg;
  const [sx, sy] = polar(cx, cy, r, startDeg);
  if (sweep >= 359.99) {
    const [mx, my] = polar(cx, cy, r, startDeg + 180);
    return (
      `M${fmt(sx)} ${fmt(sy)} A${rr} ${rr} 0 1 1 ${fmt(mx)} ${fmt(my)} ` + `A${rr} ${rr} 0 1 1 ${fmt(sx)} ${fmt(sy)}`
    );
  }
  const [ex, ey] = polar(cx, cy, r, endDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M${fmt(sx)} ${fmt(sy)} A${rr} ${rr} 0 ${large} 1 ${fmt(ex)} ${fmt(ey)}`;
}

export function sweepAngles(sweep: number, span: [number, number]): [number, number] {
  const half = sweep / 2;
  return [-half + span[0] * sweep, -half + span[1] * sweep];
}

export function needlePath(cx: number, cy: number, length: number, baseHalfWidth: number): string {
  return (
    `M${fmt(cx)} ${fmt(cy - length)} ` +
    `L${fmt(cx + baseHalfWidth)} ${fmt(cy)} L${fmt(cx - baseHalfWidth)} ${fmt(cy)} Z`
  );
}
