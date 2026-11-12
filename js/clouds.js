// Volumetric clouds. Two marched layers (low cumulus/stratus, mid alto) and a
// thin cirrus sheet, placed and filled from the weather. Coverage comes from
// an equalised noise map, so "40 % cloud" in the forecast is 40 % of the sky —
// and the terrain reads the same map to draw the shadows underneath.
import * as THREE from '../vendor/three.module.js';
import { atmoUniforms, ATMO_GLSL } from './atmo.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Tileable 3D noise: R = Perlin-Worley (cloud bodies), G/B = Worley (erosion).
function buildNoise3D(S = 64) {
  const rand = rng(7);
  const tables = {};
  for (const C of [4, 8, 16, 6, 12, 24]) {
    const t = new Float32Array(C * C * C * 3);
    for (let i = 0; i < t.length; i++) t[i] = rand();
    tables[C] = t;
  }
  const worley = (x, y, z, C) => {
    const t = tables[C];
    const px = x * C, py = y * C, pz = z * C;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const k = ((((cz % C) + C) % C) * C * C + (((cy % C) + C) % C) * C + (((cx % C) + C) % C)) * 3;
      const ex = cx + t[k] - px, ey = cy + t[k + 1] - py, ez = cz + t[k + 2] - pz;
      const d = ex * ex + ey * ey + ez * ez;
      if (d < best) best = d;
    }
    return 1 - Math.min(1, Math.sqrt(best));
  };
  const grads = {};
  for (const P of [4, 8, 16]) {
    const g = new Float32Array(P * P * P * 3);
    for (let i = 0; i < P * P * P; i++) {
      const th = rand() * Math.PI * 2, u = rand() * 2 - 1, s = Math.sqrt(1 - u * u);
      g[i * 3] = s * Math.cos(th); g[i * 3 + 1] = s * Math.sin(th); g[i * 3 + 2] = u;
    }
    grads[P] = g;
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const perlin = (x, y, z, P) => {
    const g = grads[P];
    const px = x * P, py = y * P, pz = z * P;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const fx = px - ix, fy = py - iy, fz = pz - iz;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    let sum = 0;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
      const k = (((iz + oz) % P) * P * P + ((iy + oy) % P) * P + ((ix + ox) % P)) * 3;
      const d = g[k] * (fx - ox) + g[k + 1] * (fy - oy) + g[k + 2] * (fz - oz);
      sum += d * (ox ? u : 1 - u) * (oy ? v : 1 - v) * (oz ? w : 1 - w);
    }
    return sum;
  };
  const data = new Uint8Array(S * S * S * 4);
  let i = 0;
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S, w = (z + 0.5) / S;
    const pf = Math.min(1, Math.max(0, 0.5 + 0.9 * (perlin(u, v, w, 4) + 0.5 * perlin(u, v, w, 8) + 0.25 * perlin(u, v, w, 16))));
    const wf = worley(u, v, w, 4) * 0.625 + worley(u, v, w, 8) * 0.25 + worley(u, v, w, 16) * 0.125;
    const pw = Math.min(1, Math.max(0, (pf - wf + 1) / (2 - wf)));
    const g2 = worley(u, v, w, 6) * 0.625 + worley(u, v, w, 12) * 0.25 + worley(u, v, w, 24) * 0.125;
    data[i++] = pw * 255; data[i++] = g2 * 255; data[i++] = worley(u, v, w, 12) * 255; data[i++] = 255;
  }
  const tex = new THREE.Data3DTexture(data, S, S, S);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// Tileable 2D field, histogram-equalised so a threshold of (1 - c) covers a fraction c.
