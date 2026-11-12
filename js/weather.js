// Weather: the real thing, right now, at the airport you chose. Open-Meteo
// gives surface conditions plus wind on pressure levels, so the wind you climb
// through is the forecast wind aloft. Cloud base is the lifting condensation
// level from the temperature/dew-point spread, the way pilots estimate it.
import { KT } from './fdm.js';

const LEVELS = [925, 850, 700, 600, 500];
const HOURLY = [
  'temperature_2m', 'dew_point_2m', 'precipitation', 'snowfall', 'weather_code',
  'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'pressure_msl', 'visibility',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'wind_speed_80m', 'wind_direction_80m', 'wind_speed_180m', 'wind_direction_180m',
  ...LEVELS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `geopotential_height_${l}hPa`]),
];

function cloudLayers(elev, tempC, dewC, low, mid, high, precip, code) {
  const lcl = Math.min(2600, Math.max(180, 125 * (tempC - dewC)));
  const storm = code >= 95;
  const base = elev + (precip > 0.2 ? Math.min(lcl, 700) : lcl);
  const thick = storm ? 3200 : precip > 0.2 ? 1700 : low > 0.8 ? 650 : 700 + 600 * low;
  const top = base + thick;
  const midBase = Math.max(top + 700, elev + 3300);
  return {
    low: { base, top, cover: low, density: low > 0.8 ? 0.0055 : 0.0075 },
    mid: { base: midBase, top: midBase + 650, cover: mid * 0.9 },
    high,
  };
}

export async function fetchLive(lat, lon, elev) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + `&hourly=${HOURLY.join(',')}&wind_speed_unit=ms&forecast_days=1&timezone=GMT`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('weather ' + res.status);
  const j = await res.json();
  const h = j.hourly;
  const nowKey = new Date().toISOString().slice(0, 13) + ':00';
  let i = h.time.indexOf(nowKey);
  if (i < 0) i = Math.min(h.time.length - 1, new Date().getUTCHours());
  const v = (k, d = 0) => (h[k] && h[k][i] != null ? h[k][i] : d);
  const tempC = v('temperature_2m', 15), dewC = v('dew_point_2m', tempC - 6);
  const wind = [
    { alt: elev + 10, dir: v('wind_direction_10m'), spd: v('wind_speed_10m') },
    { alt: elev + 80, dir: v('wind_direction_80m', v('wind_direction_10m')), spd: v('wind_speed_80m', v('wind_speed_10m')) },
    { alt: elev + 180, dir: v('wind_direction_180m', v('wind_direction_10m')), spd: v('wind_speed_180m', v('wind_speed_10m')) },
  ];
  for (const l of LEVELS) {
    const z = v(`geopotential_height_${l}hPa`, null);
    if (z == null || z < elev + 350 || h[`wind_speed_${l}hPa`] == null) continue;
    wind.push({ alt: z, dir: v(`wind_direction_${l}hPa`), spd: v(`wind_speed_${l}hPa`) });
  }
  wind.sort((a, b) => a.alt - b.alt);
  const precip = v('precipitation'), code = v('weather_code');
  const low = v('cloud_cover_low') / 100, mid = v('cloud_cover_mid') / 100, high = v('cloud_cover_high') / 100;
  return {
    source: 'live', code,
    tempC, dewC, qnh: v('pressure_msl', 1013.25),
    vis: Math.max(300, v('visibility', 30000) * (precip > 2 ? 0.6 : 1)),
    precip, snow: v('snowfall') > 0 || (precip > 0 && tempC < 0.5),
    wind, gust: Math.max(v('wind_gusts_10m'), v('wind_speed_10m')),
    clouds: cloudLayers(elev, tempC, dewC, low, mid, high, precip, code),
    convective: low > 0.08 && low < 0.75 ? 0.7 : code >= 95 ? 1.7 : 0.15,
  };
}

