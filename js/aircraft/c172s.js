// Cessna 172S Skyhawk SP. Geometry and limits from the type certificate data
// sheet and the pilot's operating handbook; inertias from Roskam's tables.
// `handbook` holds the published figures the validation flies against.
export default {
  id: 'c172s', name: 'Cessna 172S', role: 'Four-seat trainer', power: '180 hp',
  mass: { empty: 767, max: 1157, payload: 170, fuel: 100, fuelMax: 144 },
  inertia: { Ixx: 1285, Iyy: 1825, Izz: 2667 },
  wing: {
    span: 11.0, area: 16.17, x: 0.045, z: -0.85, strips: 40,
    chord: [[0, 1.63], [2.6, 1.63], [5.5, 1.13]],
    twist: [[0, 1.5], [5.5, -1.5]],                 // 3 degrees of washout
    dihedral: 1.73, dihedralEff: 4.2,               // geometric, and with the high-wing fuselage effect
    section: { slope: 0.97, alpha0: -2.6, clmax: [1.46, 1.52], clmin: 1.0, sep: 0.26, cd0: 0.0078, k: 0.019, clmd: 0.3, cm0: -0.045 },
    flap: { y0: 0.62, y1: 2.6, dAlpha0: 14.5, dClmax: 1.15, dCd: 0.072, dCm: 0.20, time: 7, detents: [0, 10, 20, 30] },
    aileron: { y0: 2.62, y1: 5.0, tau: 0.36, up: 20, down: 15 },
  },
  htail: { xLE: -4.08, sweep: 0.32, z: -0.12, halfSpan: 1.72, chord: [1.25, 0.75], area: 3.35, incidence: -2.2, e: 0.85, slope: 0.95, clmax: 1.15, tau: 0.60 },
  fin: { xLE: -3.62, sweep: 1.05, h0: 0.28, h1: 1.78, chord: [1.55, 0.70], area: 1.73, a: 2.15, clmax: 1.2, tau: 0.66 },
  controls: { elevUp: 28, elevDown: 23, trim: 11, rudder: 17 },
  cockpit: { controls: 'yoke' },
  body: {
    stations: [[1.7, 0.6, 0.60, 0.85], [1.1, 0.6, 0.80, 1.05], [0.45, 0.7, 1.25, 1.17], [-0.3, 0.8, 1.36, 1.18], [-1.1, 0.8, 1.25, 1.12], [-2.0, 1.0, 0.80, 0.80], [-3.1, 1.2, 0.58, 0.50], [-4.4, 1.4, 0.40, 0.25]],
    munkYaw: 1.9, munkPitch: 1.5, cda: 0.275,
  },
  parts: [
    { r: [1.27, 0, 0.95], cda: 0.030 }, { r: [-0.40, -1.27, 0.95], cda: 0.035 }, { r: [-0.40, 1.27, 0.95], cda: 0.035 },
    { r: [0.0, -1.6, -0.25], cda: 0.020 }, { r: [0.0, 1.6, -0.25], cda: 0.020 },
  ],
  gear: {
    rest: 1.13, restPitch: 0.004,
    contacts: [
      { name: 'nose', r: [1.27, 0, 1.20], k: 32000, c: 3000, wheel: true, steer: 1 },
      { name: 'left', r: [-0.40, -1.27, 1.21], k: 46000, c: 4200, wheel: true, brake: 'L' },
      { name: 'right', r: [-0.40, 1.27, 1.21], k: 46000, c: 4200, wheel: true, brake: 'R' },
      { name: 'prop', r: [2.05, 0, 0.82], k: 60000, c: 6000 },
      { name: 'belly', r: [0.3, 0, 0.55], k: 60000, c: 6000 },
      { name: 'tail', r: [-5.0, 0, 0.12], k: 60000, c: 6000 },
      { name: 'tipL', r: [0.1, -5.5, -1.0], k: 60000, c: 6000 },
      { name: 'tipR', r: [0.1, 5.5, -1.0], k: 60000, c: 6000 },
      { name: 'fin', r: [-5.2, 0, -1.65], k: 60000, c: 6000 },
    ],
  },
  engine: { gross: 545, rpmMax: 2700, peak: 2450, f0: 18, f1: 32, inertia: 2.0, idleRpm: 650 },
  prop: { D: 1.93, blades: 2, pitch: 1.66, chord: 0.126, hub: [2.0, -0.05] },
  limits: { vne: 163, vno: 129, vfe: 85, vs0: 40, vs1: 48 },
  handbook: {
    source: 'Cessna 172S POH, sea level, standard day, 2550 lb',
    idleRpm: [650, 120], staticRpm: [2350, 100], staticThrust: [2600, 400],
    vs1Kcas: [53, 3], vs0Kcas: [48, 3], vmaxKtas: [126, 4], vmaxRpm: [2700, 120], bhp: [180, 8],
    climb: { kias: 74, fpm: [730, 90], rudder: [22, 18] },
    cruise: { altFt: 8000, mixture: 0.56, ktas: [120, 6], gph: [9.5, 2.0] },
    glide: { kias: 68, ratio: [9.0, 1.5] },
    takeoff: { flaps: 1 / 3, rotateKias: 50, rollFt: [960, 200], over50Ft: [1630, 350] },
    landing: { kias: 61, rollFt: [575, 250] },
    handlingKias: 100, rollRate: [55, 20], clAlpha: [5.0, 0.5], oswald: [0.80, 0.06],
  },
};