function buildWeatherMap(S = 512) {
  const data = new Uint8Array(S * S * 4);
  for (let ch = 0; ch < 2; ch++) {
    const rand = rng(91 + ch * 17);
    const field = new Float32Array(S * S);
    let amp = 1;
    for (const P of [8, 16, 32, 64, 128]) {
      const lat = new Float32Array(P * P);
      for (let i = 0; i < lat.length; i++) lat[i] = rand();
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const px = (x / S) * P, py = (y / S) * P;
        const ix = Math.floor(px), iy = Math.floor(py);
        let fx = px - ix, fy = py - iy;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const a = lat[iy * P + ix], b = lat[iy * P + (ix + 1) % P], c = lat[((iy + 1) % P) * P + ix], d = lat[((iy + 1) % P) * P + (ix + 1) % P];
        field[y * S + x] += amp * ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy);
      }
      amp *= 0.55;
    }
    const order = new Uint32Array(S * S);
    for (let i = 0; i < order.length; i++) order[i] = i;
    order.sort((p, q) => field[p] - field[q]);
    for (let r = 0; r < order.length; r++) data[order[r] * 4 + ch] = Math.floor((r / order.length) * 255.99);
  }
  for (let i = 0; i < S * S; i++) data[i * 4 + 3] = 255;
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Shared with the terrain shader (cloud shadows).
export const cloudUniforms = {
  uWeatherMap: { value: null },
  uLow: { value: new THREE.Vector4(1500, 2600, 0, 0.007) },   // base m, top m, coverage 0..1, density 1/m
  uMid: { value: new THREE.Vector4(4200, 4900, 0, 0.0035) },
  uCloudOffset: { value: new THREE.Vector2() },
};

export const CLOUD_COVER_GLSL = /* glsl */`
uniform sampler2D uWeatherMap;
uniform vec4 uLow;
uniform vec4 uMid;
uniform vec2 uCloudOffset;
float weatherNoise(vec2 xz) { return texture2D(uWeatherMap, (xz + uCloudOffset) / 64000.0).r; }
float cloudCover(vec2 xz, float cov) {
  float n = weatherNoise(xz);
  return step(0.002, cov) * smoothstep(1.0 - cov - 0.08, 1.0 - cov + 0.08, n);
}
`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
uniform sampler2D uScene;
uniform sampler3D uNoise;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uTanHalf;
uniform vec2 uCamXZ;
uniform float uTime;
uniform float uHigh;
uniform float uRain;
varying vec2 vUv;
${ATMO_GLSL}
${CLOUD_COVER_GLSL}
const float CURV = 0.5 / 6371008.8;

float layerDensity(vec3 p, vec4 L, float mid, bool fine) {
  float h = (p.y - L.x) / (L.y - L.x);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec2 w = mix(p.xz, p.xz * 0.37 + 9000.0, mid);
  float n = weatherNoise(w);
  float thr = 1.0 - L.z;
  float cov = smoothstep(thr - 0.08, thr + 0.08, n);
  if (cov <= 0.0) return 0.0;
  float s = clamp((n - thr) / max(1.0 - thr, 0.08), 0.0, 1.0);
  float tall = mix(0.42, 1.0, s);
  float prof = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(tall * 0.5, tall, h));
  float base = cov * prof;
  vec3 q = vec3(p.x + uCloudOffset.x, p.y, p.z + uCloudOffset.y) / mix(4200.0, 9000.0, mid);
  float shape = texture(uNoise, q).r;
  float d = clamp((shape - (1.0 - base)) / max(base, 0.001), 0.0, 1.0);
  if (fine && d > 0.0) {
    // billows a few hundred metres across: fine enough to read as cauliflower, coarse enough for the march to resolve
    float e = texture(uNoise, q * 2.3 + vec3(0.0, uTime * 0.003, 0.0)).g;
    float k = (1.0 - e) * 0.62 * (1.0 - 0.75 * d);
    d = max(0.0, (d - k) / (1.0 - k));
  }
  return d * L.w;
}

// Altitude range A0..A1 along a ray over a curved Earth: alt(t) = h + dy t + CURV (1-dy^2) t^2.
vec2 altRoots(float h, float dy, float A) {
  float a = CURV * (1.0 - dy * dy), b = dy, c = h - A;
  if (a < 1e-12) { float t = -c / (abs(b) < 1e-6 ? 1e-6 : b); return vec2(t, t); }
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0) return vec2(1e20, -1e20);
  float q = -0.5 * (b + (b >= 0.0 ? 1.0 : -1.0) * sqrt(disc));
  float t1 = q / a, t2 = abs(q) > 1e-9 ? c / q : t1;
  return vec2(min(t1, t2), max(t1, t2));
}
vec2 layerSpan(float h, float dy, float A0, float A1) {
  vec2 top = altRoots(h, dy, A1);
  if (top.x > top.y) return vec2(0.0, -1.0);
  if (abs(dy) > 0.9999) {            // straight up or down
    float ta = (A0 - h) / dy, tb = (A1 - h) / dy;
    return vec2(max(min(ta, tb), 0.0), max(ta, tb));
  }
  vec2 bot = altRoots(h, dy, A0);
  bool hasBot = bot.x <= bot.y;
  float s = max(top.x, 0.0), e = hasBot ? bot.x : top.y;
  if (e <= 0.0) { if (!hasBot) return vec2(0.0, -1.0); s = max(bot.y, 0.0); e = top.y; }
  return vec2(s, e);
}
float hg(float c, float g) { return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5); }