export const PRESETS = {
  clear: { tempC: 18, dewC: 4, wind: [[10, 250, 2], [1500, 270, 5], [3000, 280, 9]], gust: 2.5, vis: 120000, low: 0, mid: 0, high: 0.15, precip: 0, convective: 0.2 },
  fair: { tempC: 21, dewC: 11, wind: [[10, 240, 4], [1500, 255, 8], [3000, 270, 13]], gust: 6, vis: 45000, low: 0.32, mid: 0.0, high: 0.3, precip: 0, convective: 0.9 },
  overcast: { tempC: 11, dewC: 7.5, wind: [[10, 200, 6], [1500, 220, 13], [3000, 240, 20]], gust: 9, vis: 14000, low: 1.0, mid: 0.6, high: 0.5, precip: 0, convective: 0.2 },
  storm: { tempC: 14, dewC: 12.5, wind: [[10, 190, 12], [1500, 215, 22], [3000, 235, 30]], gust: 21, vis: 5000, low: 1.0, mid: 0.9, high: 0.8, precip: 7, convective: 1.7, code: 95 },
};

export function presetWeather(name, elev) {
  const p = PRESETS[name] || PRESETS.fair;
  return {
    source: name, code: p.code || 0,
    tempC: p.tempC - 0.0065 * elev, dewC: p.dewC - 0.002 * elev, qnh: name === 'storm' ? 998 : 1016,
    vis: p.vis, precip: p.precip, snow: false,
    wind: p.wind.map(([a, dir, spd]) => ({ alt: elev + a, dir, spd })), gust: p.gust,
    clouds: cloudLayers(elev, p.tempC - 0.0065 * elev, p.dewC - 0.002 * elev, p.low, p.mid, p.high, p.precip, p.code || 0),
    convective: p.convective,
  };
}

