// Aircraft systems, and what the instruments actually show.
//
// The flight model knows the truth. A pilot only ever sees what the
// instruments make of it: an airspeed indicator fed by a pitot tube that can
// ice over, gyros spun by an engine-driven vacuum pump, a compass that is a
// magnet floating in a bowl. This module models those, the electrics, the
// fuel tanks and magnetos, ice building on the airframe in real cloud, and the
// ways each of them fails. It writes two things: `fm.fx` (what the systems do
// to the aircraft) and `this.ind` (what the panel should display).
//
// No DOM, no three.js: runs under node for test/systems.mjs.

const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// What can break, and how often in real life (mean hours between failures).
// The random-failure rate multiplies these; at 1 they are realistic, which
// means almost never.
export const FAILURES = {
  engine: { name: 'Engine failure', mtbf: 6000 },
  partial: { name: 'Partial power loss', mtbf: 3000 },
  oil: { name: 'Oil pressure loss', mtbf: 9000 },
  magneto: { name: 'Magneto failure', mtbf: 2500 },
  vacuum: { name: 'Vacuum pump failure', mtbf: 500 },
  alternator: { name: 'Alternator failure', mtbf: 900 },
  pitot: { name: 'Pitot blockage', mtbf: 4000 },
  static: { name: 'Static port blockage', mtbf: 8000 },
  flaps: { name: 'Flap motor failure', mtbf: 3000 },
  trim: { name: 'Trim runaway', mtbf: 12000 },
};

export class Systems {
  constructor(fm) { this.fm = fm; this.randomRate = 0; this.reset(); }

  reset() {
    const fm = this.fm;
    this.sw = { master: true, alternator: true, avionics: true, pitotHeat: false, carbHeat: false, magnetos: 3, tank: 'both', lights: true };
    this.failed = {};
    this.ice = 0; this.pitotIce = 0; this.carbIce = 0;
    this.soc = 1; this.volts = 28; this.amps = 0; this.powered = true;
    this.suction = fm.rpm > 500 ? 5 : 0; this.gyro = fm.rpm > 500 ? 1 : 0;
    this.attErr = [0, 0]; this.toppleDir = [Math.random() < 0.5 ? -1 : 1, Math.random() < 0.5 ? -1 : 1];
    this.hdgErr = 0;
    this.compass = fm.out.heading || 0; this.compassRate = 0;
    this.tanks = null; this.lastFuel = fm.fuel;
    this.trapPitot = null; this.trapStatic = null;
    this.oilLeft = 1; this.seized = false; this.badMag = Math.random() < 0.5 ? 1 : 2;
    this.variation = 0;
    this.events = [];
    this.ind = { ias: 0, altInd: 0, vsInd: 0, pitch: 0, roll: 0, heading: 0, compass: 0, turnRate: 0, slip: 0, suction: 0, volts: 28, amps: 0, oilP: 0, fuelL: 0, fuelR: 0, tcFlag: false, lowVolts: false, lowVac: false };
    Object.assign(fm.fx, { ice: 0, power: 1, cut: false, rough: 0, starter: true, flapPower: true, flapFrozen: false, trimOffset: 0 });
  }

  fail(name) { if (FAILURES[name] && !this.failed[name]) { this.failed[name] = true; this.events.push(name); } }
  repair() { this.failed = {}; this.oilLeft = 1; this.seized = false; this.fm.fx.trimOffset = 0; this.trapPitot = this.trapStatic = null; }
  // align the heading gyro with the compass, as a pilot does every quarter of an hour
  syncHeading() { this.hdgErr = wrap(this.compass - (this.fm.out.heading - this.variation)); }