void marchLayer(vec4 L, float mid, int steps, vec3 rd, float tMax, float jitter, inout vec3 col, inout float T) {
  if (L.z <= 0.002 || T < 0.02) return;
  vec2 span = layerSpan(uCamAlt, rd.y, L.x, L.y);
  float tA = span.x, tB = min(span.y, tMax);
  if (tB <= tA) return;
  float minStep = clamp((L.y - L.x) / 26.0, 16.0, 70.0);
  float t = tA + jitter * max(minStep, tA * 0.04);
  vec3 lc = vec3(0.0); float lT = 1.0, tm = 0.0;
  float c = dot(rd, uLightDir);
  float phase = 0.70 + 0.15 * hg(c, 0.72) + 0.05 * hg(c, -0.25);
  float curv = CURV * (1.0 - rd.y * rd.y);
  for (int i = 0; i < 72; i++) {
    if (i >= steps || t >= tB || lT < 0.02) break;
    float ds = max(minStep, t * 0.04);
    vec3 p = vec3(uCamXZ.x + rd.x * t, uCamAlt + rd.y * t + curv * t * t, uCamXZ.y + rd.z * t);
    float d = layerDensity(p, L, mid, true);
    if (d > 0.0) {
      float tau = 0.0, ls = minStep * 1.4;
      vec3 lp = p;
      for (int j = 0; j < 4; j++) { lp += uLightDir * ls; tau += layerDensity(lp, L, mid, false) * ls; ls *= 2.0; }
      float lightT = exp(-tau) + 0.30 * exp(-0.25 * tau) + 0.07 * exp(-0.06 * tau);
      float h = clamp((p.y - L.x) / (L.y - L.x), 0.0, 1.0);
      vec3 S = uSunLight * lightT * phase * 1.05 + uAmbient * (0.35 + 0.9 * h);
      S *= 1.0 - 0.45 * uRain * (1.0 - h);       // rain-heavy bases go slate
      float a = 1.0 - exp(-d * ds);
      lc += lT * a * S; tm += lT * a * t;
      lT *= 1.0 - a;
    }
    t += ds;
  }
  float alpha = 1.0 - lT;
  if (alpha > 0.001) {
    float td = tm / alpha;
    vec3 hazed = applyHaze(lc / alpha, rd, td, uCamAlt + rd.y * td);
    float fade = 1.0 - smoothstep(70000.0, 120000.0, td);
    col += T * hazed * alpha * fade;
    T *= 1.0 - alpha * fade;
  }
}

