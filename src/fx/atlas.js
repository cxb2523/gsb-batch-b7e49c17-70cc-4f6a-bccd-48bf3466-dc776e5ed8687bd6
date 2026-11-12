// Flipbook atlases for particles and decals, drawn once at load by fragment shaders.
// Both store smooth fields and normals rather than finished colour: the particle and decal shaders
// light them, threshold them and tint them, so one cell serves many looks and edges stay crisp.
import { WebGLRenderTarget, UnsignedByteType, RGBAFormat, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping } from 'three';

// ---- particle atlas: 8 x 8 cells -----------------------------------------------------------
export const P_GRID = 8;
export const P_CELL = {
  smoke: 0, smokeFrames: 16, //  RG normal, B breakup noise, A density
  star: 16, starCount: 4, //     R heat, A alpha  (muzzle flash seen end-on)
  tongue: 20, tongueCount: 4, // R heat, A alpha  (flame jet, base at -x)
  chip: 24, chipCount: 8, //     RG normal, B albedo variation, A coverage
  shard: 32, shardCount: 4, //   R edge bevel, G surface streak, A coverage
  drop: 36, dropCount: 4, //     RG normal, A coverage
  splash: 40, splashFrames: 8, // RG normal, B thickness, A coverage (liquid burst breaking up)
  glow: 48, streak: 49, ring: 50, burst: 51, // R/A intensity
  flame: 52, flameFrames: 8, //  R heat, A alpha  (a flame standing on its base at -y, licking upward through the frames)
};

// ---- decal atlas: 4 x 4 cells. RG normal, B cavity/extra, A growth field (1 centre -> 0 rim) ---
export const D_GRID = 4;
export const D_CELL = {
  crater: 0, craterCount: 2,
  metal: 2, metalCount: 2,
  glass: 4, glassCount: 2, //   R cracks, G frosting, B hole, A coverage
  smear: 6, //                  a dragged streak along y: dry-brush bands that thin toward +y
  drip: 7, //                   a few heads near the top with long runs toward -y
  pool: 8, poolCount: 4,
  spatter: 12, spatterCount: 2, // droplets with drips running toward -y
  scorch: 14, scorchCount: 2,
};

const NOISE = /* glsl */ `
const float TAU = 6.2831853;
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  i += 4096.0;
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; }
  return s / 0.96875;
}
float h1(float a, float b) { return hash13(vec3(a * 7.0 + 31.0, b * 13.0 + 57.0, 91.0)); }
vec2 enc(vec2 n) { return clamp(n, -1.0, 1.0) * 0.5 + 0.5; }
`;

