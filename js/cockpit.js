// The panel: a classic six-pack and engine gauges, each drawn live to its own
// canvas from the flight model's instrument outputs (pitot-static airspeed,
// Kollsman-corrected altitude, lagged VSI, gyro attitude and heading, the ball).
// The VOR/ILS indicator, the ADF and the radio stack read the radio navigation
// state (js/nav.js) from the optional d.nav passed to update().
import * as THREE from '../vendor/three.module.js';
import { KT, FT } from './fdm.js';

const R2D = 180 / Math.PI;
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const S = 256, C = S / 2;

const pol = (r, aDeg) => { const a = (aDeg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
function tick(x, a, r0, r1, w, col = '#f4f4f0') {
  const [x0, y0] = pol(r0, a), [x1, y1] = pol(r1, a);
  x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'butt';
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
}
function label(x, txt, a, r, size, col = '#f4f4f0', weight = 500) {
  const [px, py] = pol(r, a);
  x.fillStyle = col; x.font = `${weight} ${size}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(txt, px, py + 1);
}
function text(x, txt, px, py, size, col = '#cfcfca', weight = 500) {
  x.fillStyle = col; x.font = `${weight} ${size}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(txt, px, py);
}
function arc(x, a0, a1, r, w, col) {
  x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'butt';
  x.beginPath(); x.arc(C, C, r, (a0 - 90) * Math.PI / 180, (a1 - 90) * Math.PI / 180); x.stroke();
}
function needle(x, a, len, tail, w, col = '#f4f4f0') {
  x.save(); x.translate(C, C); x.rotate(a * Math.PI / 180);
  x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 5; x.shadowOffsetY = 2;
  x.fillStyle = col;
  x.beginPath(); x.moveTo(-w, tail); x.lineTo(-w * 0.8, -len * 0.75); x.lineTo(0, -len); x.lineTo(w * 0.8, -len * 0.75); x.lineTo(w, tail); x.closePath(); x.fill();
  x.restore();
}
function hub(x, r = 9) { x.fillStyle = '#1b1b1c'; x.beginPath(); x.arc(C, C, r, 0, 7); x.fill(); x.strokeStyle = '#3a3a3c'; x.lineWidth = 1.5; x.stroke(); }
function faceBase(x) {
  x.clearRect(0, 0, S, S);
  x.fillStyle = '#0c0c0d'; x.beginPath(); x.arc(C, C, C, 0, 7); x.fill();
  const g = x.createRadialGradient(C, C * 0.7, 10, C, C, C);
  g.addColorStop(0, '#19191b'); g.addColorStop(1, '#0a0a0b');
  x.fillStyle = g; x.beginPath(); x.arc(C, C, C - 5, 0, 7); x.fill();
}
const deg3 = (v) => String(Math.round(v) % 360).padStart(3, '0');
function lutFn(xs, ys) {
  return (v) => {
    if (v <= xs[0]) return ys[0];
    if (v >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = 1; while (xs[i] < v) i++;
    return ys[i - 1] + (ys[i] - ys[i - 1]) * (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
  };
}

class Gauge {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = S;
    this.x = this.canvas.getContext('2d');
    this.face = document.createElement('canvas'); this.face.width = this.face.height = S;
    this.fx = this.face.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.last = null;
  }
  begin() { this.x.clearRect(0, 0, S, S); this.x.drawImage(this.face, 0, 0); return this.x; }
  end() { this.tex.needsUpdate = true; }
}

// ---------------------------------------------------------------- airspeed
// The dial is laid out from the aircraft's own limiting speeds, so the white,
// green and yellow arcs and the red line are that aircraft's.
class Airspeed extends Gauge {
  constructor(lim = { vs0: 40, vs1: 48, vfe: 85, vno: 129, vne: 163 }) {
    super();
    const vmin = Math.max(20, Math.floor(lim.vs0 * 0.85 / 10) * 10), vmax = Math.ceil(lim.vne * 1.18 / 20) * 20;
    const step = vmax > 230 ? 10 : 5, lab = vmax > 230 ? 40 : 20;
    // a gentle stretch at the slow end, where a knot matters most
    const ang = (v) => (v <= vmin ? 28 * Math.max(0, v) / vmin : 28 + 298 * Math.pow((Math.min(v, vmax) - vmin) / (vmax - vmin), 0.85));
    this.ang = ang;
    const x = this.fx; faceBase(x);
    if (lim.vfe) arc(x, ang(lim.vs0), ang(lim.vfe), 99, 7, '#f1f1ec');
    arc(x, ang(lim.vs1), ang(lim.vno), 108, 8, '#2fa35a');
    arc(x, ang(lim.vno), ang(lim.vne), 108, 8, '#e8c027');
    tick(x, ang(lim.vne), 94, 114, 4, '#e0362c');
    for (let v = vmin; v <= vmax; v += step) tick(x, ang(v), v % (step * 2) ? 104 : 96, 113, v % (step * 2) ? 1.5 : 2.5);
    for (let v = Math.ceil(vmin / lab) * lab; v <= vmax; v += lab) label(x, v, ang(v), 78, 19);
    text(x, 'AIRSPEED', C, C - 34, 11); text(x, 'KNOTS', C, C + 36, 11);
  }
  draw(o) {
    const kt = o.ias / KT;
    if (this.last !== null && Math.abs(kt - this.last) < 0.15) return;
    this.last = kt;
    const x = this.begin(); needle(x, this.ang(kt), 96, 18, 4.5); hub(x); this.end();
  }
}

// ---------------------------------------------------------------- attitude
class Attitude extends Gauge {
  constructor() { super(); const x = this.fx; x.clearRect(0, 0, S, S); }
  draw(o) {
    const key = Math.round(o.pitch * 2000) + Math.round(o.roll * 2000) * 7919;
    if (key === this.last) return; this.last = key;
    const x = this.x; x.clearRect(0, 0, S, S);
    x.fillStyle = '#0c0c0d'; x.beginPath(); x.arc(C, C, C, 0, 7); x.fill();
    x.save();
    x.beginPath(); x.arc(C, C, 112, 0, 7); x.clip();
    x.translate(C, C); x.rotate(-o.roll);
    // outer bank ring
    x.fillStyle = '#3f86cf'; x.fillRect(-200, -200, 400, 200);
    x.fillStyle = '#6e4a27'; x.fillRect(-200, 0, 400, 200);
    x.strokeStyle = '#f4f4f0'; x.lineWidth = 2;
    for (const b of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
      const a = b * Math.PI / 180, r0 = b % 30 === 0 ? 92 : 100;
      x.beginPath(); x.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); x.lineTo(Math.sin(a) * 112, -Math.cos(a) * 112); x.stroke();
    }
    // inner card moves with pitch
    x.beginPath(); x.arc(0, 0, 88, 0, 7); x.clip();
    const pp = 2.7, py = Math.max(-28, Math.min(28, o.pitch * R2D)) * pp;
    x.fillStyle = '#4a90d9'; x.fillRect(-200, -300 + py, 400, 300);
    x.fillStyle = '#7b5530'; x.fillRect(-200, py, 400, 300);
    x.strokeStyle = '#f4f4f0'; x.lineWidth = 2.5;
    x.beginPath(); x.moveTo(-200, py); x.lineTo(200, py); x.stroke();
    x.lineWidth = 1.8; x.fillStyle = '#f4f4f0'; x.font = `500 12px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let d = -30; d <= 30; d += 5) {
      if (d === 0) continue;
      const y = py - d * pp, w = d % 10 === 0 ? 26 : 13;
      x.beginPath(); x.moveTo(-w, y); x.lineTo(w, y); x.stroke();
      if (d % 10 === 0) { x.fillText(Math.abs(d), -w - 11, y); x.fillText(Math.abs(d), w + 11, y); }
    }
    x.restore();
    // fixed parts: sky pointer and the miniature aeroplane
    x.fillStyle = '#f39a1e';
    x.beginPath(); x.moveTo(C, C - 88); x.lineTo(C - 7, C - 74); x.lineTo(C + 7, C - 74); x.closePath(); x.fill();
    x.strokeStyle = '#f39a1e'; x.lineWidth = 5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(C - 62, C); x.lineTo(C - 24, C); x.lineTo(C - 24, C + 9); x.moveTo(C + 62, C); x.lineTo(C + 24, C); x.lineTo(C + 24, C + 9); x.stroke();
    x.fillStyle = '#f39a1e'; x.beginPath(); x.arc(C, C, 4, 0, 7); x.fill();
    this.end();
  }
}

// ---------------------------------------------------------------- altimeter
class Altimeter extends Gauge {
  constructor() {
    super();
    const x = this.fx; faceBase(x);
    for (let i = 0; i < 50; i++) tick(x, i * 7.2, i % 5 ? 104 : 96, 113, i % 5 ? 1.5 : 2.6);
    for (let i = 0; i < 10; i++) label(x, i, i * 36, 80, 23);
    text(x, 'ALT', C, C - 40, 11); text(x, '100 FT', C, C - 54, 9);
    x.fillStyle = '#050505'; x.fillRect(C + 34, C - 11, 52, 22); x.strokeStyle = '#444'; x.lineWidth = 1; x.strokeRect(C + 34, C - 11, 52, 22);
  }
  draw(o, kollsman) {
    const ft = o.altInd / FT;
    const key = Math.round(ft * 2) + Math.round(kollsman);
    if (key === this.last) return; this.last = key;
    const x = this.begin();
    text(x, (kollsman / 3386.39).toFixed(2), C + 60, C + 0.5, 14, '#f4f4f0');
    // ten-thousands: thin pointer with a triangle at the rim
    x.save(); x.translate(C, C); x.rotate((ft / 100000) * Math.PI * 2);
    x.strokeStyle = '#f4f4f0'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -100); x.stroke();
    x.fillStyle = '#f4f4f0'; x.beginPath(); x.moveTo(0, -112); x.lineTo(-7, -98); x.lineTo(7, -98); x.closePath(); x.fill();
    x.restore();
    needle(x, (ft / 10000) * 360, 58, 14, 7);
    needle(x, (ft / 1000) * 360, 100, 20, 3.6);
    hub(x); this.end();
  }
}

// ---------------------------------------------------------------- turn coordinator
class TurnCoordinator extends Gauge {
  constructor() {
    super();
    const x = this.fx; faceBase(x);
    for (const a of [90, 270]) tick(x, a, 92, 112, 4);
    for (const a of [110, 250]) tick(x, a, 92, 112, 4);
    text(x, 'L', C - 78, C + 52, 15, '#f4f4f0'); text(x, 'R', C + 78, C + 52, 15, '#f4f4f0');
    text(x, '2 MIN', C, C + 100, 10); text(x, 'TURN COORDINATOR', C, C - 62, 9);
    // inclinometer tube
    x.strokeStyle = '#d8d6cc'; x.lineWidth = 22; x.lineCap = 'round';
    x.beginPath(); x.arc(C, C - 120, 190, (90 - 16) * Math.PI / 180, (90 + 16) * Math.PI / 180); x.stroke();
    x.strokeStyle = '#111'; x.lineWidth = 2;
    for (const d of [-3.4, 3.4]) { const a = (90 + d) * Math.PI / 180; x.beginPath(); x.moveTo(C + 179 * Math.cos(a), C - 120 + 179 * Math.sin(a)); x.lineTo(C + 201 * Math.cos(a), C - 120 + 201 * Math.sin(a)); x.stroke(); }
  }
  draw(o) {
    const rate = Math.max(-0.14, Math.min(0.14, o.turnRate));
    const ball = Math.max(-0.26, Math.min(0.26, o.slip * 1.6));
    const key = Math.round(rate * 3000) * 1000 + Math.round(ball * 300);
    if (key === this.last) return; this.last = key;
    const x = this.begin();
    const a = (90 - ball * R2D) * Math.PI / 180;
    x.fillStyle = '#0b0b0b'; x.beginPath(); x.arc(C + 190 * Math.cos(a), C - 120 + 190 * Math.sin(a), 9.5, 0, 7); x.fill();
    x.save(); x.translate(C, C); x.rotate((rate * R2D / 3) * 20 * Math.PI / 180);
    x.fillStyle = '#f4f4f0';
    x.fillRect(-92, -3, 184, 6);
    x.beginPath(); x.arc(0, 0, 12, 0, 7); x.fill();
    x.fillRect(-2.5, -34, 5, 30);
    x.fillRect(-22, -31, 44, 4);
    x.restore();
    this.end();
  }
}

// ---------------------------------------------------------------- heading indicator
class Heading extends Gauge {
  constructor() { super(); this.fx.clearRect(0, 0, S, S); }
  draw(o, bug) {
    const hdg = o.heading * R2D;
    const key = Math.round(hdg * 5) + (bug == null ? 0 : Math.round(bug * R2D) * 4001);
    if (key === this.last) return; this.last = key;
    const x = this.x; faceBase(x);
    x.save(); x.translate(C, C); x.rotate(-o.heading); x.translate(-C, -C);
    for (let d = 0; d < 360; d += 5) tick(x, d, d % 10 ? 101 : 94, 112, d % 10 ? 1.5 : 2.4);
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = 0; d < 360; d += 30) {
      const [px, py] = pol(76, d);
      x.save(); x.translate(px, py); x.rotate(d * Math.PI / 180);
      x.fillStyle = '#f4f4f0'; x.font = `500 ${names[d] ? 23 : 19}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(names[d] || d / 10, 0, 1); x.restore();
    }
    if (bug != null) {
      x.save(); x.translate(C, C); x.rotate(bug);
      x.fillStyle = '#f39a1e'; x.fillRect(-9, -120, 18, 9); x.restore();
    }
    x.restore();
    // fixed lubber line and aeroplane
    x.fillStyle = '#f4f4f0'; x.beginPath(); x.moveTo(C, C - 96); x.lineTo(C - 6, C - 116); x.lineTo(C + 6, C - 116); x.closePath(); x.fill();
    x.strokeStyle = '#f39a1e'; x.lineWidth = 3.5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(C, C - 40); x.lineTo(C, C + 34); x.moveTo(C - 30, C - 6); x.lineTo(C + 30, C - 6); x.moveTo(C - 12, C + 28); x.lineTo(C + 12, C + 28); x.stroke();
    this.end();
  }
}

// ---------------------------------------------------------------- vertical speed
class VSI extends Gauge {
  constructor() {
    super();
    const x = this.fx; faceBase(x);
    for (let v = -2000; v <= 2000; v += 100) tick(x, 270 + (v / 2000) * 172, v % 500 ? 104 : 96, 113, v % 500 ? 1.5 : 2.6);
    for (const v of [-2000, -1500, -1000, -500, 500, 1000, 1500, 2000]) label(x, Math.abs(v) / 100, 270 + (v / 2000) * 172, 80, 19);
    label(x, '0', 270, 82, 19);
    text(x, 'VERTICAL SPEED', C + 22, C - 22, 9); text(x, '100 FT PER MIN', C + 22, C + 22, 9);
    text(x, 'UP', C - 40, C - 28, 10); text(x, 'DN', C - 40, C + 28, 10);
  }
  draw(o) {
    const fpm = Math.max(-2000, Math.min(2000, o.vsInd / FT * 60));
    if (this.last !== null && Math.abs(fpm - this.last) < 6) return; this.last = fpm;
    const x = this.begin(); needle(x, 270 + (fpm / 2000) * 172, 96, 18, 4.5); hub(x); this.end();
  }
}

// ---------------------------------------------------------------- tachometer
class Tach extends Gauge {
  constructor(redline = 2700) {
    super();
    const x = this.fx; faceBase(x);
    const ang = (r) => -135 + (r / 3500) * 270;
    arc(x, ang(redline * 0.78), ang(redline), 108, 8, '#2fa35a');
    tick(x, ang(redline), 94, 114, 4, '#e0362c');
    for (let r = 0; r <= 3500; r += 100) tick(x, ang(r), r % 500 ? 104 : 96, 113, r % 500 ? 1.5 : 2.6);
    for (let r = 0; r <= 3500; r += 500) label(x, r / 100, ang(r), 78, 19);
    text(x, 'RPM', C, C - 34, 12); text(x, 'X 100', C, C + 60, 10);
    this.ang = ang;
  }
  draw(o) {
    if (this.last !== null && Math.abs(o.rpm - this.last) < 4) return; this.last = o.rpm;
    const x = this.begin(); needle(x, this.ang(o.rpm), 96, 18, 4.5); hub(x); this.end();
  }
}

// ---------------------------------------------------------------- VOR / ILS indicator
// The card turns with the OBS knob; the needles and flags are fixed to the case.
// Reads the cdi block of the nav state (js/nav.js): dots are positive for a
// needle right of centre and for a glideslope needle above it. With no nav
// state at all, both flags show and the needles sit in the middle.
const DOT = 12;                    // pixels per dot of deviation
function flag(x, px, py, w, txt) {
  x.fillStyle = '#d2362b'; x.fillRect(px - w / 2, py - 9, w, 18);
  text(x, txt, px, py + 0.5, 12, '#ffffff', 700);
}
class VorIls extends Gauge {
  constructor() {
    super();
    // the face canvas holds the card with north up; draw() spins it under the lubber line
    const x = this.fx; faceBase(x);
    for (let d = 0; d < 360; d += 5) tick(x, d, d % 10 ? 106 : 100, 115, d % 10 ? 1.5 : 2.4);
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = 0; d < 360; d += 30) {
      const [px, py] = pol(87, d);
      x.save(); x.translate(px, py); x.rotate(d * Math.PI / 180);
      x.fillStyle = '#f4f4f0'; x.font = `500 ${names[d] ? 18 : 16}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(names[d] || d / 10, 0, 1); x.restore();
    }
  }
  draw(nv) {
    const c = nv ? nv.cdi : null;
    const ok = !!(c && c.valid), gsOk = !!(c && c.gsValid);
    const obs = c ? c.obs : 0;
    const dots = ok ? Math.max(-5, Math.min(5, c.dots)) : 0;
    const gdots = gsOk ? Math.max(-5, Math.min(5, c.gsDots)) : 0;
    const tf = ok ? c.toFrom : 0;
    const key = `${Math.round(obs * 4)} ${Math.round(dots * DOT * 2)} ${Math.round(gdots * DOT * 2)} ${tf} ${ok} ${gsOk}`;
    if (key === this.last) return; this.last = key;
    const x = this.x; x.clearRect(0, 0, S, S);
    x.save(); x.translate(C, C); x.rotate(-obs * Math.PI / 180); x.drawImage(this.face, -C, -C); x.restore();
    // the fixed face inside the card: five dots each way, and a ring for the centre
    x.fillStyle = '#0b0b0c'; x.beginPath(); x.arc(C, C, 75, 0, 7); x.fill();
    x.strokeStyle = '#34343a'; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = '#f4f4f0';
    for (let i = 1; i <= 5; i++) {
      for (const s of [-1, 1]) {
        x.beginPath(); x.arc(C + s * i * DOT, C, 2.3, 0, 7); x.fill();
        x.beginPath(); x.arc(C, C + s * i * DOT, 2.3, 0, 7); x.fill();
      }
    }
    x.strokeStyle = '#f4f4f0'; x.lineWidth = 1.6; x.beginPath(); x.arc(C, C, 6, 0, 7); x.stroke();
    // flags: NAV and GS show red when there is nothing to follow
    if (!ok) flag(x, C - 36, C - 34, 38, 'NAV');
    if (!gsOk) flag(x, C - 36, C + 34, 30, 'GS');
    // TO points up the course, FROM back down it; neither abeam the station or with the flag out
    if (tf) {
      const py = C - tf * 34;
      x.fillStyle = '#f4f4f0';
      x.beginPath(); x.moveTo(C + 36, py - tf * 9); x.lineTo(C + 27, py + tf * 6); x.lineTo(C + 45, py + tf * 6); x.closePath(); x.fill();
      text(x, tf > 0 ? 'TO' : 'FR', C + 36, py + tf * 15, 9, '#cfcfca', 600);
    }
    // the needles: glideslope across, course up and down
    x.save(); x.beginPath(); x.arc(C, C, 73, 0, 7); x.clip();
    x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 4; x.shadowOffsetY = 1.5;
    x.fillStyle = '#f4f4f0';
    x.fillRect(C - 80, C - gdots * DOT - 1.6, 160, 3.2);
    x.fillRect(C + dots * DOT - 2, C - 80, 4, 160);
    x.restore();
    // lubber line at the selected course, and its reciprocal
    x.fillStyle = '#f39a1e';
    x.beginPath(); x.moveTo(C, C - 99); x.lineTo(C - 6, C - 118); x.lineTo(C + 6, C - 118); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(C, C + 102); x.lineTo(C - 4, C + 116); x.lineTo(C + 4, C + 116); x.closePath(); x.fill();
    this.end();
  }
}

// ---------------------------------------------------------------- ADF
// A fixed-card bearing indicator: the needle shows where the station is
// relative to the nose. With no signal it parks at 90 and the flag shows.
class Adf extends Gauge {
  constructor() {
    super();
    const x = this.fx; faceBase(x);
    for (let d = 0; d < 360; d += 5) tick(x, d, d % 10 ? 104 : 96, 113, d % 10 ? 1.5 : 2.4);
    for (let d = 0; d < 360; d += 30) label(x, d / 10, d, 80, 18);
    text(x, 'ADF', C, C + 42, 11);
  }
  draw(nv) {
    const a = nv ? nv.adf : null, ok = !!(a && a.valid);
    const rel = ok ? a.rel : 90;
    const key = Math.round(rel * 4) + (ok ? 0 : 5000);
    if (key === this.last) return; this.last = key;
    const x = this.begin();
    if (!ok) flag(x, C, C - 43, 38, 'OFF');
    x.save(); x.translate(C, C); x.rotate(rel * Math.PI / 180);
    x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 5; x.shadowOffsetY = 2;
    x.fillStyle = '#f2c230';
    x.beginPath(); x.moveTo(0, -100); x.lineTo(9, -80); x.lineTo(2.6, -80); x.lineTo(2.6, 92); x.lineTo(-2.6, 92); x.lineTo(-2.6, -80); x.lineTo(-9, -80); x.closePath(); x.fill();
    x.restore();
    hub(x); this.end();
  }
}

// ---------------------------------------------------------------- twin engine gauges
class Dual extends Gauge {
  constructor(title, left, right) {
    super();
    this.left = left; this.right = right;
    const x = this.fx; faceBase(x);
    for (const [side, d] of [[-1, left], [1, right]]) {
      const a = (t) => (side < 0 ? 232 + t * 76 : 128 - t * 76);
      if (d.green) arc(x, Math.min(a(d.green[0]), a(d.green[1])), Math.max(a(d.green[0]), a(d.green[1])), 106, 9, '#2fa35a');
      if (d.red != null) tick(x, a(d.red), 92, 114, 5, '#e0362c');
      for (let i = 0; i <= 4; i++) tick(x, a(i / 4), 94, 112, 3);
      label(x, d.lo, a(0), 76, 20); label(x, d.hi, a(1), 76, 20);
      text(x, d.name, C + side * 52, C + 4, 17, '#f4f4f0');
    }
    text(x, title, C, C - 86, 15);
    if (left.unit) text(x, left.unit, C - 46, C + 88, 12);
    if (right.unit) text(x, right.unit, C + 46, C + 88, 12);
  }
  draw(l, r) {
    const tl = Math.max(0, Math.min(1, (l - this.left.min) / (this.left.max - this.left.min)));
    const tr = Math.max(0, Math.min(1, (r - this.right.min) / (this.right.max - this.right.min)));
    const key = Math.round(tl * 400) * 1000 + Math.round(tr * 400);
    if (key === this.last) return; this.last = key;
    const x = this.begin();
    needle(x, 232 + tl * 76, 98, -22, 4.5); needle(x, 128 - tr * 76, 98, -22, 4.5);
    this.end();
  }
}

// ---------------------------------------------------------------- radio / GPS stack
class Stack {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = 320; this.canvas.height = 448;
    this.x = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.t = 0;
  }
  draw(dt, d) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.25;
    const x = this.x, W = 320;
    x.fillStyle = '#17181a'; x.fillRect(0, 0, W, 448);
    const box = (y, h) => { x.fillStyle = '#060707'; x.fillRect(10, y, W - 20, h); x.strokeStyle = '#2c2d30'; x.lineWidth = 2; x.strokeRect(10, y, W - 20, h); };
    const lcd = '#f0a23a', grn = '#7fe08a', dim = '#3d4a3f';
    // radio navigation state (js/nav.js), if the sim is feeding one
    const nv = d.nav || null, n1 = nv ? nv.nav1 : null, adf = nv ? nv.adf : null;
    const gp = nv && nv.gps && nv.gps.valid ? nv.gps : null;
    x.textBaseline = 'middle';
    // GPS
    box(10, 232);
    x.save(); x.beginPath(); x.rect(12, 12, W - 24, 228); x.clip();
    x.translate(W / 2, 150); x.rotate(-d.heading);
    const sc = 110 / Math.max(2500, d.range);       // metres -> px
    x.strokeStyle = '#3a6f8f'; x.lineWidth = 1;
    for (let r = 1; r <= 3; r++) { x.beginPath(); x.arc(0, 0, r * 55, 0, 7); x.stroke(); }
    for (const rw of d.runways) {
      x.strokeStyle = '#e9e9e2'; x.lineWidth = 3.5; x.lineCap = 'butt';
      x.beginPath(); x.moveTo((rw.e0 - d.e) * sc, -(rw.n0 - d.n) * sc); x.lineTo((rw.e1 - d.e) * sc, -(rw.n1 - d.n) * sc); x.stroke();
    }
    if (gp) {                                         // the direct-to leg
      x.strokeStyle = '#e04bd0'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, 0); x.lineTo((gp.e - d.e) * sc, -(gp.n - d.n) * sc); x.stroke();
    }
    x.fillStyle = grn; x.font = `600 13px ${FONT}`; x.textAlign = 'center';
    x.save(); x.translate(0, -124); x.rotate(d.heading); x.fillText('N', 0, 0); x.restore();
    x.restore();
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(W / 2, 138); x.lineTo(W / 2 - 8, 160); x.lineTo(W / 2, 154); x.lineTo(W / 2 + 8, 160); x.closePath(); x.fill();
    x.fillStyle = '#060707'; x.fillRect(12, 12, W - 24, 30);
    x.font = `600 15px ${FONT}`; x.textAlign = 'left'; x.fillStyle = grn;
    x.fillText(gp ? gp.ident : d.ident, 20, 28);
    x.textAlign = 'right';
    x.fillText(`${deg3(gp ? gp.bearing : d.brg)}°  ${(gp ? gp.distNm : d.dist).toFixed(1)} NM`, W - 20, 28);
    x.fillStyle = '#060707'; x.fillRect(12, 214, W - 24, 26);
    x.fillStyle = grn; x.textAlign = 'left'; x.fillText(`GS ${Math.round(d.gs)} KT`, 20, 228);
    x.textAlign = 'right'; x.fillText(`TRK ${String(Math.round(d.trk)).padStart(3, '0')}°`, W - 20, 228);
    // NAV 1: frequency and OBS; the ident appears once the station is received; DME distance, closing speed, time
    box(252, 50);
    x.font = `600 15px ${FONT}`;
    x.fillStyle = lcd; x.textAlign = 'left'; x.fillText(`NAV1 ${n1 ? n1.mhz : '---.--'}`, 22, 267);
    x.fillStyle = grn; x.fillText(n1 && n1.ident ? n1.ident : '', 128, 267);
    x.fillStyle = n1 ? lcd : dim; x.textAlign = 'right'; x.fillText(n1 ? `OBS ${deg3(n1.obs)}°` : 'OBS ---°', W - 22, 267);
    const dme = n1 && n1.dme;
    x.fillStyle = dme ? lcd : dim; x.textAlign = 'left'; x.fillText(dme ? `DME ${n1.dmeNm.toFixed(1)} NM` : 'DME --.- NM', 22, 288);
    x.textAlign = 'right';
    x.fillText(dme ? `${Math.round(n1.dmeKt)} KT  ${n1.dmeMin === null ? '--' : Math.min(99, Math.round(n1.dmeMin))} MIN` : '--- KT  -- MIN', W - 22, 288);
    // ADF, outside air temperature, transponder
    box(312, 50);
    x.fillStyle = adf && adf.khz ? lcd : dim; x.textAlign = 'left'; x.fillText(adf && adf.khz ? `ADF ${Math.round(adf.khz)}` : 'ADF ---', 22, 327);
    x.fillStyle = grn; x.fillText(adf && adf.ident ? adf.ident : '', 100, 327);
    x.fillStyle = lcd; x.textAlign = 'right'; x.fillText(`OAT ${Math.round(d.oat)}°C`, W - 22, 327);
    x.textAlign = 'left'; x.fillText(`XPDR ${d.xpdr}`, 22, 348);
    // autopilot: HDG, or what the coupler is following; ALT, or the glideslope
    box(372, 64);
    const cp = d.ap && nv && nv.ap && nv.ap.mode !== 'off' ? nv.ap : null;
    x.textAlign = 'left';
    x.fillStyle = d.ap ? grn : dim;
    x.fillText(d.ap ? 'AP' : 'AP OFF', 22, 392);
    if (d.ap) {
      x.fillText(`${cp ? cp.lat : 'HDG'} ${deg3(d.apHdg)}°`, 80, 392);
      x.fillText(cp && cp.vert === 'GS' ? 'GS 3.0°' : `ALT ${Math.round(d.apAlt / 10) * 10} FT`, 80, 418);
      if (cp && cp.vert && cp.vert !== 'GS') { x.font = `600 12px ${FONT}`; x.fillStyle = lcd; x.fillText(cp.vert, 190, 418.5); x.font = `600 15px ${FONT}`; }
    }
    x.textAlign = 'right'; x.fillStyle = lcd; x.fillText(`QNH ${Math.round(d.qnh)}`, W - 22, 392);
    x.fillText(`${d.fuelGal.toFixed(0)} GAL`, W - 22, 418);
    this.tex.needsUpdate = true;
  }
}

function switchStrip() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#222325'; x.fillRect(0, 0, 512, 96);
  const names = ['MASTER', 'AVN', 'BCN', 'LAND', 'TAXI', 'NAV', 'STROBE', 'PITOT', 'PUMP'];
  names.forEach((n, i) => {
    const px = 34 + i * 55;
    x.fillStyle = i === 0 ? '#b3261e' : '#e8e6de'; x.fillRect(px - 9, 22, 18, 34);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(px - 9, 40, 18, 16);
    text(x, n, px, 76, 10, '#c9c8c2', 600);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// The magnetic compass: a card on a float, read through a window. Numbers run
// backwards because you are looking at the back of the card.
class Compass {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = 256; this.canvas.height = 96;
    this.x = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.last = null;
  }
  draw(heading) {
    const hd = heading * R2D;
    if (this.last !== null && Math.abs(hd - this.last) < 0.2) return; this.last = hd;
    const x = this.x, W = 256, H = 96, px = 3.4;        // pixels per degree
    x.fillStyle = '#0a0a0b'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#f4f4f0'; x.strokeStyle = '#f4f4f0'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = Math.floor((hd - 45) / 5) * 5; d <= hd + 45; d += 5) {
      const dd = ((d % 360) + 360) % 360, sx = W / 2 - (d - hd) * px;       // higher headings sit to the left
      x.lineWidth = dd % 10 ? 1.5 : 2.5;
      x.beginPath(); x.moveTo(sx, H - 8); x.lineTo(sx, H - (dd % 10 ? 22 : 30)); x.stroke();
      if (dd % 30 === 0) { x.font = `600 ${names[dd] ? 30 : 26}px ${FONT}`; x.fillText(names[dd] || dd / 10, sx, 32); }
    }
    x.strokeStyle = '#f39a1e'; x.lineWidth = 3; x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W / 2, H); x.stroke();
    this.tex.needsUpdate = true;
  }
}
// Warning lights along the top of the panel: dark until something is wrong.
class Annunciator {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = 48;
    this.x = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.last = '';
  }
  draw(ind) {
    const items = [['VOLTS', ind && ind.lowVolts, '#e0362c'], ['VAC', ind && ind.lowVac, '#f0a23a'], ['OIL PRESS', ind && ind.lowOil, '#e0362c'], ['LOW FUEL', ind && (ind.fuelL < 9 || ind.fuelR < 9) && ind.avionics, '#f0a23a'], ['TURN', ind && ind.tcFlag, '#f0a23a']];
    const key = items.map((i) => (i[1] ? 1 : 0)).join('');
    if (key === this.last) return; this.last = key;
    const x = this.x; x.fillStyle = '#101112'; x.fillRect(0, 0, 512, 48);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `700 19px ${FONT}`;
    items.forEach(([name, on, col], i) => {
      const px = 8 + i * 100;
      x.fillStyle = on ? col : '#1c1d1f'; x.fillRect(px, 6, 94, 36);
      x.fillStyle = on ? '#0a0a0b' : '#2c2d30'; x.fillText(name, px + 47, 25);
    });
    this.tex.needsUpdate = true;
  }
}

export const EYE = new THREE.Vector3(-0.26, 0.66, 0.16);

export function buildCockpit(def = null) {
  const lim = def ? def.limits : undefined, redline = def && def.engine ? def.engine.rpmMax : 2700;
  const group = new THREE.Group();
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.85 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.95 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.5 });
  const PZ = -0.50;

  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.46), panelMat);
  board.position.set(0, 0.25, PZ); board.receiveShadow = true;
  group.add(board);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.20, 0.05), panelMat);
  lower.position.set(0, -0.06, PZ - 0.01); lower.rotation.x = -0.2; lower.receiveShadow = true;
  group.add(lower);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.035, 0.56), blackMat);
  shield.position.set(0, 0.49, PZ - 0.22); shield.receiveShadow = true; shield.castShadow = true;
  group.add(shield);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.03), blackMat);
  lip.position.set(0, 0.475, PZ + 0.055);
  group.add(lip);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 3.2), new THREE.MeshStandardMaterial({ color: 0x2f2e2c, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.40, 0.6); floor.receiveShadow = true;
  group.add(floor);
  // seat backs, so looking over your shoulder finds a cabin
  for (const sx of [-0.26, 0.26]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.09), new THREE.MeshStandardMaterial({ color: 0x3b3a37, roughness: 1 }));
    seat.position.set(sx, 0.20, 0.42); seat.rotation.x = 0.16; seat.receiveShadow = true; seat.castShadow = true;
    group.add(seat);
  }

  const mats = [];
  const mount = (gauge, px, py, r) => {
    const mat = new THREE.MeshStandardMaterial({ map: gauge.tex, emissive: 0xffffff, emissiveMap: gauge.tex, emissiveIntensity: 0, roughness: 0.35, transparent: true });
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), mat);
    m.position.set(px, py, PZ + 0.004);
    const bezel = new THREE.Mesh(new THREE.RingGeometry(r * 0.985, r * 1.12, 48), plastic);
    bezel.position.set(px, py, PZ + 0.006);
    group.add(m, bezel);
    mats.push(mat);
    return gauge;
  };
  const g = {
    asi: mount(new Airspeed(lim), -0.355, 0.385, 0.041),
    att: mount(new Attitude(), -0.26, 0.385, 0.041),
    alt: mount(new Altimeter(), -0.165, 0.385, 0.041),
    tc: mount(new TurnCoordinator(), -0.355, 0.288, 0.041),
    hdg: mount(new Heading(), -0.26, 0.288, 0.041),
    vsi: mount(new VSI(), -0.165, 0.288, 0.041),
    tach: mount(new Tach(redline), -0.072, 0.288, 0.037),
    vor: mount(new VorIls(), -0.072, 0.385, 0.041),
    adf: mount(new Adf(), -0.072, 0.19, 0.037),
    fuel: mount(new Dual('FUEL', { name: 'L', lo: 'E', hi: 'F', min: 0, max: 26.5, unit: 'GAL' }, { name: 'R', lo: 'E', hi: 'F', min: 0, max: 26.5, unit: 'GAL' }), -0.455, 0.40, 0.03),
    oil: mount(new Dual('OIL', { name: 'T', lo: '100', hi: '245', min: 100, max: 245, green: [0, 1], red: 1, unit: '°F' }, { name: 'P', lo: '0', hi: '115', min: 0, max: 115, green: [0.43, 0.78], red: 1, unit: 'PSI' }), -0.455, 0.33, 0.03),
    egt: mount(new Dual('', { name: 'EGT', lo: '', hi: '', min: 550, max: 800, unit: '°C' }, { name: 'FF', lo: '0', hi: '19', min: 0, max: 19, unit: 'GPH' }), -0.455, 0.26, 0.03),
  };
  const stack = new Stack();
  const stackMat = new THREE.MeshStandardMaterial({ map: stack.tex, emissive: 0xffffff, emissiveMap: stack.tex, emissiveIntensity: 0.55, roughness: 0.4 });
  const stackMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.28), stackMat);
  stackMesh.position.set(0.105, 0.325, PZ + 0.004);
  group.add(stackMesh);
  const sw = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.064), new THREE.MeshStandardMaterial({ map: switchStrip(), roughness: 0.7 }));
  sw.position.set(-0.30, 0.185, PZ + 0.004);
  group.add(sw);

  // flight controls, the kind this aircraft really has (def.cockpit.controls):
  //   yoke        a wheel on a column out of the panel, one per seat (Cessna, Piper Archer)
  //   panelstick  a stick out of the panel, one per seat (Robin DR400)
  //   sidestick   a grip on the side panel, outboard of each seat (Cirrus SR22)
  //   stick       one stick from the floor between the knees, tandem seats (Cub, Extra 300, glider)
  const kind = (def && def.cockpit && def.cockpit.controls) || 'yoke';
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bbbe, roughness: 0.3, metalness: 0.8 });
  const controls = [];
  const shadows = (o) => o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  for (const sx of kind === 'stick' ? [-0.26] : [-0.26, 0.26]) {
    if (kind === 'yoke' || kind === 'panelstick') {
      const y = new THREE.Group();
      y.position.set(sx, kind === 'yoke' ? 0.105 : 0.085, PZ);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 12), steel);
      shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.1;
      const wheel = new THREE.Group(); wheel.position.z = 0.27;
      if (kind === 'yoke') {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.03), plastic);
        const gl = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.12, 0.034), plastic); gl.position.set(-0.125, 0.045, 0.006);
        const gr = gl.clone(); gr.position.x = 0.125;
        const centre = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.035), plastic);
        wheel.add(bar, gl, gr, centre);
      } else {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.11, 12), plastic);
        grip.position.set(0, 0.05, 0.0); grip.rotation.x = -0.25;
        const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), plastic);
        wheel.add(grip, knuckle);
      }
      y.add(shaft, wheel); shadows(y); group.add(y);
      const roll = kind === 'yoke' ? 1.05 : 0.6;
      controls.push((c) => { wheel.rotation.z = -c.roll * roll; y.position.z = PZ + c.pitch * 0.075; });
    } else if (kind === 'stick') {
      // pivots at the floor; pull back tips it aft, right roll tips it right
      const p = new THREE.Group(); p.position.set(sx, -0.38, -0.14);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.46, 12), steel); rod.position.y = 0.23;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.12, 12), plastic); grip.position.y = 0.50;
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.06, 16), plastic); boot.position.y = 0.03;
      p.add(rod, grip, boot); shadows(p); group.add(p);
      controls.push((c) => { p.rotation.set(c.pitch * 0.28, 0, -c.roll * 0.26); });
    } else {
      // a side-stick: a short grip on a console against the cabin wall, outboard of the seat
      const side = Math.sign(sx);
      const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.40), panelMat);
      console_.position.set(sx + side * 0.29, -0.03, -0.22); console_.receiveShadow = true; group.add(console_);
      const s = new THREE.Group(); s.position.set(sx + side * 0.27, 0.02, -0.26);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10), steel); stem.position.y = 0.02;
      const grip = new THREE.Group(); grip.position.y = 0.06;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.10, 0.045), plastic); handle.position.y = 0.04; handle.rotation.x = -0.2;
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.5 })); hat.position.set(0, 0.095, -0.005);
      grip.add(handle, hat); s.add(stem, grip); shadows(s); group.add(s);
      controls.push((c) => { s.position.z = -0.26 + c.pitch * 0.06; grip.rotation.z = -c.roll * 0.45; });
    }
  }
  // throttle (black), mixture (red)
  const knob = (color, px) => {
    const k = new THREE.Group(); k.position.set(px, 0.075, PZ);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0xc8c9cc, metalness: 0.8, roughness: 0.3 }));
    rod.rotation.x = Math.PI / 2; rod.position.z = -0.03;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.45 }));
    head.rotation.x = Math.PI / 2; head.position.z = 0.06;
    k.add(rod, head); group.add(k);
    return k;
  };
  const throttle = knob(0x111112, 0.02), mixture = knob(0xa8231c, 0.085);
  // flap lever in its slot
  const flapSlot = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.1), blackMat); flapSlot.position.set(0.17, 0.10, PZ + 0.004); group.add(flapSlot);
  const flapLever = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.05), new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.5 }));
  flapLever.position.set(0.17, 0.14, PZ + 0.03); group.add(flapLever);

  // compass on the glareshield, warning lights above the six-pack
  const compass = new Compass(), annun = new Annunciator();
  const compassMat = new THREE.MeshStandardMaterial({ map: compass.tex, emissive: 0xffffff, emissiveMap: compass.tex, emissiveIntensity: 0.02, roughness: 0.3 });
  const compassMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.032), compassMat);
  compassMesh.position.set(-0.02, 0.535, PZ + 0.03);
  const compassCase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.046, 0.06), plastic);
  compassCase.position.set(-0.02, 0.535, PZ - 0.002);
  const annunMat = new THREE.MeshStandardMaterial({ map: annun.tex, emissive: 0xffffff, emissiveMap: annun.tex, emissiveIntensity: 0.5, roughness: 0.5 });
  const annunMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.0178), annunMat);
  annunMesh.position.set(-0.26, 0.2295, PZ + 0.004);   // between the six-pack and the switches, clear of the glareshield lip
  group.add(compassCase, compassMesh, annunMesh);
  mats.push(compassMat);
  let phase = 0;
  return {
    group, gauges: g,
    update(dt, fm, d, night, exposure = 1) {
      const o = fm.out, c = fm.ctl;
      // the flight instruments show what the pitot-static system, the gyros and the
      // electrics make of the truth (d.ind, from js/systems.js); without it, the truth
      const ind = d.ind || o;
      // spread the canvas work across frames
      phase ^= 1;
      g.att.draw(ind);
      if (phase) { g.asi.draw(ind); g.alt.draw(ind, fm.kollsman); g.hdg.draw(ind, d.ap ? d.apHdg * Math.PI / 180 : null); g.tach.draw(o); g.vor.draw(d.nav); compass.draw(d.ind ? d.ind.compass : o.heading); }
      else {
        g.tc.draw(ind); g.vsi.draw(ind); g.adf.draw(d.nav); annun.draw(d.ind);
        const kgToGal = 1 / 0.72 / 3.785;
        if (d.ind) g.fuel.draw(d.ind.fuelL * kgToGal, d.ind.fuelR * kgToGal); else g.fuel.draw(fm.fuel * kgToGal / 2, fm.fuel * kgToGal / 2);
        g.oil.draw(o.oilT * 9 / 5 + 32, d.ind ? d.ind.oilP : o.oilP);
        g.egt.draw(o.egt, o.fuelFlow * 3600 / 0.72 / 3.785);
      }
      stack.draw(dt, d);
      // post lights and displays are set for the eye: dimmer as the eye opens up at night
      const glow = 0.02 + (0.42 * night) / exposure;
      for (const m of mats) m.emissiveIntensity = glow;
      stackMat.emissiveIntensity = Math.min(0.5, 0.75 / exposure);
      for (const f of controls) f(c);
      throttle.position.z = PZ + 0.10 - c.throttle * 0.10;
      mixture.position.z = PZ + 0.10 - c.mixture * 0.10;
      flapLever.position.y = 0.14 - o.flapPos * 0.08;
    },
  };
}