  // wx: { oat (deg C), lwc (0..1 liquid water where the aircraft is: 1 inside thick cloud),
  //       precip (mm/h), humidity (0..1), lat (deg), variation (deg, east positive) }
  update(dt, wx) {
    const fm = this.fm, o = fm.out, fx = fm.fx, sw = this.sw, F = this.failed, eng = fm.def.engine;
    this.variation = (wx.variation || 0) * D2R;

    // ---- random failures
    if (this.randomRate > 0 && !o.onGround) {
      for (const k in FAILURES) if (!F[k] && Math.random() < this.randomRate * dt / (FAILURES[k].mtbf * 3600)) this.fail(k);
    }

    // ---- fuel: two tanks and a selector
    if (!this.tanks) this.tanks = [fm.fuel / 2, fm.fuel / 2];
    const used = Math.max(0, this.lastFuel - fm.fuel);
    const T = this.tanks;
    if (sw.tank === 'left') T[0] -= used; else if (sw.tank === 'right') T[1] -= used;
    else { const tot = T[0] + T[1] || 1; T[0] -= used * (T[0] / tot); T[1] -= used * (T[1] / tot); }
    T[0] = Math.max(0, T[0]); T[1] = Math.max(0, T[1]);
    fm.fuel = T[0] + T[1]; this.lastFuel = fm.fuel;
    const fed = sw.tank === 'off' ? 0 : sw.tank === 'left' ? T[0] : sw.tank === 'right' ? T[1] : T[0] + T[1];

    // ---- airframe ice: supercooled water freezing on whatever flies through it
    const wet = Math.max(wx.lwc || 0, wx.precip > 0.2 && wx.oat < 0.5 ? 0.6 : 0);
    const band = wx.oat <= 0.5 ? clamp((0.5 - wx.oat) / 3, 0, 1) * clamp((wx.oat + 22) / 10, 0, 1) : 0;   // worst between -3 and -12
    const speed = clamp(o.tas / 50, 0.2, 2);
    if (wet > 0.05 && band > 0) this.ice = Math.min(1, this.ice + wet * band * speed * dt / 420);          // severe in about seven minutes
    else this.ice = Math.max(0, this.ice - dt * (wx.oat > 1 ? 0.004 * (wx.oat + 2) : 0.0004));             // melts in warm air, sublimates slowly in cold
    fx.ice = this.ice;

    // ---- pitot: ices faster than the wing unless heated
    if (wet > 0.05 && band > 0 && !(sw.pitotHeat && this.powered)) this.pitotIce = Math.min(1.2, this.pitotIce + wet * band * dt / 60);
    else this.pitotIce = Math.max(0, this.pitotIce - dt * (sw.pitotHeat && this.powered ? 0.05 : wx.oat > 1 ? 0.02 : 0));
    const pitotBlocked = F.pitot || this.pitotIce >= 1;
    if (pitotBlocked && !this.trapPitot) this.trapPitot = o.staticP + o.dynP;       // ram inlet and drain both sealed: the pressure is trapped
    if (!pitotBlocked) this.trapPitot = null;
    if (F.static && !this.trapStatic) this.trapStatic = { p: o.staticP, alt: o.altInd };
    if (!F.static) this.trapStatic = null;

    // ---- carburettor ice (carburetted engines only): worst in mild, humid air at low power
    let power = 1, rough = 0;
    if (eng && eng.carb) {
      const risk = clamp((wx.humidity - 0.5) / 0.4, 0, 1) * clamp((wx.oat + 8) / 8, 0, 1) * clamp((24 - wx.oat) / 10, 0, 1);
      if (sw.carbHeat) this.carbIce = Math.max(0, this.carbIce - dt / 25);
      else if (o.firing) this.carbIce = Math.min(1, this.carbIce + risk * (1.3 - fm.ctl.throttle) * dt / 240);
      power *= 1 - 0.7 * this.carbIce;
      if (sw.carbHeat) { power *= 0.9; if (this.carbIce > 0.05) rough = 0.25; }   // hot air is thinner, and melting ice goes through the engine
      else if (this.carbIce > 0.5) rough = 0.15;
    }

    // ---- ignition: two magnetos, each firing its own set of plugs
    let cut = false;
    const mag = sw.magnetos;                       // 0 off, 1 right, 2 left, 3 both
    const live = (mag & 1 && !(F.magneto && this.badMag === 1) ? 1 : 0) + (mag & 2 && !(F.magneto && this.badMag === 2) ? 1 : 0);
    if (live === 0) cut = true; else if (live === 1) power *= 0.88;                // one set of plugs burns slower: 50 to 150 rpm at run-up
    // ---- oil: pressure goes first, then the engine
    if (F.oil && o.firing) this.oilLeft = Math.max(0, this.oilLeft - dt / 45);
    if (this.oilLeft <= 0 && o.firing && !this.seized) { this.seizeT = (this.seizeT || 0) + dt * (0.3 + fm.ctl.throttle); if (this.seizeT > 150) { this.seized = true; this.events.push('seized'); } }
    if (F.engine || this.seized || fed <= 0) cut = true;
    if (F.partial) { power *= 0.55; rough = Math.max(rough, 0.3); }
    if (this.ice > 0.3) rough = Math.max(rough, 0.1 * this.ice);                   // ice on the blades sheds unevenly
    fx.cut = cut; fx.power = power; fx.rough = rough;

    // ---- electrics: alternator, battery, loads
    const altOn = sw.master && sw.alternator && !F.alternator && fm.rpm > 520;
    let load = sw.master ? 5 : 0;
    if (sw.master) {
      if (sw.avionics) load += 9;
      if (sw.lights) load += 7;
      if (sw.pitotHeat) load += 6;
      if (o.flapMoving) load += 10;
      if (fm.ctl.starter) load += 160;
    }
    if (altOn) { this.soc = Math.min(1, this.soc + dt * 12 / (35 * 3600)); this.volts += (28.2 - this.volts) * Math.min(1, dt * 2); this.amps = load; }
    else {
      this.soc = Math.max(0, this.soc - dt * load / (35 * 3600));
      const open = 21.5 + 3.5 * Math.sqrt(this.soc) - load * 0.012;
      this.volts += ((sw.master ? open : 0) - this.volts) * Math.min(1, dt * 2);
      this.amps = -load;
    }
    this.powered = sw.master && this.volts > 20 && this.soc > 0.002;
    fx.starter = this.powered; fx.flapPower = this.powered; fx.flapFrozen = !!F.flaps;
    // ---- trim runaway: the electric trim drives nose-up until someone pulls the breaker (repair)
    if (F.trim && this.powered) fx.trimOffset = Math.min(0.7, fx.trimOffset + dt * 0.035);

    // ---- vacuum pump and the gyros it spins
    const pump = !F.vacuum && fm.rpm > 250 ? clamp((fm.rpm - 250) / 1100, 0, 1) * 5.2 : 0;
    this.suction += (pump - this.suction) * Math.min(1, dt / 2);
    const want = clamp(this.suction / 4.3, 0, 1);
    this.gyro += (want - this.gyro) * dt / (want > this.gyro ? 35 : 200);          // quick to spin up, minutes to run down
    const slack = clamp((0.9 - this.gyro) / 0.9, 0, 1);
    if (slack > 0) {
      // a slowing gyro leans over, slowly at first: the classic insidious failure
      this.attErr[0] += this.toppleDir[0] * slack * slack * 0.012 * dt + 0.004 * slack * Math.sin(fm.time * 0.7) * dt;
      this.attErr[1] += this.toppleDir[1] * slack * slack * 0.03 * dt + 0.006 * slack * Math.cos(fm.time * 0.5) * dt;
      this.attErr[0] = clamp(this.attErr[0], -0.6, 0.6); this.attErr[1] = clamp(this.attErr[1], -1.2, 1.2);
    } else { const k = Math.exp(-dt / 40); this.attErr[0] *= k; this.attErr[1] *= k; }   // erects itself at a few degrees a minute
    // heading gyro: bearing friction, the Earth turning under it (15 deg/h x sin latitude), and a lot more when it runs down
    const lat = (wx.lat || 0) * D2R;
    this.hdgErr += (-15 * D2R / 3600 * Math.sin(lat) + 3 * D2R / 3600 + slack * slack * 0.02 * this.toppleDir[0]) * dt;

    // ---- magnetic compass: a magnet on a float. It hangs along the apparent vertical, so
    // in a banked turn or under acceleration the Earth's field (which dips steeply toward
    // the ground at these latitudes) pulls it off: the turning and acceleration errors.
    const dip = Math.atan(2 * Math.tan(lat));
    const hTrue = o.heading, th = o.pitch, ph = o.roll;
    const mh = hTrue - this.variation;
    // field in body axes: north and down components rotated by heading, pitch, roll
    const bn = Math.cos(dip), bd = Math.sin(dip);
    const cH = Math.cos(mh), sH = Math.sin(mh), cT = Math.cos(th), sT = Math.sin(th), cP = Math.cos(ph), sP = Math.sin(ph);
    const hx = bn * cH, hy = -bn * sH, hz = bd;                       // after yaw
    const px = hx * cT - hz * sT, pz = hx * sT + hz * cT;             // after pitch
    const bx = px, by = hy * cP + pz * sP, bz = -hy * sP + pz * cP;   // after roll
    // apparent down in body axes is opposite the specific force
    let nx = -(o.ax || 0), ny = -(o.ay || 0), nz = -(o.az || -9.81);
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const bdn = bx * nx + by * ny + bz * nz;
    const mx = bx - bdn * nx, my = by - bdn * ny, mz = bz - bdn * nz;            // field in the card's plane
    const xx = 1 - nx * nx, xy = -nx * ny, xz = -nx * nz;                         // the nose in the card's plane
    const cz = (my * xz - mz * xy) * nx + (mz * xx - mx * xz) * ny + (mx * xy - my * xx) * nz;
    const target = Math.atan2(cz, mx * xx + my * xy + mz * xz);
    // the card swings on its pivot, damped by the fluid
    for (let left = Math.min(dt, 2); left > 1e-6; left -= 0.02) {          // small steps: the card is a stiff little pendulum
      const h = Math.min(0.02, left);
      this.compassRate += (9 * wrap(target - this.compass) - 3.2 * this.compassRate) * h;
      this.compass = wrap(this.compass + this.compassRate * h);
    }

    // ---- what the panel shows
    const ind = this.ind;
    const staticP = this.trapStatic ? this.trapStatic.p : o.staticP;
    const total = this.trapPitot !== null ? this.trapPitot : o.staticP + o.dynP;
    ind.ias = Math.sqrt(2 * Math.max(0, total - staticP) / 1.225);
    ind.altInd = this.trapStatic ? this.trapStatic.alt : o.altInd;
    ind.vsInd = this.trapStatic ? 0 : o.vsInd;
    ind.pitch = o.pitch + this.attErr[0]; ind.roll = o.roll + this.attErr[1];
    ind.heading = ((mh + this.hdgErr) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    ind.compass = (this.compass % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    ind.tcFlag = !this.powered; ind.turnRate = this.powered ? o.turnRate : 0; ind.slip = o.slip;
    ind.suction = this.suction; ind.volts = this.volts; ind.amps = this.amps;
    ind.oilP = o.oilP * this.oilLeft;
    ind.fuelL = this.powered ? T[0] : 0; ind.fuelR = this.powered ? T[1] : 0;
    ind.lowVolts = sw.master && this.volts < 25.5; ind.lowVac = this.suction < 3.5; ind.lowOil = !!eng && o.firing && ind.oilP < 20;
    ind.ice = this.ice; ind.avionics = this.powered && sw.avionics;
  }
}
