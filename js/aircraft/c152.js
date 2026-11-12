// Cessna 152 (1980 model). Sources:
//   POH   Cessna 152 Information Manual, 1 July 1979 (D1170-13): three-view (span 33 ft 4 in
//         with conical tips, tailplane span 10 ft 0 in, track 7 ft 7 1/4 in, wheel base 58 in,
//         length 24 ft 1 in, propeller clearance 12 in), wing area 159.5 sq ft, weights,
//         usable fuel 24.5 US gal, O-235-L2C 110 bhp at 2550 rpm, McCauley 1A103/TCM6958
//         69 in propeller, static rpm 2280-2380, centre of gravity 32.65-36.5 in aft of the
//         firewall at 1670 lb, airspeed limits, and every figure in `handbook`.
//   JANE  Jane's All the World's Aircraft, Cessna 150/152 entry: NACA 2412 at the root and a
//         symmetrical tip section, dihedral 1 deg, incidence +1 deg root and 0 deg tip, chord
//         5 ft 4 in at the root and 3 ft 8.5 in at the tip, areas (ailerons 17.88, flaps 18.56,
//         tailplane 17.0, elevators 11.4, fin plus rudder about 13.7 sq ft). The dihedral, the
//         incidences and the aileron area were confirmed online; the chords and tail areas are
//         quoted from memory of that entry and agree with the three-view to a few per cent.
//   TCDS  FAA 3A19: control travels (ailerons 20 up 15 down, elevator 25 up 18 down, rudder 23,
//         flaps 30). The aileron travel was confirmed online; the elevator and rudder travels are
//         quoted from memory of the data sheet.
// Estimated, not published:
//   inertia         Roskam's radii of gyration for single-engine propeller aircraft (Rx 0.25 of
//                   the half span, Ry 0.38 of the half length, Rz 0.39 of their mean) at 1670 lb
//   wing twist      the 1 deg of geometric washout plus the 2 deg change of zero-lift angle from
//                   NACA 2412 to the symmetrical tip, carried as twist over the tapered panel
//   wing.x          quarter chord placed at the middle of the gross-weight centre of gravity range
//   tail arm        from the 24 ft 1 in overall length and the three-view proportions
//   gear stations   nose wheel 12 in ahead of the firewall and mains 46 in aft (wheel base 58 in)
//   blade chord     the reference aircraft's blade planform at the same activity factor (80)
//   munk            Munk's apparent-mass moment summed over the body stations, with the same
//                   factors as the reference aircraft
//   fin slope       Helmbold's finite-wing lift slope at 1.2 times the geometric aspect ratio (the
//                   end-plate allowance the reference aircraft's fin implies)
//   engine friction the reference engine's, scaled by displacement
// Tuned inside physical ranges: section clmax, cd0 and k, flap increments, body cda,
// propeller pitch (the nominal pitch of this propeller is 58 in at 75 % radius).
export default {
  id: 'c152', name: 'Cessna 152', role: 'Two-seat trainer', power: '110 hp',
  mass: { empty: 503, max: 757.5, payload: 187.5, fuel: 67, fuelMax: 67 },
  // radii of gyration taken from the Cessna 172's published inertias (0.19 / 0.30 / 0.32), not the class averages
  inertia: { Ixx: 721, Iyy: 937, Izz: 1438 },
  wing: {
    span: 10.16, area: 14.82, x: 0.0, z: -0.72, strips: 40,
    chord: [[0, 1.63], [2.3, 1.63], [5.08, 1.13]],
    twist: [[0, 1.0], [2.3, 0.55], [5.08, -2.0]],
    dihedral: 1.0, dihedralEff: 3.5,
    section: { slope: 0.97, alpha0: -2.6, clmax: [1.42, 1.34], clmin: 1.0, sep: 0.26, cd0: 0.0080, k: 0.019, clmd: 0.3, cm0: -0.045 },
    flap: { y0: 0.55, y1: 2.3, dAlpha0: 13.5, dClmax: 1.05, dCd: 0.070, dCm: 0.19, time: 7, detents: [0, 10, 20, 30] },
    aileron: { y0: 2.32, y1: 4.8, tau: 0.36, up: 20, down: 15 },
  },
  htail: { xLE: -3.80, sweep: 0.25, z: -0.10, halfSpan: 1.525, chord: [1.07, 0.66], area: 2.64, incidence: -2.0, e: 0.85, slope: 0.95, clmax: 1.15, tau: 0.60 },
  fin: { xLE: -3.40, sweep: 0.95, h0: 0.25, h1: 1.60, chord: [1.25, 0.55], area: 1.27, a: 2.33, clmax: 1.2, tau: 0.66 },
  controls: { elevUp: 25, elevDown: 18, trim: 10, rudder: 23 },
  cockpit: { controls: 'yoke' },
  body: {
    stations: [[1.55, 0.5, 0.58, 0.80], [1.05, 0.5, 0.75, 0.95], [0.45, 0.7, 1.15, 1.02], [-0.25, 0.7, 1.25, 1.02], [-0.95, 0.7, 1.15, 0.98], [-1.75, 0.9, 0.75, 0.72], [-2.75, 1.1, 0.52, 0.45], [-3.95, 1.3, 0.36, 0.22]],
    munkYaw: 1.46, munkPitch: 1.05, cda: 0.26,
  },
  parts: [
    { r: [1.18, 0, 0.90], cda: 0.024 }, { r: [-0.29, -1.16, 0.90], cda: 0.028 }, { r: [-0.29, 1.16, 0.90], cda: 0.028 },
    { r: [0.0, -1.5, -0.20], cda: 0.018 }, { r: [0.0, 1.5, -0.20], cda: 0.018 },
  ],
  gear: {
    rest: 1.06, restPitch: -0.001,
    contacts: [
      { name: 'nose', r: [1.18, 0, 1.13], k: 21000, c: 2000, wheel: true, steer: 1 },
      { name: 'left', r: [-0.29, -1.16, 1.14], k: 38000, c: 3200, wheel: true, brake: 'L' },
      { name: 'right', r: [-0.29, 1.16, 1.14], k: 38000, c: 3200, wheel: true, brake: 'R' },
      { name: 'prop', r: [1.85, 0, 0.78], k: 60000, c: 6000 },
      { name: 'belly', r: [0.3, 0, 0.52], k: 60000, c: 6000 },
      { name: 'tail', r: [-4.6, 0, 0.10], k: 60000, c: 6000 },
      { name: 'tipL', r: [0.0, -5.08, -0.82], k: 60000, c: 6000 },
      { name: 'tipR', r: [0.0, 5.08, -0.82], k: 60000, c: 6000 },
      { name: 'fin', r: [-4.8, 0, -1.50], k: 60000, c: 6000 },
    ],
  },
  engine: { gross: 349, rpmMax: 2550, peak: 2315, f0: 11.7, f1: 20.7, inertia: 1.3, idleRpm: 650 },
  prop: { D: 1.753, blades: 2, pitch: 1.55, chord: 0.1145, hub: [1.82, -0.08] },
  limits: { vne: 149, vno: 111, vfe: 85, vs0: 35, vs1: 40 },
  handbook: {
    source: 'Cessna 152 Information Manual (1980 model), sea level, standard day, 1670 lb, speed fairings',
    staticRpm: [2330, 100],
    vs1Kcas: [48, 3], vs0Kcas: [43, 3], vmaxKtas: [110, 4], vmaxRpm: [2550, 120], bhp: [110, 6],
    climb: { kias: 67, fpm: [715, 85] },
    cruise: { altFt: 8000, mixture: 0.56, ktas: [107, 4], gph: [6.1, 1.2], rpm: [2550, 120] },
    glide: { kias: 60, ratio: [9.5, 1.5] },
    takeoff: { flaps: 1 / 3, rotateKias: 50, rollFt: [725, 160], over50Ft: [1340, 300] },
    landing: { kias: 54, rollFt: [475, 115] },
  },
};