const PARTICLE_FRAG = /* glsl */ `
float smokeD(vec2 q, float f) {
  vec3 p = vec3(q * 1.6, f * 0.22);
  vec2 w = vec2(fbm(p + vec3(5.2, 1.3, 0.0)), fbm(p + vec3(1.7, 9.2, 0.0))) - 0.5;
  float r = length(q + w * 0.55);
  float n = fbm(vec3((q + w * 0.8) * 2.6, f * 0.3 + 4.0));
  float d = smoothstep(0.95, 0.15, r + (n - 0.5) * 0.9);
  d *= smoothstep(1.0, 0.72, length(q));
  float e = f / 16.0 * 0.3;
  return smoothstep(e, e + 0.9, d);
}
float chipLim(vec2 q, float v) {
  float a = atan(q.y, q.x);
  return clamp(0.55 + 0.7 * (fbm(vec3(cos(a) * 1.6, sin(a) * 1.6, v * 4.7)) - 0.5), 0.3, 0.9);
}
float chipH(vec2 q, float v) {
  float k = clamp(1.0 - length(q) / chipLim(q, v), 0.0, 1.0);
  return pow(k, 0.6) + (fbm(vec3(q * 4.0, v * 3.0)) - 0.5) * 0.4 * step(0.001, k);
}
float splashH(vec2 q, float f) {
  float r = length(q); float a = atan(q.y, q.x);
  float R = 0.3 + 0.62 * (f / 7.0);
  float strings = fbm(vec3(cos(a) * 2.2, sin(a) * 2.2, r * 1.3 - f * 0.12) + 3.0);
  float blobs = fbm(vec3(q * 3.2, f * 0.15 + 9.0));
  float h = mix(strings, blobs, 0.7);
  float th = mix(0.34, 0.54, f / 7.0);
  float fall = smoothstep(R, R * 0.3, r);
  return h * fall + fall * 0.3 * (1.0 - f / 7.0) - th;
}
void main() {
  vec2 g = vUv * 8.0;
  vec2 ci = floor(g);
  float cell = ci.x + ci.y * 8.0;
  vec2 q = fract(g) * 2.0 - 1.0;
  float r = length(q);
  float ang = atan(q.y, q.x);
  vec4 o = vec4(0.5, 0.5, 0.0, 0.0);
  const vec2 e = vec2(0.03, 0.0);

  if (cell < 16.0) { // smoke flipbook
    float d = smokeD(q, cell);
    vec2 grad = vec2(smokeD(q + e.xy, cell) - smokeD(q - e.xy, cell), smokeD(q + e.yx, cell) - smokeD(q - e.yx, cell)) / (2.0 * e.x);
    vec2 n = q * 0.7 - grad * 0.22;
    // B: breakup noise, independent of the puff outline; the particle shader thresholds it
    float brk = smoothstep(0.25, 0.75, fbm(vec3(q * 4.5, cell * 0.35 + 11.0)));
    o = vec4(enc(n), brk, d);
  } else if (cell < 20.0) { // flash star
    float v = cell - 16.0;
    float sp = fbm(vec3(cos(ang) * 2.5, sin(ang) * 2.5, v * 7.3));
    sp = pow(smoothstep(0.3, 0.75, sp), 1.5);
    float lim = 0.2 + 0.72 * sp;
    float n = fbm(vec3(q * 5.0, v * 3.1 + 2.0));
    float heat = smoothstep(lim, lim * 0.15, r + (n - 0.5) * 0.25);
    heat = max(heat, exp(-r * r * 16.0));
    heat *= smoothstep(1.0, 0.8, r);
    o = vec4(heat, 0.0, 0.0, smoothstep(0.02, 0.45, heat));
  } else if (cell < 24.0) { // flame tongue
    float v = cell - 20.0;
    float t = (q.x + 1.0) * 0.5;
    float n = fbm(vec3(q.x * 2.5, q.y * 5.0, v * 5.7));
    float n2 = fbm(vec3(t * 4.0, v * 9.1, 1.0));
    float hw = pow(t, 0.45) * pow(1.0 - t, 0.6) * (0.6 + 0.8 * n2);
    float heat = smoothstep(hw, hw * 0.2, abs(q.y + (n - 0.5) * 0.3)) * smoothstep(1.0, 0.75, t) * smoothstep(0.0, 0.04, t);
    heat *= mix(1.0, 0.5, t);
    o = vec4(heat, 0.0, 0.0, smoothstep(0.02, 0.4, heat));
  } else if (cell < 32.0) { // chips
    float v = cell - 24.0;
    float cov = smoothstep(0.0, 0.08, 1.0 - r / chipLim(q, v));
    vec2 grad = vec2(chipH(q + e.xy, v) - chipH(q - e.xy, v), chipH(q + e.yx, v) - chipH(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.55), fbm(vec3(q * 6.0, v + 20.0)), cov);
  } else if (cell < 36.0) { // glass shards
    float v = cell - 32.0;
    float n = 3.0 + mod(v, 2.0);
    float d = 1.0;
    for (float i = 0.0; i < 4.0; i++) {
      if (i >= n) break;
      float a = (i + h1(v, i) * 0.7) * TAU / n + v;
      d = min(d, 0.3 + 0.35 * h1(v + 5.0, i) - dot(q, vec2(cos(a), sin(a))));
    }
    o = vec4(1.0 - smoothstep(0.0, 0.14, d), fbm(vec3(q * 3.0, v)), 0.0, smoothstep(0.0, 0.04, d));
  } else if (cell < 40.0) { // droplets
    float v = cell - 36.0;
    float lim = 0.78 + 0.12 * (vnoise(vec3(cos(ang) * 1.5, sin(ang) * 1.5, v * 3.0)) - 0.5);
    vec2 n = q / lim;
    o = vec4(enc(n * 0.95), 0.0, smoothstep(1.0, 0.86, r / lim));
  } else if (cell < 48.0) { // liquid splash flipbook
    float f = cell - 40.0;
    float h = splashH(q, f);
    vec2 grad = vec2(splashH(q + e.xy, f) - splashH(q - e.xy, f), splashH(q + e.yx, f) - splashH(q - e.yx, f)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.25), clamp(h * 4.0, 0.0, 1.0), smoothstep(0.0, 0.05, h));
  } else if (cell == 48.0) { // soft glow
    float a = exp(-r * r * 5.0) * smoothstep(1.0, 0.55, r);
    o = vec4(a, 0.0, 0.0, a);
  } else if (cell == 49.0) { // spark streak, head at +x
    float t = (q.x + 1.0) * 0.5;
    float w = mix(0.3, 0.95, t);
    vec2 hq = vec2(max(q.x - 0.55, 0.0) / 0.45, q.y / w);
    float a = pow(t, 1.4) * smoothstep(1.0, 0.0, length(hq));
    o = vec4(a, 0.0, 0.0, a);
  } else if (cell == 50.0) { // ring
    float k = (r - 0.7) / 0.13;
    float a = exp(-k * k) * (0.55 + 0.45 * fbm(vec3(cos(ang) * 3.0, sin(ang) * 3.0, 2.0)));
    o = vec4(a, 0.0, 0.0, a);
  } else if (cell >= 52.0 && cell < 60.0) { // standing flame: warped noise tongues that thin with height
    float f = cell - 52.0;
    float up = q.y * 0.5 + 0.5;
    vec2 w2 = vec2(fbm(vec3(q.x * 1.5, q.y * 1.2 - f * 0.55, f * 0.2 + 3.0)), fbm(vec3(q.x * 1.5 + 7.0, q.y * 1.2 - f * 0.55, f * 0.2 + 5.0))) - 0.5;
    vec2 p = q + w2 * vec2(0.9, 0.5) * (0.3 + up);
    float n = fbm(vec3(p.x * 3.0, p.y * 2.0 - f * 0.9, f * 0.37 + 9.0));
    float env = 1.0 - smoothstep(0.2, 0.95, abs(p.x) / mix(0.8, 0.5, up));
    float h = env * (n * 1.5 + 0.28 - up * 1.1) * smoothstep(-1.0, -0.78, q.y);
    float a = smoothstep(0.02, 0.24, h) * smoothstep(1.0, 0.84, max(abs(q.x), abs(q.y)));
    // heat falls with height: a yellow-white foot, orange through the body, red at the tips
    o = vec4(clamp(h * 1.25, 0.0, 1.0) * mix(1.0, 0.4, smoothstep(0.05, 0.85, up)), 0.0, 0.0, a);
  } else if (cell == 51.0) { // radial burst of streaks
    float s = fbm(vec3(cos(ang) * 4.0, sin(ang) * 4.0, r * 0.8));
    float a = smoothstep(0.38, 0.72, s) * smoothstep(1.0, 0.35, r) * smoothstep(0.0, 0.2, r) + exp(-r * r * 12.0) * 0.6;
    a = clamp(a, 0.0, 1.0);
    o = vec4(a, 0.0, 0.0, a);
  }
  outColor = o;
}`;

