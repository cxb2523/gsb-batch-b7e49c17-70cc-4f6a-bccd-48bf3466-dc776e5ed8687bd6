// Runway paint. Satellite pictures coarser than a couple of metres a pixel
// show a runway as a grey smudge, so the terrain shader draws the paved
// strips itself, from the surveyed thresholds and widths it already levels the
// ground to: asphalt or concrete, side stripes, centreline, threshold bars,
// designation, aiming point and touchdown zone, and rubber where wheels land.
//
// The first kilometre at each end (threshold, numbers, touchdown zone) is drawn
// once into a small atlas; the long middle is drawn in the shader, so a 4 km
// runway costs no more texture than a short one. Marking sizes follow ICAO
// Annex 14 scaled to the runway's width.
import * as THREE from '../vendor/three.module.js';

export const MAX_PAINTED = 4;            // runways painted per airport, longest first
const SLOT_W = 256, SLOT_H = 2048;       // atlas pixels per runway end: across, along
const ZONE = 1000;                       // metres of each end held in the atlas
const DASH = 50, DASH_ON = 30;           // centreline: 30 m of paint every 50 m

const PAVED = /^(ASP|CON|PEM|BIT|TAR|PAV|MAC|SEAL|TRT|CEM|BRI|BETON|BÉTON)/i;
const CONCRETE = /^(CON|PEM|CEM|BETON|BÉTON)/i;

export const RUNWAY_GLSL = /* glsl */`
uniform sampler2D uRwyTex;     // r: paint, g: rubber; one slot per runway end
uniform vec4 uRwyA[${MAX_PAINTED}];  // low-end threshold x, z; unit direction x, z (world xz: east, south)
uniform vec4 uRwyB[${MAX_PAINTED}];  // length, half width, atlas zone length, concrete 0/1
uniform vec4 uRwyC[${MAX_PAINTED}];  // centreline half width, side stripe width, centreline start, low-end slot index
uniform float uRwyN;           // runways to paint (0 when the picture is sharp enough to show its own)
uniform float uRwySlots;
float rwyHash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float rwyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = rwyHash(mod(i, 512.0)), b = rwyHash(mod(i + vec2(1.0, 0.0), 512.0));
  float c = rwyHash(mod(i + vec2(0.0, 1.0), 512.0)), d = rwyHash(mod(i + vec2(1.0, 1.0), 512.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// 1 inside [a, b], with edges softened over the pixel's footprint w
float rwyBand(float x, float a, float b, float w) { return clamp((x - a) / w + 0.5, 0.0, 1.0) * clamp((b - x) / w + 0.5, 0.0, 1.0); }
// Paints the runway under world point xz into albedo; returns how much of the pixel is runway.
float paintRunway(vec2 xz, vec2 gx, vec2 gy, float foot, inout vec3 albedo) {
  float cover = 0.0;
  for (int i = 0; i < ${MAX_PAINTED}; i++) {
    if (float(i) >= uRwyN) break;
    vec4 A = uRwyA[i], B = uRwyB[i], C = uRwyC[i];
    vec2 d = xz - A.xy, perp = vec2(-A.w, A.z);
    float s = dot(d, A.zw), t = dot(d, perp);
    float L = B.x, hw = B.y;
    if (abs(t) > hw + foot + 1.0 || s < -foot - 1.0 || s > L + foot + 1.0) continue;
    float c = rwyBand(s, 0.0, L, foot) * rwyBand(t, -hw, hw, foot);
    // the surface: aged asphalt or concrete slabs, patched and uneven
    float n1 = rwyNoise(xz / 23.0), n2 = rwyNoise(xz / 3.1 + 40.0);
    vec3 surf = B.w > 0.5 ? vec3(0.30, 0.295, 0.28) : vec3(0.080, 0.083, 0.087);
    surf *= 0.82 + 0.26 * n1 + 0.10 * n2;
    if (B.w > 0.5) {                                   // slab joints every 5 m
      float jw = 0.12;
      float js = 1.0 - rwyBand(mod(s + 2.5, 5.0), 2.5 - jw, 2.5 + jw, max(foot, 0.02));
      float jt = 1.0 - rwyBand(mod(t + 2.5, 5.0), 2.5 - jw, 2.5 + jw, max(foot, 0.02));
      surf *= mix(0.72, 1.0, min(js, jt) * (1.0 - smoothstep(0.3, 2.0, foot)) + smoothstep(0.3, 2.0, foot));
    }
    float paint = 0.0, rubber = 0.0;
    float Z = B.z;
    if (s < Z || s > L - Z) {
      // the ends come from the atlas; the high end reads it turned round
      bool low = s < Z;
      float se = low ? s : L - s, te = low ? t : -t;
      float slot = C.w + (low ? 0.0 : 1.0);
      vec2 uv = vec2((slot + (te / (2.0 * hw) + 0.5)) / uRwySlots, se / Z);
      vec2 kx = vec2(1.0 / (2.0 * hw * uRwySlots), 1.0 / Z);
      vec2 dx = vec2(dot(gx, perp), dot(gx, A.zw)) * kx, dy = vec2(dot(gy, perp), dot(gy, A.zw)) * kx;
      vec2 pr = textureGrad(uRwyTex, uv, dx, dy).rg;
      paint = pr.r; rubber = pr.g;
    } else {
      // the middle: side stripes and the dashed centreline
      float sw = C.y;
      paint = max(rwyBand(abs(t), hw - 0.3 - sw, hw - 0.3, foot), 0.0);
      float ph = mod(s - C.z, ${DASH.toFixed(1)});
      paint = max(paint, rwyBand(t, -C.x, C.x, foot) * rwyBand(ph, 0.0, ${DASH_ON.toFixed(1)}, foot));
    }
    // paint a little worn, rubber laid along the wheel tracks
    paint *= 0.80 + 0.20 * n2;
    surf *= 1.0 - 0.55 * rubber;
    vec3 col = mix(surf, vec3(0.60, 0.60, 0.58) * (1.0 - 0.35 * rubber), paint);
    albedo = mix(albedo, col, c);
    cover = max(cover, c);
  }
  return cover;
}`;

