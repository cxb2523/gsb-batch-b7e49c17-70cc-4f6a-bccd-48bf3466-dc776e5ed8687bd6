// Cessna 182T Skylane. Sources:
//   POH   Cessna 182T NAV III Pilot's Operating Handbook (182TPHAUS): three-view (span 36 ft
//         0 in, tailplane span 11 ft 8 in, track 9 ft 0 in, wheel base 66 1/2 in, length 29 ft
//         0 in, propeller clearance 10 7/8 in), wing area 174 sq ft, weights (3100 lb takeoff,
//         2950 lb landing, standard empty 1924 lb), usable fuel 87 US gal, IO-540-AB1A5 230 bhp
//         at 2400 rpm, McCauley B3D36C431/80VSA-1 three-blade constant-speed propeller of 79 in,
//         blade angle 14.9 to 31.7 deg at the 30 in station, static run-up 2350-2400 rpm, mean
//         aerodynamic chord 58.80 in with its leading edge 25.98 in aft of the firewall, centre
//         of gravity 40.9-46.0 in at 3100 lb, airspeed limits, and every figure in `handbook`.
//   JANE  Jane's All the World's Aircraft, Cessna 182 entry: NACA 2412 (modified), dihedral
//         1 deg 44 min, incidence +0 deg 47 min at the root and -2 deg 50 min at the tip, chord
//         5 ft 4 in at the root and 3 ft 7 in at the tip, fin plus rudder 18.6 sq ft. Quoted from
//         memory of that entry; only the section was confirmed online.
//   TCDS  FAA 3A13: ailerons 20 up 15 down, elevator 28 up; full flap 38 deg (as reported from
//         the data sheet; the handbook only says FULL).
// Estimated, not published:
//   inertia         Roskam's radii of gyration (Rx 0.25, Ry 0.38, Rz 0.39) at 3100 lb
//   tailplane area  span 11 ft 8 in times the mean chord scaled from the three-view
//   elevator down, rudder travel   21 and 24 deg, as on earlier 182s
//   tail arm        from the 29 ft overall length and the three-view
//   gear stations   mains 58 in aft of the firewall, nose wheel 66.5 in ahead of them
//   governor low limit   1800 rpm (the tachometer's green arc starts at 2000)
//   blade chord     tuned (a three-blade 79 in McCauley is about 0.14 m at its widest)
//   munk            Munk's apparent-mass moment summed over the body stations, with the same
//                   factors as the reference aircraft
//   engine friction the reference engine's, scaled by displacement
// Tuned inside physical ranges: section clmax (high: this wing has the drooped "camber-lift"
// leading edge), cd0 and k, flap increments, body cda, blade chord.
export default {
  id: 'c182t', name: 'Cessna 182T Skylane', role: 'Four-seat tourer', power: '230 hp',
  mass: { empty: 873, max: 1406, payload: 315, fuel: 150, fuelMax: 237 },      // as loaded: 2950 lb, the landing weight
  // radii of gyration taken from the Cessna 172's published inertias (0.19 / 0.30 / 0.32), not the class averages
  inertia: { Ixx: 1559, Iyy: 2522, Izz: 3422 },
  wing: {
    span: 10.97, area: 16.17, x: 0.07, z: -0.90, strips: 40,
    chord: [[0, 1.63], [2.6, 1.63], [5.485, 1.09]],
    twist: [[0, 0.78], [5.485, -2.83]],
    dihedral: 1.73, dihedralEff: 4.2,               // geometric, and with the high-wing fuselage effect
    section: { slope: 0.97, alpha0: -2.6, clmax: [1.68, 1.70], clmin: 1.0, sep: 0.26, cd0: 0.0072, k: 0.017, clmd: 0.3, cm0: -0.045 },
    flap: { y0: 0.62, y1: 2.6, dAlpha0: 15.5, dClmax: 1.15, dCd: 0.085, dCm: 0.21, time: 8, detents: [0, 10, 20, 38] },
    aileron: { y0: 2.62, y1: 5.0, tau: 0.36, up: 20, down: 15 },
  },
  htail: { xLE: -4.35, sweep: 0.32, z: -0.12, halfSpan: 1.778, chord: [1.30, 0.73], area: 3.60, incidence: -2.2, e: 0.85, slope: 0.95, clmax: 1.15, tau: 0.60 },
  fin: { xLE: -3.85, sweep: 1.05, h0: 0.28, h1: 1.78, chord: [1.55, 0.70], area: 1.73, a: 2.15, clmax: 1.2, tau: 0.66 },
  controls: { elevUp: 28, elevDown: 21, trim: 11, rudder: 24 },
  cockpit: { controls: 'yoke' },
  body: {
    stations: [[1.95, 0.7, 0.66, 0.90], [1.25, 0.7, 0.88, 1.08], [0.50, 0.8, 1.30, 1.20], [-0.30, 0.8, 1.40, 1.20], [-1.15, 0.9, 1.28, 1.14], [-2.10, 1.0, 0.82, 0.82], [-3.25, 1.3, 0.58, 0.50], [-4.60, 1.4, 0.40, 0.25]],
    munkYaw: 2.19, munkPitch: 1.71, cda: 0.18,
  },
  parts: [
    { r: [1.32, 0, 1.00], cda: 0.022 }, { r: [-0.37, -1.37, 1.00], cda: 0.026 }, { r: [-0.37, 1.37, 1.00], cda: 0.026 },
    { r: [0.0, -1.6, -0.28], cda: 0.020 }, { r: [0.0, 1.6, -0.28], cda: 0.020 },
  ],
  gear: {
    rest: 1.20, restPitch: 0.005,
    contacts: [
      { name: 'nose', r: [1.32, 0, 1.27], k: 44000, c: 4200, wheel: true, steer: 1 },
      { name: 'left', r: [-0.37, -1.37, 1.28], k: 62000, c: 5600, wheel: true, brake: 'L' },
      { name: 'right', r: [-0.37, 1.37, 1.28], k: 62000, c: 5600, wheel: true, brake: 'R' },
      { name: 'prop', r: [2.32, 0, 0.92], k: 60000, c: 6000 },
      { name: 'belly', r: [0.3, 0, 0.58], k: 60000, c: 6000 },
      { name: 'tail', r: [-5.3, 0, 0.12], k: 60000, c: 6000 },
      { name: 'tipL', r: [0.1, -5.485, -1.05], k: 60000, c: 6000 },
      { name: 'tipR', r: [0.1, 5.485, -1.05], k: 60000, c: 6000 },
      { name: 'fin', r: [-5.5, 0, -1.65], k: 60000, c: 6000 },
    ],
  },
  engine: { gross: 768, rpmMax: 2400, peak: 2200, f0: 27, f1: 38, inertia: 3.6, idleRpm: 650 },
  prop: { D: 2.007, blades: 3, pitch: 1.23, chord: 0.14, hub: [2.30, -0.08], governor: { min: 1800, max: 2400, range: 16.8 } },
  limits: { vne: 175, vno: 140, vfe: 100, vs0: 41, vs1: 51 },
  handbook: {
    source: 'Cessna 182T NAV III POH, sea level, standard day, 3100 lb (landing at 2950 lb), wheel fairings',
    staticRpm: [2375, 100],
    vs1Kcas: [54, 3], vs0Kcas: [49, 3], vmaxKtas: [150, 4], vmaxRpm: [2400, 100], bhp: [230, 10],
    climb: { kias: 80, fpm: [924, 110] },
    cruise: { altFt: 8000, throttle: 0.86, mixture: 0.56, prop: 1, ktas: [139, 4], gph: [12.5, 2.5], rpm: [2400, 100] },   // 21 in Hg and 2400 rpm: 72 %
    glide: { kias: 76, ratio: [8.8, 1.5] },
    takeoff: { flaps: 20 / 38, rotateKias: 49, rollFt: [795, 175], over50Ft: [1514, 330] },
    landing: { kias: 60, rollFt: [590, 130] },
  },
};
