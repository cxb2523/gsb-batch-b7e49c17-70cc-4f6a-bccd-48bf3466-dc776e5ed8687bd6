// Water on the glass. Rain does not fall inside the cabin: it lands on the
// windscreen and windows, sits there in beads while the aircraft is slow, and
// once the air over the glass is fast enough to push it, runs up the
// windscreen and back along the side windows in streams. Out of the rain the
// glass dries over half a minute or so.
//
// The drops are drawn on the canopy's own triangles. Each pane is read flat in
// the plane it mostly faces (windscreen: across and up; side windows: along and
// up; a bubble canopy's roof: across and along), and the water moves in that
// plane: gravity pulls it down, the airflow pushes it the way the air goes
// over that pane. Three layers of streams move at different speeds so they do
// not slide as one sheet.
import * as THREE from '../vendor/three.module.js';

const CELLS = [0.017, 0.022, 0.017, 0.013];       // m: beads, then three stream layers
const PACE = [0, 0.55, 1.0, 1.6];                  // stream speeds relative to the pane's flow
const PERIOD = 512;                                // cells before the pattern repeats

const VERT = /* glsl */`
varying vec3 vPos;
varying vec3 vNrm;
void main() {
  vPos = position;
  vNrm = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
uniform float uWet;
uniform vec4 uDens;            // beads, stream layers 1..3
uniform vec2 uOff[9];          // per pane kind (windscreen, side, roof) and layer: how far the water has moved
uniform vec2 uDir[3];          // per pane kind: which way the water runs
uniform vec3 uTail[3];         // per pane kind: streak length of each layer, in cells
uniform vec3 uSky;             // what the glass reflects
uniform vec3 uGlint;           // the highlight on a drop
varying vec3 vPos;
varying vec3 vNrm;
vec3 gHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
// One layer of drops: x body, y dark rim, z highlight, w height within the drop (-1 bottom, 1 top).
// A drop is a small lens: it shows the world upside down, bright sky at its
// foot and dark ground at its crown, with a pin-point highlight.
vec4 drops(vec2 p, float cell, float dens, vec2 dir, float tail, float aa, float seed, float size) {
  vec4 o = vec4(0.0);
  if (dens <= 0.0) return o;
  vec2 q = p / cell, id0 = floor(q);
  float w = max(aa / cell, 0.02);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = id0 + vec2(float(i), float(j));
    vec3 h = gHash(mod(id, ${PERIOD}.0) + seed);
    if (h.z > dens) continue;
    vec2 a = id + 0.5 + (h.xy - 0.5) * 0.7;
    float r = mix(0.09, 0.30, h.x * h.y) * size;
    vec2 b = a - dir * tail * (0.6 + 0.8 * h.y);
    vec2 pa = q - a, ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    float rr = mix(r, r * 0.22, t);
    float d = length(pa - ba * t) - rr;
    float body = smoothstep(w, -w, d);
    if (body > o.x) { o.x = body; o.w = clamp((q.y - a.y) / r, -1.0, 1.0) * (1.0 - t); }
    o.y = max(o.y, body * smoothstep(-rr * 0.35 - w, -w * 0.3, d));
    o.z = max(o.z, body * smoothstep(r * 0.20, r * 0.04, length(q - a - vec2(-0.30, 0.42) * r)) * (1.0 - t));
  }
  return o;
}
void main() {
  if (uWet < 0.002) discard;
  vec3 an = abs(normalize(vNrm));
  int k; vec2 p;
  if (an.z > max(an.x, an.y)) { k = 0; p = vPos.xy; }          // windscreen and rear window
  else if (an.x > an.y) { k = 1; p = vPos.zy; }                // side windows
  else { k = 2; p = vPos.xz; }                                 // canopy roof
  float aa = length(fwidth(vPos));
  vec4 d = drops(p, ${CELLS[0]}, uDens.x, vec2(0.0, 1.0), 0.0, aa, 0.0, 1.0);
  vec4 e = drops(p - uOff[k * 3], ${CELLS[1]}, uDens.y, uDir[k], uTail[k].x, aa, 17.0, 0.7);
  if (e.x > d.x) d = vec4(e.x, max(e.y, d.y), max(e.z, d.z), e.w); else d.yz = max(d.yz, e.yz);
  e = drops(p - uOff[k * 3 + 1], ${CELLS[2]}, uDens.z, uDir[k], uTail[k].y, aa, 41.0, 0.6);
  if (e.x > d.x) d = vec4(e.x, max(e.y, d.y), max(e.z, d.z), e.w); else d.yz = max(d.yz, e.yz);
  e = drops(p - uOff[k * 3 + 2], ${CELLS[3]}, uDens.w, uDir[k], uTail[k].z, aa, 73.0, 0.5);
  if (e.x > d.x) d = vec4(e.x, max(e.y, d.y), max(e.z, d.z), e.w); else d.yz = max(d.yz, e.yz);
  // a thin film first, then the drops as lenses, their rims, and the highlights
  vec3 col = uSky * 0.8; float A = 0.03 * uWet;
  vec3 lens = mix(uSky * 1.15, uSky * 0.28, smoothstep(-0.7, 0.6, d.w));
  float a = 0.30 * d.x; col = mix(col, lens, a / max(A + a * (1.0 - A), 1e-4)); A += a * (1.0 - A);
  a = 0.14 * d.y; col = mix(col, vec3(0.0), a / max(A + a * (1.0 - A), 1e-4)); A += a * (1.0 - A);
  a = 0.90 * d.z; col = mix(col, uGlint, a / max(A + a * (1.0 - A), 1e-4)); A += a * (1.0 - A);
  gl_FragColor = vec4(col, A);
}`;