// METAR-style one-liner for the start screen and the HUD.
export function describe(w, elev) {
  const s0 = w.wind[0];
  const kt = Math.round(s0.spd / KT), g = Math.round(w.gust / KT);
  const wind = kt < 2 ? 'calm' : `${String(Math.round(s0.dir / 10) * 10 % 360 || 360).padStart(3, '0')}° ${kt}${g > kt + 4 ? ' G' + g : ''} kt`;
  const c = w.clouds.low.cover;
  const oktas = c < 0.06 ? null : c < 0.3 ? 'few' : c < 0.55 ? 'scattered' : c < 0.9 ? 'broken' : 'overcast';
  const base = Math.round((w.clouds.low.base - elev) / 0.3048 / 100) * 100;
  const sky = oktas ? `${oktas} ${base} ft` : w.clouds.mid.cover > 0.4 ? 'high cloud' : 'clear';
  const vis = w.vis >= 10000 ? '10 km+' : (w.vis / 1000).toFixed(1) + ' km';
  const wx = w.precip > 0.1 ? (w.snow ? ' · snow' : ' · rain') : '';
  return `${wind} · ${sky} · ${vis} · ${Math.round(w.tempC)}°C · ${Math.round(w.qnh)} hPa${wx}`;
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// The air the flight model flies through: real pressure and temperature, the
// wind profile, orographic lift off the real terrain, and turbulence.
export class Air {
  constructor() {
    this.terrain = null;
    this.elev = 0;
    this.w = presetWeather('clear', 0);
    this.out = { n: 0, e: 0, d: 0, gu: 0, gv: 0, gw: 0, gp: 0, gq: 0, gr: 0 };
    this.sigma = 0;
    this.hold = null;            // a fixed ground level while the fine terrain is still streaming in
    this.ground = (n, e) => (this.hold !== null ? this.hold : this.terrain ? this.terrain.heightAt(e, n) : this.elev);
    this.atmosphere = (alt) => {
      const p = this.w.qnh * 100 * Math.pow(Math.max(0.2, 1 - 0.0065 * alt / 288.15), 5.25588);
      const T = this.w.tempC + 273.15 + 0.0065 * (this.elev - alt);
      this._atm.T = T; this._atm.p = p; this._atm.rho = p / (287.053 * T);
      return this._atm;
    };
    this._atm = { T: 288, p: 101325, rho: 1.225 };
    this.wind = () => this.out;
    this._mean = { n: 0, e: 0, spd: 0, dir: 0 };
  }
  set(weather, elev) { this.w = weather; this.elev = elev; }

  // mean wind vector at an altitude (the direction the air is moving)
  meanWind(alt) {
    const L = this.w.wind;
    let a = L[0], b = L[L.length - 1], t = 0;
    if (alt <= a.alt) { b = a; } else if (alt >= b.alt) { a = b; } else {
      for (let i = 1; i < L.length; i++) if (alt <= L[i].alt) { a = L[i - 1]; b = L[i]; t = (alt - a.alt) / (b.alt - a.alt); break; }
    }
    const rad = Math.PI / 180;
    const n = -(a.spd * Math.cos(a.dir * rad)) * (1 - t) - (b.spd * Math.cos(b.dir * rad)) * t;
    const e = -(a.spd * Math.sin(a.dir * rad)) * (1 - t) - (b.spd * Math.sin(b.dir * rad)) * t;
    const m = this._mean;
    m.n = n; m.e = e; m.spd = Math.hypot(n, e); m.dir = (Math.atan2(-e, -n) / rad + 360) % 360;
    return m;
  }

  update(dt, fm) {
    const o = this.out, w = this.w;
    const alt = -fm.pos[2], agl = Math.max(fm.out.agl, 0);
    const m = this.meanWind(alt);
    // surface layer: wind falls off logarithmically toward the ground
    const shear = agl < 10 ? Math.log((Math.max(agl, 0.3) + 0.03) / 0.03) / Math.log(10.03 / 0.03) : 1;
    o.n = m.n * shear; o.e = m.e * shear;
    // air pushed up (or down) the slope it is blowing against
    let lift = 0;
    if (this.terrain && agl < 2500 && m.spd > 0.5) {
      const n = fm.pos[0], e = fm.pos[1], s = 180;
      const dhdn = (this.terrain.heightAt(e, n + s) - this.terrain.heightAt(e, n - s)) / (2 * s);
      const dhde = (this.terrain.heightAt(e + s, n) - this.terrain.heightAt(e - s, n)) / (2 * s);
      lift = Math.max(-6, Math.min(6, (m.n * dhdn + m.e * dhde))) * Math.exp(-agl / 450) * Math.min(1, agl / 15);
    }
    o.d = -lift;
    // turbulence intensity: mechanical near the ground, gusts, convection, cloud
    const s10 = w.wind[0].spd;
    const c = w.clouds.low;
    const inCloud = alt > c.base && alt < c.top ? c.cover : 0;
    const belowBase = alt < c.base ? 1 : Math.exp(-(alt - c.base) / 600);
    const sigma = 0.07 * s10 * Math.exp(-agl / 700)
      + 0.30 * Math.max(0, w.gust - s10) * Math.exp(-agl / 1100)
      + 0.55 * w.convective * belowBase * Math.min(1, agl / 120)
      + inCloud * (0.35 + 0.6 * w.convective)
      + Math.abs(lift) * 0.25;
    this.sigma = sigma;
    const V = Math.max(fm.out.tas, 15);
    const ou = (g, tau, sd) => g + (-g / tau) * dt + sd * Math.sqrt(2 * dt / tau) * gauss();
    o.gu = ou(o.gu, 260 / V, sigma);
    o.gv = ou(o.gv, 260 / V, sigma);
    o.gw = ou(o.gw, 150 / V, sigma * 0.8);
    o.gp = ou(o.gp, 0.5, sigma * 0.10);
    o.gq = ou(o.gq, 0.6, sigma * 0.035);
    o.gr = ou(o.gr, 0.8, sigma * 0.03);
    if (fm.out.onGround && fm.out.gs < 1) { o.gp = o.gq = o.gr = 0; }
  }
}
