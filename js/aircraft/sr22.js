// Cirrus SR22 (G3, normally aspirated, 3400 lb).
//
// Published, and where from:
//   FAA TCDS A00009CH rev 25: weights, IO-550-N 310 hp at 2700 rpm, three-blade 78 in Hartzell
//     PHC-J3YF-1RF/F7694 (low pitch 14.1 deg, high 35.0 deg), control travels (aileron +-12.5,
//     elevator 25 up / 15 down, rudder +-20, flaps 16 / 32 deg), datum.
//   Cirrus SR22 POH/AFM P/N 13772-002 (G3): span 38.3 ft, area 144.9 sq ft, length 26.0 ft, height
//     8.9 ft, MAC 47.7 in with its leading edge at FS 133.1, CG 142.3 to 148.1 in at 3400 lb,
//     standard empty 2250 lb, 92 gal usable, speeds, and every figure in `handbook`.
//   SR22 maintenance manual ch. 06: dihedral 5.5 deg (G3), wheelbase 7.26 ft, track 9.1 ft, flap
//     span 8.80 ft and area 10.80 sq ft, aileron span 4.70 ft and area 4.37 sq ft, tailplane span
//     13.17 ft and area 25.75 sq ft, elevator 7.73 sq ft, fin 15.93 sq ft, rudder 5.26 sq ft,
//     propeller ground clearance 9 in.
// Estimated, and how:
//   Root and tip chord are not published: a straight taper of 0.5 returns the published area and
//     the published MAC within 1 %, and the handbook three-view measures 1.57 and 0.77 m against
//     the published span. Off the same drawing: an unswept quarter-chord line, flaps from 0.86 to
//     3.54 m, ailerons from 3.56 to 4.98 m, the tailplane 3.7 m and the propeller 2.35 m from the
//     quarter-chord, and the wheels. Twist (2 deg of washout, standing in for the cuffed outer
//     leading edge) and incidences are not published. CG at the middle of the 3400 lb range (25 % MAC).
//   Inertias: Roskam's radii of gyration for single-engine propeller aircraft (Rx 0.25 of b/2,
//     Ry 0.38 of L/2, Rz 0.39 of (b+L)/4) at maximum weight.
//   Control power: thin-aerofoil flap effectiveness for the published area ratio, times the
//     plain-flap correction for the deflection (0.8 at 12.5 deg). Fin lift slope: Helmbold at 1.2
//     times the geometric aspect ratio.
//   Propeller: the fine-pitch stop is the published 14.1 deg at the 30 in station and the travel
//     the published 20.9 deg; the blade chord gives the activity factor of the reference propeller
//     (80). Engine friction: a mechanical efficiency of 0.88 at rated power.
//   Section (clmax, cd0, k), flap increments and the fuselage drag area are tuned inside physical ranges.
// Not modelled: the castering nosewheel (it steers here), the spring-cartridge trim, CAPS.
export default {
  id: 'sr22', name: 'Cirrus SR22', role: 'Four-seat tourer', power: '310 hp',
  mass: { empty: 1021, max: 1542, payload: 291, fuel: 230, fuelMax: 250 },      // as loaded: 3400 lb, the handbook's landing weight
  // radii of gyration taken from the Cessna 172's published inertias (0.19 / 0.30 / 0.32), not the class averages
  inertia: { Ixx: 1935, Iyy: 2220, Izz: 3670 },
  wing: {
    span: 11.67, area: 13.46, x: 0.0, z: 0.30, strips: 40,
    chord: [[0, 1.54], [5.835, 0.77]],
    twist: [[0, 1.5], [5.835, -0.5]],
    dihedral: 5.5, dihedralEff: 3.5,                // geometric, less the low-wing fuselage effect
    section: { slope: 0.97, alpha0: -2.5, clmax: [1.30, 1.38], clmin: 1.0, sep: 0.26, cd0: 0.0058, k: 0.012, clmd: 0.3, cm0: -0.06 },
    flap: { y0: 0.86, y1: 3.54, dAlpha0: 14, dClmax: 1.25, dCd: 0.060, dCm: 0.20, time: 6, detents: [0, 16, 32] },
    aileron: { y0: 3.56, y1: 4.98, tau: 0.51, up: 12.5, down: 12.5 },
  },
  htail: { xLE: -3.69, sweep: 0.19, z: -0.25, halfSpan: 2.005, chord: [0.72, 0.47], area: 2.39, incidence: 0, e: 0.85, slope: 0.95, clmax: 1.15, tau: 0.53 },
  fin: { xLE: -4.00, sweep: 0.68, h0: 0.0, h1: 1.61, chord: [1.25, 0.59], area: 1.48, a: 2.69, clmax: 1.2, tau: 0.55 },
  controls: { elevUp: 25, elevDown: 15, trim: 13, rudder: 20 },
  cockpit: { controls: 'sidestick' },
  body: {
    stations: [[2.1, 0.7, 0.75, 0.95], [1.4, 0.7, 0.95, 1.15], [0.6, 0.9, 1.30, 1.36], [-0.3, 0.9, 1.35, 1.36], [-1.2, 0.9, 1.25, 1.15], [-2.2, 1.1, 0.85, 0.75], [-3.3, 1.1, 0.55, 0.45], [-4.5, 1.3, 0.40, 0.25]],
    munkYaw: 2.4, munkPitch: 1.9, cda: 0.155,
  },
  parts: [
    { r: [1.88, 0, 0.90], cda: 0.016 }, { r: [-0.33, -1.385, 0.90], cda: 0.018 }, { r: [-0.33, 1.385, 0.90], cda: 0.018 },
  ],
  gear: {
    rest: 1.10, restPitch: -0.001,
    contacts: [
      { name: 'nose', r: [1.88, 0, 1.17], k: 34000, c: 3200, wheel: true, steer: 1 },
      { name: 'left', r: [-0.33, -1.385, 1.18], k: 80000, c: 6400, wheel: true, brake: 'L' },
      { name: 'right', r: [-0.33, 1.385, 1.18], k: 80000, c: 6400, wheel: true, brake: 'R' },
      { name: 'prop', r: [2.35, 0, 0.87], k: 60000, c: 6000 },
      { name: 'belly', r: [0.3, 0, 0.62], k: 80000, c: 8000 },
      { name: 'tail', r: [-5.1, 0, 0.10], k: 80000, c: 8000 },
      { name: 'tipL', r: [0.0, -5.835, -0.26], k: 80000, c: 8000 },
      { name: 'tipR', r: [0.0, 5.835, -0.26], k: 80000, c: 8000 },
      { name: 'fin', r: [-5.2, 0, -1.61], k: 80000, c: 8000 },
    ],
  },
  engine: { gross: 953, rpmMax: 2700, peak: 2450, f0: 50, f1: 60, inertia: 3.2, idleRpm: 700 },
  prop: { D: 1.98, blades: 3, pitch: 1.16, chord: 0.129, hub: [2.35, -0.12], machDD: 0.82, governor: { min: 2000, max: 2700, range: 20.9 } },
  limits: { vne: 200, vno: 177, vfe: 104, vs0: 62, vs1: 73 },
  handbook: {
    source: 'Cirrus SR22 POH (G3, P/N 13772-002), sea level, standard day, 3400 lb',
    staticRpm: [2700, 100],
    vs1Kcas: [70, 3], vs0Kcas: [60, 3], vmaxRpm: [2700, 100], bhp: [310, 12],
    climb: { kias: 101, fpm: [1398, 168] },
    // range profile at 3400 lb: 75 % at best power, 8000 ft. Here that power is full throttle at 2700 rpm, mixture at best power
    cruise: { altFt: 8000, mixture: 0.66, ktas: [180, 4], gph: [17.8, 3.6] },
    glide: { kias: 88, ratio: [9.6, 0.77] },
    takeoff: { flaps: 0.5, rotateKias: 70, rollFt: [1028, 230], over50Ft: [1594, 350] },
    landing: { kias: 77, rollFt: [1141, 260] },
    handlingKias: 150,
  },
};
