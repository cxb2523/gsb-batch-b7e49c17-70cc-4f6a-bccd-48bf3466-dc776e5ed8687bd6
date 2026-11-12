// One atmosphere for everything: the sky dome, the haze over the terrain and
// the light on the clouds all evaluate the same single-scattering model, so
// they agree at every sun angle and every visibility.
import * as THREE from '../vendor/three.module.js';

export const R_EARTH = 6371008.8;
const TAU_R = [0.0487, 0.1134, 0.2780];   // vertical Rayleigh optical depth, RGB
const H_R = 8400, H_M = 1500;             // scale heights, m
// Sky radiance per unit of sunlight. A white surface in full sun has radiance 1 in these units,
// which puts the horizon near 0.2 and the zenith near 0.05: the balance a camera sees.
const SUN_E = 3.4;

// Shared uniforms: every material references these same objects.
export const atmoUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },   // sun by day, moon by night
  uMoonDir: { value: new THREE.Vector3(0.3, 0.6, 0.5).normalize() },
  uSunLight: { value: new THREE.Color(1, 1, 1) },     // direct light reaching the ground
  uAmbient: { value: new THREE.Color(0.3, 0.35, 0.45) },
  uSunE: { value: SUN_E },
  uTwilight: { value: 1 },
  uNight: { value: 0 },
  uMieBeta: { value: 6e-5 },                           // haze extinction at sea level, 1/m
  uCamAlt: { value: 0 },
  uOvercast: { value: 0 },                             // 0..1, dims direct light under a solid deck
};

export const ATMO_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uLightDir;
uniform vec3 uMoonDir;
uniform vec3 uSunLight;
uniform vec3 uAmbient;
uniform float uSunE;
uniform float uTwilight;
uniform float uNight;
uniform float uMieBeta;
uniform float uCamAlt;
uniform float uOvercast;
const vec3 TAU_R = vec3(0.0487, 0.1134, 0.2780);
const float H_R = 8400.0;
const float H_M = 1500.0;
const float PI = 3.14159265;

// Kasten-Young relative air mass
float airmass(float mu) {
  mu = clamp(mu, 0.0, 1.0);
  float z = degrees(acos(mu));
  return 1.0 / (mu + 0.50572 * pow(96.07995 - z, -1.6364));
}
vec3 expm1Ratio(vec3 x) { // (1 - exp(-x)) / x, safe near zero
  vec3 ax = abs(x);
  vec3 big = (1.0 - exp(-x)) / (x + step(ax, vec3(1e-4)));
  return mix(big, 1.0 - 0.5 * x, step(ax, vec3(1e-4)));
}
// Radiance of clear sky in a direction, seen from the camera's altitude.
vec3 skyRadiance(vec3 dir) {
  float densR = exp(-uCamAlt / H_R), densM = exp(-uCamAlt / H_M);
  vec3 tR = TAU_R * densR;
  float tM = uMieBeta * H_M * densM;
  vec3 tau = tR + tM;
  // below the astronomical horizon the path only gets longer
  float mv = airmass(max(dir.y, 0.0)) * (1.0 + 2.0 * clamp(-dir.y, 0.0, 0.2));
  float msTrue = airmass(max(uSunDir.y, 0.0));
  float ms = msTrue / (1.0 + 0.08 * msTrue);   // multiple scattering keeps the dusk sky from going pure red
  float c = dot(dir, uSunDir);
  float pR = 0.0597 * (1.0 + c * c);
  float g = 0.76;
  float pM = 0.0796 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
  vec3 L = uSunE * uTwilight * (tR * pR + tM * (pM + 0.02)) * mv * exp(-tau * ms) * expm1Ratio(tau * (mv - ms));
  // light scattered more than once: a soft grey-blue floor under everything
  L += uSunE * uTwilight * 0.012 * (tR + tM) * mv / (1.0 + 0.12 * mv) * exp(-tau * ms * 0.35);
  // night: airglow and moonlit haze
  float cm = dot(dir, uMoonDir);
  L += uNight * (vec3(0.0018, 0.0028, 0.0055) * (0.6 + 0.4 * mv / (1.0 + 0.06 * mv)) + tR * 0.004 * (1.0 + cm * cm));
  return L;
}
// Optical path between two altitudes over a straight distance d, for scale height H.
float pathDensity(float h0, float h1, float d, float H) {
  float dh = (h1 - h0) / H;
  float e0 = exp(-max(h0, 0.0) / H);
  float f = abs(dh) < 1e-3 ? 1.0 - 0.5 * dh : (1.0 - exp(-dh)) / dh;
  return d * e0 * f;
}
// Aerial perspective: fade colour toward the horizon's own radiance.
vec3 applyHaze(vec3 color, vec3 dir, float dist, float pointAlt) {
  float dR = pathDensity(uCamAlt, pointAlt, dist, H_R);
  float dM = pathDensity(uCamAlt, pointAlt, dist, H_M);
  vec3 T = exp(-(TAU_R / H_R) * dR - uMieBeta * dM);
  vec3 hd = normalize(vec3(dir.x, 0.015 + 0.35 * max(dir.y, 0.0), dir.z));
  vec3 inscatter = skyRadiance(hd) * mix(1.0, 0.45, uOvercast);
  return color * T + inscatter * (1.0 - T);
}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