// The markings of one runway end, in metres along (s, from the threshold) and
// across (t, right of the landing direction).
function endMarkings(rw, id) {
  const W = rw.width, hw = W / 2, L = rw.L;
  const bars = [];             // [s0, s1, t0, t1]
  const box = (s0, s1, t0, t1) => bars.push([s0, s1, t0, t1]);
  // threshold: piano keys from 6 m to 36 m, stopping 3 m short of the edges
  const n = W < 23 ? 4 : W < 30 ? 6 : W < 45 ? 8 : W < 60 ? 12 : 16;
  const kw = Math.max(0.4, Math.min(1.8, (W - 6 - 3.6) / (2 * (n - 1))));
  for (let k = 0; k < n / 2; k++) {
    const t0 = 1.8 + k * 2 * kw;
    box(6, 36, t0, t0 + kw); box(6, 36, -t0 - kw, -t0);
  }
  // designation: the letter of a parallel runway nearest the threshold, then the number
  const m = /^0?(\d{1,2})([LRC]?)$/i.exec(id || '');
  const h = Math.max(6, Math.min(18, W * 0.4));
  let s = 36 + 12;
  const text = [];
  if (m) {
    if (m[2]) { text.push({ str: m[2].toUpperCase(), s, h }); s += h + 6; }
    text.push({ str: (id.length >= 2 && /^0/.test(id) ? '0' : '') + m[1], s, h });
    s += h;
  }
  const centreStart = s + 12;
  // aiming point and touchdown zone, sized to the runway's length
  const g = Math.max(6, Math.min(18, W * 0.4)) / 2, aw = Math.max(3, Math.min(10, W * 0.2));
  const zone = Math.min(ZONE, L / 2) - 5;
  if (L >= 800) {
    const A = L >= 2400 ? 400 : L >= 1200 ? 300 : 250, Al = L >= 2400 ? 60 : L >= 1200 ? 45 : 30;
    if (A + Al < zone) { box(A, A + Al, g, g + aw); box(A, A + Al, -g - aw, -g); }
    if (L >= 1200 && W >= 23) {
      const tdz = L >= 2400 ? [[150, 3], [300, 3], [550, 2], [700, 2], [850, 1]] : [[150, 3], [450, 2], [600, 1]];
      for (const [at, k] of tdz) {
        if (at + 22.5 > zone) continue;
        for (let j = 0; j < k; j++) { const t0 = g + j * 3.3; box(at, at + 22.5, t0, t0 + 1.8); box(at, at + 22.5, -t0 - 1.8, -t0); }
      }
    }
  }
  return { bars, text, centreStart };
}