export class GlassRain {
  constructor(geometry) {
    this.uniforms = {
      uWet: { value: 0 },
      uDens: { value: new THREE.Vector4() },
      uOff: { value: Array.from({ length: 9 }, () => new THREE.Vector2()) },
      uDir: { value: [new THREE.Vector2(0, 1), new THREE.Vector2(1, 0), new THREE.Vector2(0, 1)] },
      uTail: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uSky: { value: new THREE.Color(0.5, 0.55, 0.6) },
      uGlint: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, mat);
    this.mesh.renderOrder = 60;          // after the rain outside, which shows through it
    this.mesh.visible = false;
    this.wet = 0;
  }
  // rain: 0..1 how hard it is raining on the aircraft; ias in m/s; sky, glint: colours
  update(dt, rain, ias, sky, glint) {
    // wetting takes seconds, drying takes the better part of a minute (faster in a fast airflow)
    const rate = rain > this.wet ? 0.35 : 0.025 * (1 + ias / 30);
    this.wet += (rain - this.wet) * Math.min(1, dt * rate);
    const U = this.uniforms, wet = this.wet;
    U.uWet.value = wet;
    this.mesh.visible = wet > 0.002;
    if (!this.mesh.visible) return;
    const push = THREE.MathUtils.smoothstep(ias, 8, 22);            // air fast enough to move a drop
    U.uDens.value.set(
      wet * (0.50 - 0.42 * push),                                   // beads stick when slow, mostly blow off when fast
      wet * (0.10 - 0.03 * push), wet * (0.08), wet * (0.05 + 0.04 * push));   // a few runs at rest, quick thin rivulets at speed
    // how the water moves on each kind of pane, in its own plane (metres per second)
    const flow = 0.035 * ias * push, fall = 0.05 * (1 - 0.8 * push);
    const kinds = [[0, flow - fall], [flow, 0.12 * flow - fall], [0, flow]];
    kinds.forEach(([vx, vy], k) => {
      const v = Math.hypot(vx, vy);
      if (v > 1e-4) U.uDir.value[k].set(vx / v, vy / v);
      for (let l = 1; l <= 3; l++) {
        const o = U.uOff.value[k * 3 + l - 1], m = PACE[l], span = CELLS[l] * PERIOD;
        o.x = (o.x + vx * m * dt) % span; o.y = (o.y + vy * m * dt) % span;
        U.uTail.value[k].setComponent(l - 1, Math.min(1.0, (v * m * 0.06) / CELLS[l] + 0.15 * push));
      }
    });
    U.uSky.value.copy(sky);
    U.uGlint.value.copy(glint);
  }
  dispose() { this.mesh.material.dispose(); }
}