void main() {
  vec3 rd = normalize(uCamFwd + (vUv.x * 2.0 - 1.0) * uTanHalf.x * uCamRight + (vUv.y * 2.0 - 1.0) * uTanHalf.y * uCamUp);
  float sceneDist = texture2D(uScene, vUv).a * 1000.0;
  float tMax = min(sceneDist, 130000.0);
  // interleaved gradient noise: every 3x3 block holds a well-spread set of offsets, which the composite's tent filter averages out
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 col = vec3(0.0); float T = 1.0;
  bool lowFirst = uCamAlt < 0.5 * (uLow.y + uMid.x);
  if (lowFirst) { marchLayer(uLow, 0.0, 72, rd, tMax, jitter, col, T); marchLayer(uMid, 1.0, 32, rd, tMax, jitter, col, T); }
  else { marchLayer(uMid, 1.0, 40, rd, tMax, jitter, col, T); marchLayer(uLow, 0.0, 64, rd, tMax, jitter, col, T); }
  // cirrus: one thin sheet near 9.5 km
  if (uHigh > 0.01 && T > 0.02 && uCamAlt < 9300.0) {
    vec2 r = altRoots(uCamAlt, rd.y, 9500.0);
    float t = r.y;
    if (r.x <= r.y && t > 0.0 && t < sceneDist && t < 220000.0) {
      vec2 xz = uCamXZ + rd.xz * t + uCloudOffset * 2.0;
      float n = texture2D(uWeatherMap, xz * vec2(1.0, 2.6) / 150000.0).g;
      float f = texture2D(uWeatherMap, xz * vec2(1.0, 3.4) / 21000.0).g;
      float a = smoothstep(1.0 - uHigh, 1.0 - uHigh + 0.45, n) * (0.35 + 0.65 * f) * 0.62;
      a *= 1.0 - smoothstep(90000.0, 220000.0, t);
      float c = dot(rd, uLightDir);
      vec3 S = uSunLight * (0.55 + 0.25 * hg(c, 0.6)) + uAmbient * 1.4;
      vec3 hazed = applyHaze(S, rd, t, 9500.0);
      col += T * hazed * a; T *= 1.0 - a;
    }
  }
  gl_FragColor = vec4(col, T);
}`;

export const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Clouds {
  constructor() {
    cloudUniforms.uWeatherMap.value = buildWeatherMap();
    this.uniforms = {
      uScene: { value: null }, uNoise: { value: buildNoise3D() },
      uCamRight: { value: new THREE.Vector3() }, uCamUp: { value: new THREE.Vector3() }, uCamFwd: { value: new THREE.Vector3() },
      uTanHalf: { value: new THREE.Vector2() }, uCamXZ: { value: new THREE.Vector2() },
      uTime: { value: 0 }, uHigh: { value: 0 }, uRain: { value: 0 },
      ...atmoUniforms, ...cloudUniforms,
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.offset = cloudUniforms.uCloudOffset.value;
  }
  // w: weather state; elev: field elevation
  setWeather(w) {
    const c = w.clouds;
    cloudUniforms.uLow.value.set(c.low.base, c.low.top, c.low.cover, c.low.density);
    cloudUniforms.uMid.value.set(c.mid.base, c.mid.top, c.mid.cover, 0.0035);
    this.uniforms.uHigh.value = c.high;
    this.uniforms.uRain.value = Math.min(1, w.precip / 4);
  }
  // How much cloud water there is at a point, 0..1, read from the same coverage
  // map the shader draws: if you can see yourself inside the cloud, this says so.
  // Icing and in-cloud turbulence use it.
  liquidAt(e, n, alt) {
    const img = cloudUniforms.uWeatherMap.value.image, S = img.width, data = img.data;
    const sample = (x, z) => {
      let u = ((x + this.offset.x) / 64000) % 1, v = ((z + this.offset.y) / 64000) % 1;
      if (u < 0) u += 1; if (v < 0) v += 1;
      const fx = u * S - 0.5, fy = v * S - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i, j) => data[((((j % S) + S) % S) * S + (((i % S) + S) % S)) * 4] / 255;
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    };
    const layer = (L, x, z) => {
      if (L.z <= 0.002 || alt <= L.x || alt >= L.y) return 0;
      const thr = 1 - L.z, nz = sample(x, z);
      const c = Math.min(1, Math.max(0, (nz - (thr - 0.08)) / 0.16));
      const h = (alt - L.x) / (L.y - L.x);
      return c * Math.min(1, h / 0.1) * Math.min(1, (1 - h) / 0.15);
    };
    const x = e, z = -n;
    return Math.max(layer(cloudUniforms.uLow.value, x, z), 0.7 * layer(cloudUniforms.uMid.value, x * 0.37 + 9000, z * 0.37 + 9000));
  }
  update(dt, windE, windN, camera, e, n) {
    // the deck drifts with the wind at its own level
    this.offset.x -= windE * dt;
    this.offset.y += windN * dt;
    const u = this.uniforms;
    u.uTime.value += dt;
    camera.matrixWorld.extractBasis(u.uCamRight.value, u.uCamUp.value, u.uCamFwd.value);
    u.uCamFwd.value.negate();
    const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    u.uTanHalf.value.set(th * camera.aspect, th);
    u.uCamXZ.value.set(e, -n);
  }
}
