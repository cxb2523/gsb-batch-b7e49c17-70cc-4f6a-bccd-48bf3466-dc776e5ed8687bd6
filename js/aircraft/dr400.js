// Robin DR400/180 Regent, 1100 kg.
//
// Published, and where from:
//   EASA TCDS EASA.A.367 issue 5, section Z: span 8.72 m, wing area 14.20 sq m (13.60 sq m for the
//     models without wing-root tanks), reference chord 1.71 m, length 6.96 m, height 2.23 m,
//     1100 kg, Lycoming O-360-A3A 180 hp at 2700 rpm, Sensenich 76EM8S5-0-64 (1.93 m, 64 in pitch,
//     not less than 2200 rpm static), control travels (aileron 15 up / 10 down, tailplane 9.5 up /
//     12 down, rudder +-25, flaps 15 / 60 deg), track 2.58 m, CG 0.428 to 0.564 m aft of the
//     leading edge of the rectangular centre section at 1100 kg, speeds.
//   Manuel de vol DR 400/180, edition 20 (1992): outer panels at 14 deg of dihedral, NACA 23013.5
//     modified, flaps 2.025 m span each, ailerons 1.62 m span and 0.57 sq m each, all-moving
//     tailplane 3.20 m and 2.88 sq m with an anti-balance tab of 0.26 sq m, fin 1.00 sq m and
//     rudder 0.63 sq m, wheelbase 1.65 m, propeller ground clearance 0.25 m, 190 l of fuel, and
//     every figure in `handbook` (propeller 76EM8S5-0-64).
// Estimated, and how:
//   The crank and the tip chord are not published. Measured off the dimensioned three-view in the
//     1972 manual: the crank is 2.70 m out, where the flaps end and the ailerons begin. The
//     13.60 sq m of the plain trapezoid wing then gives a tip chord of 0.92 m (0.93 on the
//     drawing); the other 0.60 sq m is the root fairings that hold the wing-root tanks, a
//     leading-edge extension inboard of 1.2 m. Tail, fin, wheel and hub stations come off the
//     same drawing; CG at the middle of the 1100 kg range. Washout of the outer panels (4 deg)
//     and incidence (3 deg) are not published: typical of the Jodel wing.
//   Inertias: Roskam's radii of gyration for single-engine propeller aircraft (Rx 0.25 of b/2,
//     Ry 0.38 of L/2, Rz 0.39 of (b+L)/4) at maximum weight.
//   Control power: thin-aerofoil flap effectiveness for the chord ratio (ailerons 22 % of the
//     local chord at the crank and 45 % at the tip on the drawing), times the plain-flap
//     correction for the deflection. The tailplane moves whole (1.0) and its tab, geared about
//     1.4 to 1 the same way, adds a quarter. Fin lift slope: Helmbold at 1.2 times the geometric
//     aspect ratio.
//   Engine friction: a mechanical efficiency of 0.88 at rated power. Propeller: the blade chord
//     of the reference's Sensenich 76EM8; its pitch is set so the published 75 % cruise (139 kt
//     at 8500 ft) turns the published 2700 rpm.
//   Section, flap increments and the fuselage drag area are tuned inside physical ranges.
// Not modelled: the ailerons' 2 deg of upward rig.
export default {
  id: 'dr400', name: 'Robin DR400-180', role: 'Four-seat tourer', power: '180 hp',
  mass: { empty: 600, max: 1100, payload: 335, fuel: 110, fuelMax: 137 },        // as loaded: 1045 kg, the maximum landing weight
  // radii of gyration taken from the Cessna 172's published inertias (0.19 / 0.30 / 0.32), not the class averages
  inertia: { Ixx: 771, Iyy: 1223, Izz: 1677 },
  wing: {
    span: 8.72, area: 14.20, x: 0.07, z: 0.42, strips: 40,
    chord: [[0, 2.02], [0.56, 2.02], [1.19, 1.71], [2.70, 1.71], [4.36, 0.92]],
    twist: [[0, 3.0], [2.70, 3.0], [4.36, -1.0]],
    // cranked: flat centre section, 14 degrees on the outer panels; the effective values carry the low-wing fuselage effect
    dihedral: [[0, 0], [2.70, 0], [2.71, 14], [4.36, 14]],
    dihedralEff: [[0, -2], [2.70, -2], [2.71, 12], [4.36, 12]],
    section: { slope: 0.97, alpha0: -1.2, clmax: [1.37, 1.32], clmin: 1.0, sep: 0.26, cd0: 0.0085, k: 0.012, clmd: 0.2, cm0: -0.012 },
    flap: { y0: 0.675, y1: 2.70, dAlpha0: 8, dClmax: 0.80, dCd: 0.10, dCm: 0.10, time: 2, detents: [0, 15, 60] },
    aileron: { y0: 2.70, y1: 4.32, tau: 0.53, up: 15, down: 10 },
  },
  htail: { xLE: -3.32, sweep: 0.0, z: 0.15, halfSpan: 1.60, chord: [0.90, 0.90], area: 2.88, incidence: 1.5, e: 0.85, slope: 0.95, clmax: 1.2, tau: 1.25 },
  fin: { xLE: -3.53, sweep: 0.52, h0: -0.30, h1: 0.87, chord: [1.20, 0.69], area: 1.63, a: 1.48, clmax: 1.2, tau: 0.59 },
  controls: { elevUp: 9.5, elevDown: 12, trim: 6, rudder: 25 },
  cockpit: { controls: 'panelstick' },
  body: {
    stations: [[1.75, 0.6, 0.70, 0.90], [1.15, 0.6, 0.90, 1.05], [0.45, 0.8, 1.25, 1.16], [-0.35, 0.8, 1.30, 1.16], [-1.15, 0.8, 1.15, 1.00], [-2.05, 1.0, 0.75, 0.70], [-3.05, 1.0, 0.50, 0.42], [-4.05, 1.0, 0.38, 0.22]],
    munkYaw: 1.7, munkPitch: 1.3, cda: 0.165,
  },
  parts: [
    { r: [1.49, 0, 0.85], cda: 0.018 }, { r: [-0.16, -1.29, 0.85], cda: 0.018 }, { r: [-0.16, 1.29, 0.85], cda: 0.018 },
  ],
  gear: {
    rest: 1.03, restPitch: 0.004,
    contacts: [
      { name: 'nose', r: [1.49, 0, 1.08], k: 24000, c: 2200, wheel: true, steer: 1 },
      { name: 'left', r: [-0.16, -1.29, 1.11], k: 56000, c: 4800, wheel: true, brake: 'L' },
      { name: 'right', r: [-0.16, 1.29, 1.11], k: 56000, c: 4800, wheel: true, brake: 'R' },
      { name: 'prop', r: [1.93, 0, 0.775], k: 60000, c: 6000 },
      { name: 'belly', r: [0.3, 0, 0.60], k: 60000, c: 6000 },
      { name: 'tail', r: [-4.6, 0, 0.40], k: 60000, c: 6000 },
      { name: 'tipL', r: [0.07, -4.36, -0.02], k: 60000, c: 6000 },
      { name: 'tipR', r: [0.07, 4.36, -0.02], k: 60000, c: 6000 },
      { name: 'fin', r: [-4.7, 0, -0.87], k: 60000, c: 6000 },
    ],
  },
  engine: { gross: 562, rpmMax: 2700, peak: 2450, f0: 30, f1: 42, inertia: 2.0, idleRpm: 600, carb: true },
  prop: { D: 1.93, blades: 2, pitch: 1.66, chord: 0.126, hub: [1.93, -0.19] },
  limits: { vne: 166, vno: 140, vfe: 92, vs0: 51, vs1: 57 },
  handbook: {
    source: 'Manuel de vol DR 400/180 ed. 20, propeller 76EM8S5-0-64, sea level, standard day, 1100 kg',
    staticRpm: [2250, 100],                           // not less than 2200 (Regent) or 2300 (Remorqueur) with this propeller
    vs1Kcas: [56.7, 3], vs0Kcas: [51.3, 3], bhp: [180, 8],
    climb: { kias: 92, fpm: [885, 106] },
    // 75 % at 8500 ft is full throttle at 2700 rpm, best power
    cruise: { altFt: 8500, mixture: 0.65, ktas: [139, 4], gph: [10.0, 2.0], rpm: [2700, 120] },
    glide: { kias: 81, ratio: [9.3, 0.75] },
    takeoff: { flaps: 0.25, rotateKias: 54, rollFt: [820, 190], over50Ft: [1690, 370] },
    landing: { kias: 68, rollFt: [820, 190] },
    handlingKias: 115,
  },
};
