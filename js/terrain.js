// The planet, streamed. A quadtree of web-mercator tiles around the aircraft:
// real elevation (Terrarium tiles, SRTM-class data) displaced under real
// satellite imagery, finer the closer you are. The physics asks this same tree
// for ground height, so the wheels roll on exactly the mesh you see.
import * as THREE from '../vendor/three.module.js';
import { atmoUniforms, ATMO_GLSL } from './atmo.js';
import { cloudUniforms, CLOUD_COVER_GLSL } from './clouds.js';
import { live, imageryResult } from './config.js';
import { RunwayPaint, RUNWAY_GLSL } from './runway-paint.js';

const N = 32, VPR = N + 1;
const ROOT_Z = 7, MAX_Z = 17, DEM_MAX_Z = 13, DEM_LAG = 2;
const SPLIT = 1.55, MAX_ACTIVE = 20;

const IMG_URL = (z, x, y) => live.source.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vRel;
varying vec3 vN;
varying float vAlt;
void main() {
  vUv = uv;
  vN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vAlt = position.y;
  wp.y -= dot(wp.xz, wp.xz) * (0.5 / 6371008.8);   // the Earth curves away
  vRel = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D map;
uniform sampler2D uWater;      // where the map says there is water (rasterised vector data, see scenery.js)
uniform vec4 uWaterUV;         // this tile's window into that mask: scale, offset
uniform float uTime;
uniform vec2 uCamXZ;
varying vec2 vUv;
varying vec3 vRel;
varying vec3 vN;
varying float vAlt;
${ATMO_GLSL}
${CLOUD_COVER_GLSL}
${RUNWAY_GLSL}
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// Gradient of 2D gradient noise, on a lattice that repeats every 256 cells so it stays exact far from the origin.
vec2 lattice(vec2 i) { float a = 6.2831853 * hash21(mod(i, 256.0) * 0.0137 + 0.11); return vec2(cos(a), sin(a)); }
vec2 noiseSlope(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = lattice(i), gb = lattice(i + vec2(1.0, 0.0)), gc = lattice(i + vec2(0.0, 1.0)), gd = lattice(i + vec2(1.0, 1.0));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
  return ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va);
}
// One train of ripples: wavelength L (m), slope k, running at speed (m/s) along
// the direction whose cosine and sine are cs, crests longer than they are wide.
// Ripples finer than the pixel (foot, m) stop bending the normal and are handed
// back as roughness instead, so distant water glitters without crawling.
vec2 ripple(vec2 xz, float L, float k, vec2 cs, float speed, float foot, inout float lost) {
  float keep = smoothstep(1.5, 5.0, L / foot);
  lost += (1.0 - keep * keep) * k * k * 0.5;
  if (keep <= 0.0) return vec2(0.0);
  vec2 p = vec2(cs.x * xz.x + cs.y * xz.y, cs.x * xz.y - cs.y * xz.x);
  p.x -= speed * uTime;
  vec2 d = noiseSlope(p * vec2(1.0, 0.6) / L) * vec2(1.0, 0.6);
  return vec2(cs.x * d.x - cs.y * d.y, cs.y * d.x + cs.x * d.y) * (k * keep);
}
// Water: the photograph underneath, smoothed and darkened, under a Fresnel
// mirror of the sky and the sun's glitter on moving ripples.
vec3 water(vec3 dir, vec2 xz, float shade, vec3 body, float foot) {
  body = mix(body, vec3(0.025, 0.070, 0.095), 0.30) * 0.85;
  float lost = 0.0;
  vec2 s = ripple(xz, 47.0, 0.030, vec2(0.819, 0.574), 6.0, foot, lost);
  s += ripple(xz + 17.0, 13.0, 0.050, vec2(0.530, 0.848), 3.4, foot, lost);
  s += ripple(xz + 53.0, 3.7, 0.070, vec2(0.966, 0.259), 1.9, foot, lost);
  s += ripple(xz + 91.0, 0.97, 0.070, vec2(0.342, 0.940), 1.0, foot, lost);
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 v = -dir;
  float sigma = sqrt(lost);
  float nv = clamp(dot(n, v), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - min(1.0, nv + 1.2 * sigma), 5.0);
  // the sky it mirrors; a rough surface looks a little higher up than a flat one would
  vec3 r = reflect(dir, n);
  r.y = abs(r.y) + 0.02 + 0.6 * sigma;
  vec3 sky = skyRadiance(normalize(r));
  vec3 deck = uAmbient * 1.5 + uSunLight * 0.10;
  sky = mix(sky, deck, 0.75 * uLow.z * uLow.z);
  // the sun (or moon) on the facets
  vec3 h = normalize(uLightDir + v);
  float nh = max(dot(n, h), 0.0);
  float a2 = 0.0045 + 2.0 * lost;
  float dn = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dn * dn);
  float fh = 0.02 + 0.98 * pow(1.0 - max(dot(v, h), 0.0), 5.0);
  float glint = min(PI * D * fh / (4.0 * max(nv, 0.12)), 90.0) * step(0.0, dot(n, uLightDir));
  float ndl = max(dot(n, uLightDir), 0.0);
  return body * (uSunLight * ndl * shade * (1.0 - fres) + uAmbient) + sky * fres + uSunLight * shade * glint;
}
void main() {
  vec3 albedo = texture2D(map, vUv).rgb;
  float dist = length(vRel);
  vec3 dir = vRel / dist;
  float wet = smoothstep(0.30, 0.70, texture2D(uWater, vUv * uWaterUV.xy + uWaterUV.zw).r);
  if (wet > 0.0) {
    // white things afloat in the picture (boats, pontoons, surf) stay as photographed
    float top = max(albedo.r, max(albedo.g, albedo.b)), low = min(albedo.r, min(albedo.g, albedo.b));
    wet *= 1.0 - smoothstep(0.30, 0.52, dot(albedo, vec3(0.3, 0.5, 0.2))) * (1.0 - smoothstep(0.10, 0.24, top - low));
  }
  // paved runways drawn over a picture too coarse to show them
  vec2 xz = vRel.xz + uCamXZ;
  vec2 gx = dFdx(xz), gy = dFdy(xz);
  float rwy = paintRunway(xz, gx, gy, max(max(length(gx), length(gy)), 0.004), albedo);
  wet *= 1.0 - rwy;
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(vN), 0.75));
  float ndl = max(dot(n, uLightDir), 0.0);
  // shadow of the cloud deck: follow the sun ray up to the layer
  float up = max(uLightDir.y, 0.06);
  vec2 sp = xz + uLightDir.xz * ((uLow.x + uLow.y) * 0.5 - vAlt) / up;
  float shade = 1.0 - 0.78 * cloudCover(sp, uLow.z) * step(vAlt, uLow.x);
  shade *= 1.0 - 0.55 * cloudCover(sp * 0.37 + 9000.0, uMid.z);
  vec3 light = uSunLight * ndl * shade * 1.05 + uAmbient;
  vec3 col = albedo * light;
  // towns at night: lit where the imagery is pale and grey
  if (uNight > 0.01) {
    float lum = dot(albedo, vec3(0.3, 0.5, 0.2));
    float sat = max(albedo.r, max(albedo.g, albedo.b)) - min(albedo.r, min(albedo.g, albedo.b));
    float urban = smoothstep(0.16, 0.34, lum) * (1.0 - smoothstep(0.05, 0.16, sat));
    vec2 cell = floor(xz / 14.0);
    float spark = step(0.86, hash21(cell)) * (0.6 + 0.8 * hash21(cell + 7.0));
    vec2 f = fract(xz / 14.0) - 0.5;
    spark *= smoothstep(0.42, 0.05, length(f));
    float far = smoothstep(900.0, 5000.0, dist);
    float glow = mix(spark * 5.0, 0.28, far);
    vec3 lamp = mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.86, 0.66), hash21(cell + 3.0));
    col += uNight * urban * glow * lamp * 0.045 * (1.0 - wet) * (1.0 - rwy);
  }
  // the blurred picture and the pixel's footprint need screen derivatives, which are only defined outside a branch
  vec3 soft = texture2D(map, vUv, 1.7).rgb;
  float foot = max(length(fwidth(vRel.xz)), 0.004);
  if (wet > 0.004) col = mix(col, water(dir, xz, shade, soft, foot), wet);
  col = applyHaze(col, dir, dist, vAlt);
  gl_FragColor = vec4(col, dist * 0.001);
}`;

class Node {
  constructor(z, x, y, parent, geo) {
    this.z = z; this.x = x; this.y = y; this.parent = parent;
    const s = 2 ** z;
    this.e0 = geo.eOfMercX(x / s); this.e1 = geo.eOfMercX((x + 1) / s);
    this.n1 = geo.nOfMercY(y / s); this.n0 = geo.nOfMercY((y + 1) / s);
    this.ce = 0.5 * (this.e0 + this.e1); this.cn = 0.5 * (this.n0 + this.n1);
    this.se = this.e1 - this.e0; this.sn = this.n1 - this.n0;
    this.size = Math.max(this.se, this.sn);
    this.state = 'new';           // new -> loading -> built -> ready | failed
    this.children = null; this.split = false; this.mesh = null; this.heights = null;
    this.minH = parent ? parent.minH : 0; this.maxH = parent ? parent.maxH : 0;
    this.noSplitUntil = 0; this.disposed = false;
  }
}

export class Terrain {
  constructor(scene, geo, renderer) {
    this.geo = geo;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.roots = new Map();
    this.dem = new Map();
    this.active = 0;
    this.buildQueue = [];
    this.wanted = [];
    this.visible = [];
    this.runways = [];
    this.frame = 0;
    this.pending = 1;
    this.tileCount = 0;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.paint = new RunwayPaint();
    this.uniforms = { uCamXZ: { value: new THREE.Vector2() }, uTime: { value: 0 }, ...this.paint.uniforms };
    // water masks: every tile starts dry, or looking through its parent's mask, until its own arrives
    const flat = (v) => {
      const t = new THREE.DataTexture(new Uint8Array([v]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
      t.needsUpdate = true;
      return t;
    };
    this.dry = flat(0); this.sea = flat(255);
    this.version = 0;             // counts meshes built: anything standing on the ground watches it
    this.index = this.makeIndex();
    this.uv = this.makeUv();
    this.cam = { e: 0, n: 0, u: 0 };
    this.failures = 0;
    this.fallbackH = 0;
  }

  makeIndex() {
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * VPR + i, b = a + 1, c = a + VPR, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirts: a second ring of vertices hanging below each edge
    const base = VPR * VPR;
    const ring = (k) => base + k;
    const edge = [];
    for (let i = 0; i < VPR; i++) edge.push(i);                          // north
    for (let j = 1; j < VPR; j++) edge.push(j * VPR + N);                // east
    for (let i = N - 1; i >= 0; i--) edge.push(N * VPR + i);             // south
    for (let j = N - 1; j >= 1; j--) edge.push(j * VPR);                 // west
    this.edge = edge;
    for (let k = 0; k < edge.length; k++) {
      const k2 = (k + 1) % edge.length;
      idx.push(edge[k], edge[k2], ring(k), edge[k2], ring(k2), ring(k));
      idx.push(edge[k2], edge[k], ring(k), ring(k2), edge[k2], ring(k));   // both windings: skirts are seen from outside
    }
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  }
  makeUv() {
    const count = VPR * VPR + this.edge.length;
    const uv = new Float32Array(count * 2);
    for (let j = 0; j < VPR; j++) for (let i = 0; i < VPR; i++) { uv[(j * VPR + i) * 2] = i / N; uv[(j * VPR + i) * 2 + 1] = j / N; }
    for (let k = 0; k < this.edge.length; k++) {
      uv[(VPR * VPR + k) * 2] = uv[this.edge[k] * 2];
      uv[(VPR * VPR + k) * 2 + 1] = uv[this.edge[k] * 2 + 1];
    }
    return new THREE.BufferAttribute(uv, 2);
  }

  // Runways are levelled to their surveyed threshold elevations so the strip
  // is a clean plane instead of 30 m radar noise.
  setRunways(list) {
    this.runways = list.map((r) => {
      const dx = r.e1 - r.e0, dy = r.n1 - r.n0, L = Math.hypot(dx, dy) || 1;
      return { ...r, ux: dx / L, uy: dy / L, L };
    });
    this.paint.set(this.runways);
    this.paint.enable(live.source.maxZoom < 16);
  }
  flatten(e, n, h) {
    for (let k = 0; k < this.runways.length; k++) {
      const r = this.runways[k];
      if (r.elev0 == null) continue;
      const px = e - r.e0, py = n - r.n0;
      const s = px * r.ux + py * r.uy;
      const t = Math.abs(-px * r.uy + py * r.ux);
      const da = Math.max(-s - 200, s - r.L - 200, 0);
      const dl = Math.max(t - (r.width * 0.5 + 90), 0);
      const d = Math.hypot(da, dl);
      if (d >= 220) continue;
      const x = 1 - d / 220;
      const wgt = x * x * (3 - 2 * x);
      const target = r.elev0 + (r.elev1 - r.elev0) * Math.min(1, Math.max(0, s / r.L));
      h += (target - h) * wgt;
    }
    return h;
  }

  async fetchImage(node) {
    const src = live.source;
    // finer than the service goes, the mesh keeps refining under its parent's picture, enlarged
    if (node.z > src.maxZoom && node.parent && node.parent.bitmap) {
      return createImageBitmap(node.parent.bitmap, (node.x & 1) * 128, (node.y & 1) * 128, 128, 128, { resizeWidth: 256, resizeHeight: 256, resizeQuality: 'high' });
    }
    let res;
    try { res = await fetch(IMG_URL(node.z, node.x, node.y), { mode: 'cors' }); } catch (err) { imageryResult(false); throw err; }
    if (res.status === 404 || res.status === 400 || res.status === 204) throw new Error('nodata');
    if (!res.ok) { imageryResult(false); throw new Error('imagery ' + res.status); }
    const blob = await res.blob();
    // beyond its coverage some services answer with a tiny placeholder
    if (node.z >= 14 && blob.size < src.emptyBelow) throw new Error('nodata');
    try { const bmp = await createImageBitmap(blob); imageryResult(true); return bmp; }
    catch (err) { imageryResult(false); throw err; }      // an error page where a picture should be
  }
  getDem(z, x, y) {
    const key = z + '/' + x + '/' + y;
    let entry = this.dem.get(key);
    if (!entry) {
      entry = { used: this.frame, data: null };
      entry.promise = (async () => {
        try {
          const res = await fetch(DEM_URL(z, x, y), { mode: 'cors' });
          if (!res.ok) throw new Error('dem ' + res.status);
          const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
          const cv = new OffscreenCanvas(256, 256);
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(bmp, 0, 0);
          bmp.close();
          const px = cx.getImageData(0, 0, 256, 256).data;
          const out = new Float32Array(65536);
          for (let i = 0; i < 65536; i++) {
            const h = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
            out[i] = h < -8 ? -8 : h;       // the data carries sea-floor depth; the sea is flat
          }
          entry.data = out;
        } catch (err) { entry.data = null; entry.failed = true; }
        return entry;
      })();
      this.dem.set(key, entry);
      if (this.dem.size > 260) this.pruneDem();
    }
    entry.used = this.frame;
    return entry.promise;
  }
  pruneDem() {
    const all = [...this.dem.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < 60; i++) this.dem.delete(all[i][0]);
  }

  async loadNode(node) {
    node.state = 'loading';
    this.active++;
    try {
      const ze = Math.max(0, Math.min(DEM_MAX_Z, node.z - DEM_LAG));
      const shift = node.z - ze;
      const [bmp, dem] = await Promise.all([this.fetchImage(node), this.getDem(ze, node.x >> shift, node.y >> shift)]);
      if (node.disposed) { bmp.close(); return; }
      node.bitmap = bmp; node.dem = dem; node.demShift = shift;
      node.state = 'built';
      this.buildQueue.push(node);
    } catch (err) {
      if (err.message === 'nodata' && node.parent) node.state = 'nodata';   // visit() decides what that means once its siblings are in
      else {
        node.state = 'failed';
        this.failures++;
        if (node.parent) node.parent.noSplitUntil = performance.now() + 15000;
        else setTimeout(() => { if (!node.disposed) node.state = 'new'; }, 4000);
      }
    } finally { this.active--; }
  }
  // A tile with no picture of its own beside siblings that have one: almost
  // always flat open water, which compresses to nothing and looks like the
  // "no data" placeholder. It borrows its quarter of the parent's picture so
  // the shore next to it can go on sharpening, and stops refining there.
  async fillNode(node) {
    node.state = 'loading';
    this.active++;
    try {
      const ze = Math.max(0, Math.min(DEM_MAX_Z, node.z - DEM_LAG));
      const shift = node.z - ze;
      const [bmp, dem] = await Promise.all([
        createImageBitmap(node.parent.bitmap, (node.x & 1) * 128, (node.y & 1) * 128, 128, 128, { resizeWidth: 256, resizeHeight: 256, resizeQuality: 'high' }),
        this.getDem(ze, node.x >> shift, node.y >> shift),
      ]);
      if (node.disposed) { bmp.close(); return; }
      node.bitmap = bmp; node.dem = dem; node.demShift = shift;
      node.noSplitUntil = Infinity;
      node.state = 'built';
      this.buildQueue.push(node);
    } catch (err) {
      node.state = 'failed';
      node.parent.noSplitUntil = performance.now() + 15000;
    } finally { this.active--; }
  }

  build(node) {
    const g = this.geo, s = 2 ** node.z;
    const H = node.heights = new Float32Array(VPR * VPR);
    const es = new Float64Array(VPR), ns = new Float64Array(VPR);
    for (let i = 0; i < VPR; i++) { es[i] = g.eOfMercX((node.x + i / N) / s); ns[i] = g.nOfMercY((node.y + i / N) / s); }
    const dem = node.dem && node.dem.data;
    const sc = 1 / (2 ** node.demShift);
    const fx0 = (node.x - ((node.x >> node.demShift) << node.demShift)) * sc;
    const fy0 = (node.y - ((node.y >> node.demShift) << node.demShift)) * sc;
    let minH = 1e9, maxH = -1e9;
    for (let j = 0; j < VPR; j++) {
      let v = (fy0 + (j / N) * sc) * 256 - 0.5;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      const v0 = Math.floor(v), v1 = Math.min(255, v0 + 1), fv = v - v0;
      for (let i = 0; i < VPR; i++) {
        let h = 0;
        if (dem) {
          let u = (fx0 + (i / N) * sc) * 256 - 0.5;
          u = u < 0 ? 0 : u > 255 ? 255 : u;
          const u0 = Math.floor(u), u1 = Math.min(255, u0 + 1), fu = u - u0;
          const a = dem[v0 * 256 + u0], b = dem[v0 * 256 + u1], c = dem[v1 * 256 + u0], d = dem[v1 * 256 + u1];
          h = (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
        }
        if (this.runways.length) h = this.flatten(es[i], ns[j], h);
        H[j * VPR + i] = h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    node.minH = minH; node.maxH = maxH;
    const count = VPR * VPR + this.edge.length;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    const de = node.se / N, dn = node.sn / N;
    for (let j = 0; j < VPR; j++) for (let i = 0; i < VPR; i++) {
      const k = j * VPR + i;
      pos[k * 3] = es[i] - node.ce; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = -(ns[j] - node.cn);
      const hl = H[j * VPR + Math.max(i - 1, 0)], hr = H[j * VPR + Math.min(i + 1, N)];
      const hn = H[Math.max(j - 1, 0) * VPR + i], hs = H[Math.min(j + 1, N) * VPR + i];
      const sx = (hr - hl) / (de * (i === 0 || i === N ? 1 : 2));
      const sz = (hn - hs) / (dn * (j === 0 || j === N ? 1 : 2));   // slope toward north
      const il = 1 / Math.hypot(sx, 1, sz);
      nor[k * 3] = -sx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = sz * il;
    }
    const skirt = node.size * 0.035 + 6;
    for (let k = 0; k < this.edge.length; k++) {
      const src = this.edge[k], dst = VPR * VPR + k;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt; pos[dst * 3 + 2] = pos[src * 3 + 2];
      nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geom.setAttribute('uv', this.uv);
    geom.setIndex(this.index);
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5 * (minH + maxH), 0), Math.hypot(node.se, node.sn) * 0.5 + (maxH - minH) * 0.5 + skirt + 300);
    const tex = new THREE.Texture(node.bitmap);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = this.aniso;
    tex.needsUpdate = true;
    // until this tile has a water mask of its own it reads its quadrant of its parent's
    const pw = node.parent && node.parent.water;
    node.water = { tex: pw ? pw.tex : this.dry, uv: new THREE.Vector4(1, 1, 0, 0), own: false, done: false };
    if (pw) node.water.uv.set(pw.uv.x * 0.5, pw.uv.y * 0.5, pw.uv.z + (node.x & 1) * pw.uv.x * 0.5, pw.uv.w + (node.y & 1) * pw.uv.y * 0.5);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { map: { value: tex }, uWater: { value: node.water.tex }, uWaterUV: { value: node.water.uv }, ...this.uniforms, ...atmoUniforms, ...cloudUniforms },
      side: THREE.FrontSide, blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = node.z > 9;
    mesh.visible = false;
    mesh.matrixAutoUpdate = true;
    this.group.add(mesh);
    node.mesh = mesh; node.tex = tex;
    node.dem = null;
    node.state = 'ready';
    this.tileCount++;
    this.version++;
  }

  // Give a tile its own water mask: 256 x 256 coverage bytes, row 0 at the
  // north edge. 'dry' and 'sea' are the two masks that need no texture.
  setWater(node, data) {
    if (node.disposed || !node.mesh) return;
    const w = node.water;
    if (w.own) w.tex.dispose();
    w.own = false;
    if (data === 'dry') w.tex = this.dry;
    else if (data === 'sea') w.tex = this.sea;
    else {
      const t = new THREE.DataTexture(data, 256, 256, THREE.RedFormat, THREE.UnsignedByteType);
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      w.tex = t; w.own = true;
    }
    w.uv.set(1, 1, 0, 0);
    w.done = true;
    node.mesh.material.uniforms.uWater.value = w.tex;
  }

  // The loaded tile, no finer than maxZ, whose imagery covers a mercator point.
  nodeAt(mx, my, maxZ) {
    const rs = 2 ** ROOT_Z;
    let node = this.roots.get(Math.floor(mx * rs) + '/' + Math.floor(my * rs));
    if (!node || node.state !== 'ready') return null;
    while (node.z < maxZ && node.children) {
      const s = 2 ** (node.z + 1);
      const c = node.children[Math.min(1, Math.max(0, Math.floor(my * s) - node.y * 2)) * 2 + Math.min(1, Math.max(0, Math.floor(mx * s) - node.x * 2))];
      if (c.state !== 'ready') break;
      node = c;
    }
    return node;
  }

  disposeNode(node) {
    node.disposed = true;
    if (node.children) { for (const c of node.children) this.disposeNode(c); node.children = null; }
    if (node.mesh) {
      this.group.remove(node.mesh);
      node.mesh.geometry.dispose();
      node.mesh.material.dispose();
      node.tex.dispose();
      if (node.water.own) node.water.tex.dispose();
      node.mesh = null;
      this.tileCount--;
    }
    if (node.bitmap) { node.bitmap.close(); node.bitmap = null; }
  }

  dist(node) {
    const c = this.cam;
    const dx = Math.max(Math.abs(c.e - node.ce) - node.se * 0.5, 0);
    const dn = Math.max(Math.abs(c.n - node.cn) - node.sn * 0.5, 0);
    const dy = c.u > node.maxH ? c.u - node.maxH : c.u < node.minH ? node.minH - c.u : 0;
    return Math.hypot(dx, dn, dy);
  }
  hideBelow(node) {
    if (!node.children) return;
    for (const c of node.children) {
      c.split = false;
      if (c.mesh) c.mesh.visible = false;
      this.hideBelow(c);
    }
  }
  visit(node) {
    const d = this.dist(node);
    node.d = d;
    if (node.state === 'new') this.wanted.push(node);
    const ready = node.state === 'ready';
    const blocked = node.noSplitUntil > performance.now();
    const want = ready && !blocked && node.z < MAX_Z && d < node.size * SPLIT * (node.split ? 1.15 : 1);
    if (want) {
      if (!node.children) {
        node.children = [];
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) node.children.push(new Node(node.z + 1, node.x * 2 + i, node.y * 2 + j, node, this.geo));
      }
      let all = true, missing = 0, settled = true;
      for (const c of node.children) {
        if (c.state === 'nodata') missing++;
        else if (c.state !== 'ready') settled = false;
        if (c.state !== 'ready') { all = false; if (c.state === 'new') { c.d = this.dist(c); this.wanted.push(c); } }
      }
      if (missing === 4) node.noSplitUntil = Infinity;        // the imagery ends at this level
      else if (missing && settled && node.bitmap) for (const c of node.children) if (c.state === 'nodata') this.fillNode(c);
      if (all) {
        node.split = true;
        node.mesh.visible = false;
        for (const c of node.children) this.visit(c);
        return;
      }
    } else if (node.children && (blocked || d > node.size * SPLIT * 1.3)) {
      for (const c of node.children) this.disposeNode(c);
      node.children = null;
    }
    node.split = false;
    this.hideBelow(node);
    if (ready) { node.mesh.visible = true; this.visible.push(node); }
  }

  // camera position in local east/north/up metres
  update(e, n, u) {
    if (!Number.isFinite(e + n + u)) return;
    this.frame++;
    this.cam.e = e; this.cam.n = n; this.cam.u = u;
    const g = this.geo, rs = 2 ** ROOT_Z;
    const rx = Math.floor(g.mercX(e) * rs), ry = Math.floor(g.mercY(n) * rs);
    const keep = new Set();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = ((rx + i) % rs + rs) % rs, y = ry + j;
      if (y < 0 || y >= rs) continue;
      const key = x + '/' + y;
      keep.add(key);
      if (!this.roots.has(key)) this.roots.set(key, new Node(ROOT_Z, x, y, null, g));
    }
    for (const [key, node] of this.roots) if (!keep.has(key)) { this.disposeNode(node); this.roots.delete(key); }

    this.wanted.length = 0;
    this.visible.length = 0;
    for (const node of this.roots.values()) this.visit(node);

    // nearest first; coarse levels win ties so there is always something to show
    this.wanted.sort((a, b) => (a.d - b.d) || (a.z - b.z));
    for (let i = 0; i < this.wanted.length && this.active < MAX_ACTIVE; i++) this.loadNode(this.wanted[i]);

    const t0 = performance.now();
    this.buildQueue.sort((a, b) => a.z - b.z);
    while (this.buildQueue.length && performance.now() - t0 < 5) {
      const node = this.buildQueue.shift();
      if (!node.disposed) this.build(node);
    }
    this.pending = this.wanted.length + this.active + this.buildQueue.length;

    this.uniforms.uCamXZ.value.set(e, -n);
    this.paint.enable(live.source.maxZoom < 16);     // a sharp source of one's own shows its own runways
    for (let i = 0; i < this.visible.length; i++) {
      const node = this.visible[i];
      node.mesh.position.set(node.ce - e, -u, -(node.cn - n));
    }
  }

  // Ground elevation (m MSL) under a point, read off the mesh that is on screen.
  heightAt(e, n) {
    const g = this.geo;
    const mx = g.mercX(e), my = g.mercY(n);
    const rs = 2 ** ROOT_Z;
    let node = this.roots.get(Math.floor(mx * rs) + '/' + Math.floor(my * rs));
    if (!node) return this.fallbackH;
    let best = node.heights ? node : null;
    while (node.split && node.children) {
      const s = 2 ** (node.z + 1);
      const cx = Math.min(1, Math.max(0, Math.floor(mx * s) - node.x * 2));
      const cy = Math.min(1, Math.max(0, Math.floor(my * s) - node.y * 2));
      node = node.children[cy * 2 + cx];
      if (node.heights) best = node;
    }
    if (!best) return this.fallbackH;
    const s = 2 ** best.z;
    let fu = (mx * s - best.x) * N, fv = (my * s - best.y) * N;
    let i = Math.floor(fu), j = Math.floor(fv);
    i = i < 0 ? 0 : i > N - 1 ? N - 1 : i;
    j = j < 0 ? 0 : j > N - 1 ? N - 1 : j;
    fu -= i; fv -= j;
    const H = best.heights, k = j * VPR + i;
    const a = H[k], b = H[k + 1], c = H[k + VPR], d = H[k + VPR + 1];
    const h = fu + fv <= 1 ? a + (b - a) * fu + (c - a) * fv : d + (c - d) * (1 - fu) + (b - d) * (1 - fv);
    return h;
  }

  // finest level currently drawn under a point (for the loading screen)
  levelAt(e, n) {
    const g = this.geo, mx = g.mercX(e), my = g.mercY(n), rs = 2 ** ROOT_Z;
    let node = this.roots.get(Math.floor(mx * rs) + '/' + Math.floor(my * rs));
    if (!node || node.state !== 'ready') return 0;
    while (node.split && node.children) {
      const s = 2 ** (node.z + 1);
      node = node.children[Math.min(1, Math.max(0, Math.floor(my * s) - node.y * 2)) * 2 + Math.min(1, Math.max(0, Math.floor(mx * s) - node.x * 2))];
    }
    return node.z;
  }

  dispose() {
    for (const node of this.roots.values()) this.disposeNode(node);
    this.roots.clear();
    this.dem.clear();
    this.dry.dispose(); this.sea.dispose();
    this.paint.dispose();
    this.group.parent && this.group.parent.remove(this.group);
  }
}
