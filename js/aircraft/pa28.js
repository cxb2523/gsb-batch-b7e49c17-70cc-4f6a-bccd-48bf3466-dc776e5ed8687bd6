// Piper PA-28-181 Archer II. Sources:
//   SPEC  Piper Aircraft "Archer II PA 28-181" specification sheet: span 35.0 ft, wing area
//         170 sq ft, length 23.8 ft, wheel base 6.58 ft, tread 10 ft, weights (gross 2550 lb,
//         standard empty 1413 lb), usable fuel 48 US gal, O-360-A4M 180 hp at 2700 rpm,
//         Sensenich 76 in fixed-pitch propeller, and the speeds, climb and distances in `handbook`.
//   POH   Cherokee Archer II Pilot's Operating Handbook, report VB-790: three-view (root chord
//         5 ft 3 in, tip chord 3 ft 6.2 in, stabilator span 12 ft 10.46 in and chord 2 ft 6 in),
//         propeller 76EM8S5-0-62, best rate of climb 76 KIAS, approach 66 KIAS with 40 deg of
//         flap, 25 deg flap takeoff speeds (lift off 49, 54 KIAS at 50 ft), glide range chart
//         (figure 5-31, 76 KIAS: 11 nm for 6500 ft in its worked example).
//   TCDS  FAA 2A13 (rev 48): control travels (flaps 40, ailerons 25 up 12.5 down, rudder 27,
//         stabilator 14 up 2 down, tab 3 up 12 down), static rpm 2240-2340 (the POH prints
//         2275-2375 for the same propeller), centre of gravity 88.6-93.0 in at 2550 lb with the
//         datum 78.4 in ahead of the wing leading edge, airspeed limits.
//   JANE  Jane's All the World's Aircraft, PA-28-161/181 entry: NACA 65(2)-415 section,
//         dihedral 7 deg, incidence 2 deg at the root with 3 deg of washout over the tapered
//         panel, fin plus rudder about 11.6 sq ft. The section was confirmed online; the angles
//         and the fin area are quoted from memory of that entry.
// Estimated, not published:
//   inertia         Roskam's radii of gyration (Rx 0.25, Ry 0.38, Rz 0.39) at 2550 lb
//   stabilator area span times chord from the POH three-view
//   wing.x          mean quarter chord (root panel at 25 % of 63 in, tapered panel swept back a
//                   little) against the middle of the gross-weight centre of gravity range
//   tail arm        from the 23.8 ft overall length and the three-view
//   gear stations   Piper's weighing stations: nose wheel 31.0 in, mains 109.7 in
//   blade chord     the reference aircraft's blade planform at the same activity factor (80)
//   munk            Munk's apparent-mass moment summed over the body stations, with the same
//                   factors as the reference aircraft
//   fin slope       Helmbold's finite-wing lift slope at 1.2 times the geometric aspect ratio (the
//                   end-plate allowance the reference aircraft's fin implies)
// Tuned inside physical ranges: section clmax, cd0 and k, flap increments, dihedralEff, body
// cda, propeller pitch (nominal 62 in at 75 % radius).
// Not represented by the flight model: the stabilator's anti-servo tab (it adds camber as the
// surface moves, and is how the real aircraft is trimmed).
export default {
  id: 'pa28', name: 'Piper PA-28-181 Archer', role: 'Four-seat tourer', power: '180 hp',
  mass: { empty: 641, max: 1157, payload: 385, fuel: 131, fuelMax: 131 },
  // radii of gyration taken from the Cessna 172's published inertias (0.19 / 0.30 / 0.32), not the class averages
  inertia: { Ixx: 1214, Iyy: 1396, Izz: 2304 },
  wing: {
    span: 10.67, area: 15.79, x: -0.11, z: 0.33, strips: 40,
    chord: [[0, 1.60], [2.6, 1.60], [5.335, 1.072]],
    twist: [[0, 2.0], [2.6, 2.0], [5.335, -1.0]],
    dihedral: 7.0, dihedralEff: 5.0,                // geometric, and less the low-wing fuselage effect
    section: { slope: 0.97, alpha0: -2.6, clmax: [1.32, 1.32], clmin: 0.9, sep: 0.26, cd0: 0.0070, k: 0.013, clmd: 0.4, cm0: -0.07 },
    flap: { y0: 0.60, y1: 2.6, dAlpha0: 14.5, dClmax: 1.00, dCd: 0.080, dCm: 0.18, time: 3, detents: [0, 10, 25, 40] },
    aileron: { y0: 2.62, y1: 4.95, tau: 0.36, up: 25, down: 12.5 },
  },
  htail: { xLE: -4.04, sweep: 0, z: -0.20, halfSpan: 1.96, chord: [0.762, 0.762], area: 2.99, incidence: 0, e: 0.85, slope: 0.95, clmax: 1.15, tau: 1 },
  fin: { xLE: -3.80, sweep: 0.75, h0: 0.30, h1: 1.55, chord: [1.15, 0.55], area: 1.08, a: 2.35, clmax: 1.2, tau: 0.62 },
  controls: { elevUp: 14, elevDown: 2, trim: 5, rudder: 27 },
  cockpit: { controls: 'yoke' },
  body: {
    stations: [[1.75, 0.6, 0.62, 0.90], [1.15, 0.6, 0.85, 1.05], [0.45, 0.8, 1.12, 1.12], [-0.35, 0.8, 1.18, 1.12], [-1.15, 0.8, 1.08, 1.05], [-2.05, 1.0, 0.78, 0.75], [-3.05, 1.0, 0.55, 0.48], [-4.15, 1.2, 0.38, 0.25]],
    munkYaw: 1.60, munkPitch: 1.41, cda: 0.288,
  },
  parts: [
    { r: [1.52, 0, 0.75], cda: 0.024 }, { r: [-0.48, -1.524, 0.75], cda: 0.028 }, { r: [-0.48, 1.524, 0.75], cda: 0.028 },
  ],
  gear: {
    rest: 0.946, restPitch: -0.0015,
    contacts: [
      { name: 'nose', r: [1.52, 0, 1.02], k: 36000, c: 3200, wheel: true, steer: 1 },
      { name: 'left', r: [-0.48, -1.524, 1.03], k: 52000, c: 4600, wheel: true, brake: 'L' },
      { name: 'right', r: [-0.48, 1.524, 1.03], k: 52000, c: 4600, wheel: true, brake: 'R' },
      { name: 'prop', r: [2.08, 0, 0.76], k: 60000, c: 6000 },
      { name: 'belly', r: [0.3, 0, 0.58], k: 60000, c: 6000 },
      { name: 'tail', r: [-4.9, 0, 0.05], k: 60000, c: 6000 },
      { name: 'tipL', r: [-0.2, -5.335, -0.32], k: 60000, c: 6000 },
      { name: 'tipR', r: [-0.2, 5.335, -0.32], k: 60000, c: 6000 },
      { name: 'fin', r: [-4.9, 0, -1.55], k: 60000, c: 6000 },
    ],
  },
  engine: { gross: 545, rpmMax: 2700, peak: 2450, f0: 18, f1: 32, inertia: 2.0, idleRpm: 650 },
  prop: { D: 1.93, blades: 2, pitch: 1.70, chord: 0.126, hub: [2.05, -0.20] },
  limits: { vne: 154, vno: 125, vfe: 102, vs0: 49, vs1: 55 },
  handbook: {
    source: 'Piper Archer II specification sheet and POH VB-790, sea level, standard day, 2550 lb, wheel fairings',
    staticRpm: [2300, 100],
    vs1Kcas: [59, 3], vs0Kcas: [53, 3], vmaxKtas: [129, 4], vmaxRpm: [2700, 120], bhp: [180, 8],
    climb: { kias: 76, fpm: [735, 90] },
    cruise: { altFt: 8000, mixture: 0.62, ktas: [129, 4], gph: [10.5, 2.0] },
    glide: { kias: 76, ratio: [10.0, 1.5] },
    takeoff: { flaps: 0.625, rotateKias: 49, rollFt: [870, 190], over50Ft: [1625, 360] },
    landing: { kias: 66, rollFt: [925, 205] },
  },
};