const DECAL_FRAG = /* glsl */ `
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float lobes(vec2 q, float v, float k) {
  float a = atan(q.y, q.x);
  return fbm(vec3(cos(a) * k, sin(a) * k, v * 6.1 + 2.0));
}
float craterF(vec2 q, float v) {
  float edge = 0.5 + 0.55 * (lobes(q, v, 1.8) - 0.5);
  float f = 1.0 - length(q) / max(edge, 0.2);
  f += (fbm(vec3(q * 6.0, v * 2.0)) - 0.5) * 0.25;
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.85, length(q));
}
float craterH(vec2 q, float v) {
  float f = craterF(q, v);
  return -f * 0.6 - smoothstep(0.5, 0.9, f) * 0.9 + fbm(vec3(q * 9.0, v + 7.0)) * 0.35 * smoothstep(0.0, 0.1, f);
}
float metalF(vec2 q, float v) {
  float edge = 0.82 + 0.1 * (lobes(q, v, 2.5) - 0.5);
  return clamp(1.0 - length(q) / edge, 0.0, 1.0);
}
float metalH(vec2 q, float v) {
  float f = metalF(q, v);
  float k = (f - 0.56) / 0.045;
  return -smoothstep(0.0, 0.56, f) * 0.8 + exp(-k * k) * 0.5;
}
float poolF(vec2 q, float v) {
  float r = length(q);
  float edge = 0.42 + 0.42 * lobes(q, v, 1.4);
  float f = 1.0 - r / edge;
  for (float i = 0.0; i < 9.0; i++) {
    float a = h1(v, i) * TAU; float d = 0.5 + 0.38 * h1(v + 3.0, i);
    float rad = 0.025 + 0.07 * h1(v + 7.0, i) * h1(v + 9.0, i);
    f = max(f, (1.0 - length(q - vec2(cos(a), sin(a)) * d) / rad) * 0.95);
  }
  f += (fbm(vec3(q * 5.0, v)) - 0.5) * 0.12 * smoothstep(-0.2, 0.2, f);
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.88, r);
}
float spatterF(vec2 q, float v) {
  float f = 0.0;
  for (float i = 0.0; i < 16.0; i++) {
    float a = h1(v + 11.0, i) * TAU; float d = 0.62 * pow(h1(v + 13.0, i), 0.7);
    vec2 c = vec2(cos(a), sin(a) * 0.8 + 0.25) * d;
    float rad = mix(0.03, 0.14, pow(h1(v + 17.0, i), 2.5)) * (i < 2.0 ? 1.8 : 1.0);
    float len = rad * (1.0 + 7.0 * h1(v + 19.0, i) * step(0.45, h1(v + 23.0, i)));
    vec2 b = c - vec2((h1(v + 29.0, i) - 0.5) * 0.04, len);
    vec2 pa = q - c, ba = b - c;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float w = rad * mix(1.0, 0.38, smoothstep(0.0, 0.35, t));
    f = max(f, (1.0 - length(pa - ba * t) / w) * mix(1.0, 0.3, t));
  }
  f += (fbm(vec3(q * 7.0, v)) - 0.5) * 0.1 * step(0.01, f);
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.9, max(abs(q.x), abs(q.y)));
}
// a hand or a body dragged from -y to +y: a wet start, then parallel bands that break up and thin
float smearF(vec2 q, float v) {
  float along = q.y * 0.5 + 0.5;
  float wob = (fbm(vec3(q.y * 1.6, v, 3.0)) - 0.5) * 0.3;
  float x = q.x - wob;
  float width = mix(0.46, 0.2, along) * (0.8 + 0.4 * fbm(vec3(q.y * 3.0, 7.0, v)));
  float body = 1.0 - abs(x) / width;
  float bands = fbm(vec3(x * 22.0, q.y * 1.3, v + 2.0));
  float dry = smoothstep(0.1, 0.85, along);
  float f = body * mix(1.0, smoothstep(0.32, 0.62, bands) * 0.9 + 0.1, dry);
  f = max(f, (1.0 - length((q - vec2(wob * 0.5, -0.68)) / vec2(0.36, 0.24))) * 0.95);
  f *= smoothstep(-0.96, -0.8, q.y) * smoothstep(0.96, 0.45, q.y);
  return clamp(f, 0.0, 1.0);
}
// blood that struck a wall and ran: heads along the top, runs of different lengths ending in a bead
float dripF(vec2 q, float v) {
  float f = 0.0;
  for (float i = 0.0; i < 7.0; i++) {
    float cx = (h1(v + 31.0, i) - 0.5) * 1.3;
    float cy = 0.5 + 0.3 * h1(v + 37.0, i);
    float rad = mix(0.035, 0.1, h1(v + 41.0, i) * h1(v + 41.0, i));
    float len = mix(0.15, 1.25, pow(h1(v + 43.0, i), 1.5));
    vec2 c = vec2(cx, cy);
    vec2 b = c - vec2((h1(v + 47.0, i) - 0.5) * 0.05, len);
    vec2 pa = q - c, ba = b - c;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float w = rad * mix(1.0, 0.24, smoothstep(0.0, 0.2, t)) * (1.0 + 0.5 * smoothstep(0.9, 1.0, t));
    f = max(f, (1.0 - length(pa - ba * t) / w) * mix(1.0, 0.45, smoothstep(0.0, 0.9, t)));
    f = max(f, (1.0 - length(q - b) / (rad * 0.42)) * 0.7);
  }
  f += (fbm(vec3(q * 8.0, v)) - 0.5) * 0.08 * step(0.01, f);
  return clamp(f, 0.0, 1.0) * smoothstep(1.0, 0.92, max(abs(q.x), abs(q.y)));
}
void main() {
  vec2 g = vUv * 4.0;
  vec2 ci = floor(g);
  float cell = ci.x + ci.y * 4.0;
  vec2 q = fract(g) * 2.0 - 1.0;
  float r = length(q);
  float ang = atan(q.y, q.x);
  const vec2 e = vec2(0.02, 0.0);
  vec4 o = vec4(0.5, 0.5, 0.0, 0.0);

  if (cell < 2.0) {
    float f = craterF(q, cell);
    vec2 grad = vec2(craterH(q + e.xy, cell) - craterH(q - e.xy, cell), craterH(q + e.yx, cell) - craterH(q - e.yx, cell)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.3), smoothstep(0.45, 0.8, f), f);
  } else if (cell < 4.0) {
    float v = cell - 2.0;
    float f = metalF(q, v);
    vec2 grad = vec2(metalH(q + e.xy, v) - metalH(q - e.xy, v), metalH(q + e.yx, v) - metalH(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.25), smoothstep(0.6, 0.66, f), f);
  } else if (cell < 6.0) {
    float v = cell - 4.0;
    float k = 13.0 + v * 4.0;
    float sa = ang / TAU * k + (vnoise(vec3(r * 3.0, v * 3.0, 1.0)) - 0.5) * 0.22;
    float sec = floor(sa);
    float dl = abs(fract(sa) - 0.5);
    dl = (0.5 - dl) * r * TAU / k; // distance to the nearest sector boundary = radial crack
    float len = 0.45 + 0.5 * h1(v, sec);
    float rad = smoothstep(0.007, 0.0015, dl) * smoothstep(len, len - 0.15, r);
    float conc = 0.0;
    for (float j = 0.0; j < 3.0; j++) {
      float sid = floor(fract(sa) + 0.5) + sec; // rings break at crack lines
      float rr = 0.2 + 0.22 * j + 0.12 * h1(v + j * 3.0, sid);
      conc = max(conc, smoothstep(0.006, 0.0015, abs(r - rr)) * step(0.45, h1(v + 40.0 + j, sid)));
    }
    float hole = smoothstep(0.1, 0.07, r + (lobes(q, v, 3.0) - 0.5) * 0.06);
    float frost = smoothstep(0.38, 0.08, r) * (0.4 + 0.6 * fbm(vec3(q * 14.0, v)));
    float cr = max(rad, conc);
    o = vec4(cr, frost, hole, max(max(cr, hole), frost));
  } else if (cell == 6.0) {
    float f = smearF(q, 1.0);
    vec2 grad = vec2(smearF(q + e.xy, 1.0) - smearF(q - e.xy, 1.0), smearF(q + e.yx, 1.0) - smearF(q - e.yx, 1.0)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.05), fbm(vec3(q * 4.0, 6.0)), f);
  } else if (cell == 7.0) {
    float f = dripF(q, 2.0);
    vec2 grad = vec2(dripF(q + e.xy, 2.0) - dripF(q - e.xy, 2.0), dripF(q + e.yx, 2.0) - dripF(q - e.yx, 2.0)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.06), fbm(vec3(q * 4.0, 9.0)), f);
  } else if (cell >= 8.0 && cell < 12.0) {
    float v = cell - 8.0;
    float f = poolF(q, v);
    vec2 grad = vec2(poolF(q + e.xy, v) - poolF(q - e.xy, v), poolF(q + e.yx, v) - poolF(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.12), fbm(vec3(q * 4.0, v + 5.0)), f);
  } else if (cell < 14.0 && cell >= 12.0) {
    float v = cell - 12.0;
    float f = spatterF(q, v);
    vec2 grad = vec2(spatterF(q + e.xy, v) - spatterF(q - e.xy, v), spatterF(q + e.yx, v) - spatterF(q - e.yx, v)) / (2.0 * e.x);
    o = vec4(enc(-grad * 0.06), fbm(vec3(q * 4.0, v + 5.0)), f);
  } else if (cell >= 14.0) {
    float v = cell - 14.0;
    float edge = 0.6 + 0.5 * (lobes(q, v, 2.2) - 0.5);
    float f = clamp(1.0 - r / edge, 0.0, 1.0) * smoothstep(1.0, 0.8, r);
    o = vec4(0.5, 0.5, fbm(vec3(q * 5.0, v + 3.0)), f);
  }
  outColor = o;
}`;

function bake(post, size, frag, into) {
  const rt = into || new WebGLRenderTarget(size, size, {
    type: UnsignedByteType, format: RGBAFormat, depthBuffer: false,
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true,
    wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
  });
  const mat = post.fsMaterial({ fragmentShader: post.glsl.common + NOISE + frag });
  const prev = post.renderer.getRenderTarget();
  post.blit(mat, rt);
  post.renderer.setRenderTarget(prev); // leaving the target also builds the mip chain
  mat.dispose();
  return rt;
}

export function createAtlases(post) {
  const particles = bake(post, 2048, PARTICLE_FRAG);
  const decals = bake(post, 1024, DECAL_FRAG);
  return {
    particles, decals,
    // after a context restore the targets exist again but are empty: draw them again
    rebake() { bake(post, 2048, PARTICLE_FRAG, particles); bake(post, 1024, DECAL_FRAG, decals); },
    dispose() { particles.dispose(); decals.dispose(); },
  };
}