// ---- the same model on the CPU, for lights and exposure
function airmass(mu) {
  mu = Math.min(1, Math.max(0, mu));
  const z = Math.acos(mu) * 180 / Math.PI;
  return 1 / (mu + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

// Sun direction (east, up, north) from date and place. NOAA's low-accuracy
// solar position: good to about a hundredth of a degree.
export function sunPosition(date, latDeg, lonDeg) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lonDeg) * rad;
  const ha = lst - ra;
  const lat = latDeg * rad;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.cos(dec) * Math.sin(ha), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(ha) * Math.sin(lat));
  return { alt, az, east: Math.cos(alt) * Math.sin(az), up: Math.sin(alt), north: Math.cos(alt) * Math.cos(az) };
}

// Set every shared uniform from the sun, the haze and the cloud cover.
// Returns the light colours so ordinary three.js lights can follow.
export function updateAtmosphere({ sun, visibility, camAlt, overcast = 0 }) {
  const u = atmoUniforms;
  u.uSunDir.value.set(sun.east, sun.up, -sun.north).normalize();
  // moon: simply opposite the sun and high enough to light the night
  u.uMoonDir.value.set(-sun.east, Math.max(0.35, -sun.up), sun.north).normalize();
  const mieBeta = Math.max(0, 3.912 / Math.max(visibility, 200) - 1.2e-5);
  u.uMieBeta.value = mieBeta;
  u.uCamAlt.value = camAlt;
  u.uOvercast.value = overcast;
  const tw = Math.pow(THREE.MathUtils.smoothstep(sun.up, -0.2, 0.03), 1.6);
  const night = 1 - THREE.MathUtils.smoothstep(sun.up, -0.22, -0.03);
  u.uTwilight.value = Math.max(tw, 0.0005);
  u.uNight.value = night;
  // direct sunlight after the real air mass, faded out as the disc sets
  const ms = airmass(sun.up);
  const dR = Math.exp(-camAlt / H_R), dM = Math.exp(-camAlt / H_M);
  const disc = THREE.MathUtils.smoothstep(sun.up, -0.012, 0.03);
  const direct = [0, 1, 2].map((i) => Math.exp(-(TAU_R[i] * dR + mieBeta * H_M * dM) * ms) * disc);
  const moon = night * 0.012;
  u.uSunLight.value.setRGB(direct[0] * 1.15 + moon * 0.6, direct[1] * 1.15 + moon * 0.75, direct[2] * 1.15 + moon);
  // sky light on a horizontal surface, roughly: zenith-weighted radiance
  const skyK = tw * (0.20 + 0.25 * overcast);
  const warm = 1 - THREE.MathUtils.smoothstep(sun.up, 0.0, 0.25);
  u.uAmbient.value.setRGB(
    skyK * (0.62 + 0.25 * warm) + night * 0.006,
    skyK * (0.78 + 0.05 * warm) + night * 0.009,
    skyK * (1.00 - 0.10 * warm) + night * 0.016,
  );
  u.uLightDir.value.copy(disc > 0.01 ? u.uSunDir.value : u.uMoonDir.value);
  return { sunLight: u.uSunLight.value, ambient: u.uAmbient.value, night, twilight: tw, lightDir: u.uLightDir.value };
}