export class RunwayPaint {
  // list: runways from terrain.setRunways (e0, n0, ux, uy, L, width, surface, le, he)
  constructor() {
    this.uniforms = {
      uRwyTex: { value: null },
      uRwyA: { value: Array.from({ length: MAX_PAINTED }, () => new THREE.Vector4()) },
      uRwyB: { value: Array.from({ length: MAX_PAINTED }, () => new THREE.Vector4()) },
      uRwyC: { value: Array.from({ length: MAX_PAINTED }, () => new THREE.Vector4()) },
      uRwyN: { value: 0 },
      uRwySlots: { value: 1 },
    };
    this.count = 0;
    this.texture = null;
  }
  set(list) {
    const paved = list.filter((r) => r.L > 150 && r.width > 5 && (r.approximate || PAVED.test((r.surface || '').trim())))
      .sort((a, b) => b.L - a.L).slice(0, MAX_PAINTED);
    this.count = paved.length;
    if (!paved.length) return;
    const slots = paved.length * 2;
    const cv = document.createElement('canvas');
    cv.width = SLOT_W * slots; cv.height = SLOT_H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.globalCompositeOperation = 'lighter';
    const U = this.uniforms;
    paved.forEach((rw, i) => {
      const hw = rw.width / 2, Z = Math.min(ZONE, rw.L / 2);
      const ends = [endMarkings(rw, rw.le && rw.le.id), endMarkings(rw, rw.he && rw.he.id)];
      // one centreline phase for the whole runway, from the low end, clear of both designations
      const c0 = ends[0].centreStart, c1 = rw.L - ends[1].centreStart;
      const sw = rw.width >= 30 ? 0.9 : 0.45, cw = rw.width >= 30 ? 0.45 : 0.23;
      ends.forEach((mk, k) => {
        const slot = i * 2 + k;
        // metres to atlas pixels: t across (right = +x), s along (threshold at row 0)
        const px = SLOT_W / rw.width, py = SLOT_H / Z;
        const X = (t) => slot * SLOT_W + (t + hw) * px, Y = (s) => s * py;
        const rect = (s0, s1, t0, t1) => cx.fillRect(X(t0), Y(s0), (t1 - t0) * px, (s1 - s0) * py);
        cx.fillStyle = 'rgb(255,0,0)';
        for (const [s0, s1, t0, t1] of mk.bars) rect(s0, s1, t0, t1);
        rect(0, Z, hw - 0.3 - sw, hw - 0.3); rect(0, Z, -hw + 0.3, -hw + 0.3 + sw);
        // centreline dashes, placed in low-end metres so both halves meet in the middle
        for (let a = c0; a < c1 - DASH_ON + 0.01; a += DASH) {
          const lo = k === 0 ? a : rw.L - (a + DASH_ON), hi = k === 0 ? a + DASH_ON : rw.L - a;
          const s0 = Math.max(lo, mk.centreStart), s1 = Math.min(hi, Z);
          if (s1 > s0) rect(s0, s1, -cw, cw);
        }
        // numbers: tall narrow block figures, reading upright from the approach
        for (const { str, s, h } of mk.text) {
          const gw = h * 0.36, gap = h * 0.18, total = str.length * gw + (str.length - 1) * gap;
          str.split('').forEach((ch, j) => {
            const t0 = -total / 2 + j * (gw + gap);
            cx.save();
            cx.font = 'bold 100px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
            const mw = cx.measureText(ch).width || 55;
            cx.setTransform((gw * px) / mw, 0, 0, -(h * py) / 72, X(t0), Y(s));
            cx.textBaseline = 'alphabetic';
            cx.fillText(ch, 0, 0);
            cx.restore();
          });
        }
        // rubber: wheel tracks laid down where aircraft touch, 250 m to 900 m in
        let seed = (i * 7 + k * 3 + 1) * 9301;
        const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        const r0 = Math.min(250, Z * 0.3), r1 = Math.min(900, Z - 10);
        for (let q = 0; q < 260; q++) {
          const len = 15 + rnd() * 140, s0 = r0 + Math.pow(rnd(), 1.6) * (r1 - r0);
          const t = (rnd() + rnd() + rnd() - 1.5) * hw * 0.32;
          const w = 0.4 + rnd() * 1.4;
          cx.fillStyle = `rgb(0,${Math.round(10 + rnd() * 26)},0)`;
          rect(s0, Math.min(Z, s0 + len), t - w / 2, t + w / 2);
        }
      });
      U.uRwyA.value[i].set(rw.e0, -rw.n0, rw.ux, -rw.uy);
      U.uRwyB.value[i].set(rw.L, hw, Z, CONCRETE.test((rw.surface || '').trim()) ? 1 : 0);
      U.uRwyC.value[i].set(cw, sw, c0, i * 2);
    });
    const img = cx.getImageData(0, 0, cv.width, cv.height).data;
    const rg = new Uint8Array(cv.width * cv.height * 2);
    for (let p = 0, q = 0; p < img.length; p += 4, q += 2) { rg[q] = img[p]; rg[q + 1] = img[p + 1]; }
    this.texture = new THREE.DataTexture(rg, cv.width, cv.height, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 8;
    this.texture.needsUpdate = true;
    U.uRwyTex.value = this.texture;
    U.uRwySlots.value = slots;
  }
  // on: whether the picture underneath needs the paint
  enable(on) { this.uniforms.uRwyN.value = on ? this.count : 0; }
  dispose() { if (this.texture) this.texture.dispose(); }
}
