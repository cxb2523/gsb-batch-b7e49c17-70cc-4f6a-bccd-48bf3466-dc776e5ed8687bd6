// Piper J-3 Cub (J3C-65). Sources:
//   SM41  Piper Service Memo 41, "General Specifications, Piper Cub Trainer, J3C-65": span 35 ft
//         2.5 in, length 22 ft 4.5 in, wing area 178.5 sq ft, aileron area 19.2 sq ft, stabiliser
//         14.65 and elevator 10.64 sq ft, fin 4.0 and rudder 6.53 sq ft, empty 680 lb, gross
//         1220 lb, fuel 12 US gal, Continental A65-8 of 65 hp, Sensenich wooden propeller of
//         72 in, USA 35B (modified) section, tread 71 in, and the performance in `handbook`.
//   TCDS  FAA A-691 (rev 34): 65 hp, engine limit 2350 rpm, static rpm 1950-2300, level-flight
//         limit 90 mph and glide limit 122 mph, centre of gravity 10.6-22.7 in aft of the wing
//         leading edge, propeller at -51 in, control travels (elevator 34 up 29 down, rudder 30,
//         ailerons 18 each way, stabiliser 2.5 up to 4 down).
//   SM5   Piper Service Memo 5, rigging of the J3 Cub Special and PA-11: the tips stand 2 3/8 in above the centre section
//         (0.65 deg of dihedral) and the outer aileron rib is washed out 3/8 in over 30 in (0.7 deg
//         nose down against the longeron).
// Estimated, not published:
//   inertia         Roskam's radii of gyration (Rx 0.25, Ry 0.38, Rz 0.39) at 1220 lb
//   chord           63 in constant (the usual figure), with the rounded tip drawn as a short taper
//   root incidence  1.6 deg, so about 2.3 deg of washout with SM5's tip setting
//   section         zero-lift angle -4.8 deg and pitching moment -0.08, typical of a flat-bottomed
//                   section of this camber; not looked up for the USA 35B itself
//   tailplane span  9 ft 6 in, from three-view proportions
//   gear stations   mains at the wing leading edge in level attitude and the tailwheel 197 in
//                   behind them, as weighed on the later PA-18 on the same fuselage; three-point
//                   attitude about 11 deg
//   rated speed     65 hp taken at 2300 rpm, the A-65's rating
//   blade chord     a wooden blade somewhat wider than the reference aircraft's metal one
//   munk            Munk's apparent-mass moment summed over the body stations, with the same
//                   factors as the reference aircraft
//   fin slope       Helmbold's finite-wing lift slope at 1.2 times the geometric aspect ratio (the
//                   end-plate allowance the reference aircraft's fin implies)
//   engine friction the reference engine's, scaled by displacement
// Tuned inside physical ranges: section clmax, cd0 and k, body cda, propeller pitch (the 72C42
// is 42 in nominal).
// The stabiliser is the trim surface on a Cub; here its travel is carried as elevator trim.
export default {
  id: 'j3', name: 'Piper J-3 Cub', role: 'Two-seat tandem taildragger', power: '65 hp',
  mass: { empty: 308.4, max: 553.4, payload: 212.3, fuel: 32.7, fuelMax: 32.7 },
  // radii of gyration taken from the Cessna 172's published inertias (0.19 / 0.30 / 0.32), not the class averages
  inertia: { Ixx: 587, Iyy: 591, Izz: 1057 },
  wing: {
    span: 10.73, area: 16.58, x: 0.05, z: -0.62, strips: 40,
    chord: [[0, 1.60], [4.8, 1.60], [5.365, 1.05]],
    twist: [[0, 1.6], [5.365, -0.7]],
    dihedral: 0.65, dihedralEff: 3.15,              // geometric, and with the high-wing fuselage effect
    section: { slope: 0.97, alpha0: -4.8, clmax: [1.65, 1.65], clmin: 0.8, sep: 0.26, cd0: 0.0095, k: 0.020, clmd: 0.5, cm0: -0.08 },
    aileron: { y0: 2.75, y1: 5.10, tau: 0.38, up: 18, down: 18 },
  },
  htail: { xLE: -3.95, sweep: 0.30, z: -0.05, halfSpan: 1.45, chord: [1.05, 0.57], area: 2.35, incidence: -0.75, e: 0.85, slope: 0.90, clmax: 1.05, tau: 0.62 },
  fin: { xLE: -4.05, sweep: 0.25, h0: 0.10, h1: 1.35, chord: [1.00, 0.56], area: 0.978, a: 2.5, clmax: 1.1, tau: 0.78 },
  controls: { elevUp: 34, elevDown: 29, trim: 5.5, rudder: 30 },
  cockpit: { controls: 'stick' },
  body: {
    stations: [[1.45, 0.5, 0.60, 0.60], [0.95, 0.5, 0.85, 0.66], [0.35, 0.7, 1.20, 0.68], [-0.35, 0.7, 1.25, 0.68], [-1.05, 0.7, 1.05, 0.64], [-1.90, 1.0, 0.75, 0.50], [-2.95, 1.1, 0.50, 0.32], [-4.10, 1.2, 0.32, 0.14]],
    munkYaw: 1.46, munkPitch: 0.50, cda: 0.60,
  },
  parts: [
    { r: [0.45, -0.90, 0.95], cda: 0.045 }, { r: [0.45, 0.90, 0.95], cda: 0.045 },
    { r: [0.0, -1.7, -0.10], cda: 0.035 }, { r: [0.0, 1.7, -0.10], cda: 0.035 },
    { r: [-4.56, 0, 0.10], cda: 0.006 },
  ],
  gear: {
    tailwheel: true, rest: 0.957, restPitch: 0.185,
    contacts: [
      { name: 'left', r: [0.45, -0.90, 1.12], k: 39000, c: 3000, wheel: true, brake: 'L' },
      { name: 'right', r: [0.45, 0.90, 1.12], k: 39000, c: 3000, wheel: true, brake: 'R' },
      { name: 'tailwheel', r: [-4.56, 0, 0.15], k: 24000, c: 1500, wheel: true, steer: -1 },
      { name: 'prop', r: [1.76, 0, 0.85], k: 60000, c: 6000 },
      { name: 'belly', r: [0.9, 0, 0.55], k: 60000, c: 6000 },
      { name: 'tipL', r: [0.0, -5.365, -0.68], k: 60000, c: 6000 },
      { name: 'tipR', r: [0.0, 5.365, -0.68], k: 60000, c: 6000 },
      { name: 'fin', r: [-4.9, 0, -1.30], k: 60000, c: 6000 },
    ],
  },
  engine: { gross: 227, rpmMax: 2300, peak: 2090, f0: 8.6, f1: 11, inertia: 0.8, idleRpm: 600 },
  prop: { D: 1.829, blades: 2, pitch: 1.16, chord: 0.128, hub: [1.74, -0.05] },
  limits: { vne: 106, vno: 78, vfe: 33, vs0: 33, vs1: 33 },      // knots CAS; no flaps, so the white arc has no length
  handbook: {
    source: 'Piper Service Memo 41 (J3C-65 general specifications) and FAA A-691, standard day, 1220 lb; Piper quotes the top speed at 3000 ft',
    staticRpm: [2125, 120],
    vs1Kcas: [33, 3], vmaxKtas: [76, 4], bhp: [65, 4],
    climb: { kias: 48, fpm: [450, 55] },
    cruise: { altFt: 3000, throttle: 0.70, mixture: 0.72, ktas: [65, 4], gph: [4.1, 0.9] },
    glide: { kias: 48, ratio: [10.0, 1.5] },
  },
};
