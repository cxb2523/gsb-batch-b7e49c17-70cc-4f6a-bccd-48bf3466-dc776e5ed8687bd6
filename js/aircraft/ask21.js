// Schleicher ASK 21, two-seat glider, 600 kg.
//
// Published, and where from:
//   EASA TCDS EASA.A.221 issue 6: span 17.00 m, wing area 17.95 sq m, maximum mass 600 kg, maximum
//     mass of the non-lifting parts 410 kg, CG 234 to 469 mm aft of the wing leading edge at the
//     root rib, speeds.
//   ASK 21 maintenance manual (technical data): root chord 1.50 m, tip 0.50 m, Wortmann FX S 02-196
//     and FX 60-126 sections, dihedral 4 deg, root incidence +2 deg, ailerons 2.80 m span with
//     0.24 to 0.16 m chord, travel 110 mm up and 45 mm down at 240 mm (26.5 / 10.8 deg),
//     Schempp-Hirth airbrakes on the upper surface 1.35 m long and 0.13 m high, tailplane 3.1 m
//     and 1.92 sq m rigged at 0 deg, elevator 30 % chord with 22.5 deg up and 16.3 deg down, fin
//     1.37 m high and 1.357 sq m with 0.80 / 1.17 m chords, rudder 33 % chord and +-28 deg.
//   ASK 21 flight manual (April 1980): length 8.35 m, MAC 1.121 m with its leading edge 8 mm aft of
//     the datum, empty mass about 360 kg, stall at 600 kg 74 km/h with the airbrakes closed and
//     77 km/h with them out, approach 90 km/h, and a 45 deg dive with the airbrakes out settling
//     at 232 km/h. Best glide 34 at 90 km/h: Schleicher and Jane's 1988-89.
// Estimated, and how:
//   Measured off the three-view in the ASK 21 Mi flight manual (the same airframe) against the
//     published span and length: the ailerons run from 5.2 to 8.0 m, the airbrakes from 2.78 to
//     4.13 m, the leading edge is straight, and the tailplane, fin and three wheels stand where
//     they are put here. The chord at the aileron root (1.00 m; 0.98 on the drawing) is the one
//     that makes the two tapers return the published area. Twist is not published: 2 deg of
//     washout, to stand for the change of section along the span as well.
//   Airbrakes: the drag is the value that holds the published 45 deg dive at 232 km/h (the model
//     settles at 231). The lift loss, 5.3 deg over the spoiled strips, is sized from the published
//     3 km/h rise in stall speed; the model applies it as a shift of the zero-lift angle, which
//     costs lift on the approach but hardly moves the stall itself.
//   Inertias: radii of gyration for a two-seat glider, Rx 0.22 of b/2 (two 95 kg wing panels,
//     600 kg less the 410 kg of non-lifting parts, each with a radius of gyration of 0.38 of the
//     semi-span), Ry 0.38 of L/2 and Rz 0.39 of (b+L)/4 as for Roskam's light singles.
//   Control power: thin-aerofoil flap effectiveness for the published chord ratios, times the
//     plain-flap correction for the deflection. Fin lift slope: Helmbold at 1.5 times the
//     geometric aspect ratio (1.383), the tailplane on top acting as an end plate.
//   Section values and the fuselage drag area are tuned inside physical ranges.
// Not modelled: winch and aerotow launch, the slight forward sweep, the wheel brake being worked
//   by the last of the airbrake lever's travel.
export default {
  id: 'ask21', name: 'Schleicher ASK 21', role: 'Two-seat glider', power: '',
  mass: { empty: 360, max: 600, payload: 170, fuel: 0, fuelMax: 0 },
  inertia: { Ixx: 2098, Iyy: 1510, Izz: 3665 },
  wing: {
    span: 17.0, area: 17.95, x: 0.06, z: -0.15, strips: 40,
    chord: [[0, 1.50], [5.2, 1.00], [8.5, 0.50]],
    twist: [[0, 2.0], [8.5, 0.0]],
    dihedral: 4, dihedralEff: 4,                    // mid wing: no fuselage effect either way
    section: { slope: 1.0, alpha0: -3.5, clmax: [1.40, 1.36], clmin: 0.8, sep: 0.26, cd0: 0.0065, k: 0.005, clmd: 0.6, cm0: -0.10 },
    aileron: { y0: 5.2, y1: 8.0, tau: 0.42, up: 26.5, down: 10.8 },
    spoiler: { y0: 2.78, y1: 4.13, dAlpha0: 5.3, dCd: 0.46, dClmax: 0.6 },
  },
  htail: { xLE: -4.63, sweep: 0.12, z: -1.40, halfSpan: 1.55, chord: [0.72, 0.52], area: 1.92, incidence: 0, e: 0.85, slope: 0.95, clmax: 1.15, tau: 0.53 },
  fin: { xLE: -4.23, sweep: 0.30, h0: 0.03, h1: 1.40, chord: [1.17, 0.80], area: 1.357, a: 2.66, clmax: 1.2, tau: 0.55 },
  controls: { elevUp: 22.5, elevDown: 16.3, trim: 10, rudder: 28 },
  cockpit: { controls: 'stick' },
  body: {
    stations: [[2.55, 0.8, 0.55, 0.50], [1.75, 0.8, 0.95, 0.72], [0.95, 0.8, 1.10, 0.76], [0.15, 0.8, 1.05, 0.72], [-0.65, 0.8, 0.75, 0.55], [-1.75, 1.4, 0.40, 0.32], [-3.15, 1.4, 0.30, 0.24], [-4.55, 1.4, 0.28, 0.18]],
    munkYaw: 0.65, munkPitch: 0.55, cda: 0.035,
  },
  parts: [
    { r: [-0.27, 0, 0.50], cda: 0.008 }, { r: [2.00, 0, 0.45], cda: 0.004 },
  ],
  gear: {
    rest: 0.61, restPitch: -0.027,
    contacts: [
      { name: 'nose', r: [2.00, 0, 0.57], k: 60000, c: 2500, wheel: true },
      { name: 'main', r: [-0.27, 0, 0.67], k: 90000, c: 6300, wheel: true, brake: 'L' },
      { name: 'tailwheel', r: [-4.90, 0, 0.35], k: 40000, c: 2000, wheel: true },
      { name: 'tipL', r: [0.0, -8.5, -0.64], k: 30000, c: 3000 },
      { name: 'tipR', r: [0.0, 8.5, -0.64], k: 30000, c: 3000 },
      { name: 'belly', r: [1.0, 0, 0.47], k: 60000, c: 6000 },
      { name: 'fin', r: [-5.3, 0, -1.45], k: 60000, c: 6000 },
    ],
  },
  engine: null,
  prop: null,
  limits: { vne: 151, vno: 97, vs0: 40, vs1: 40 },
  handbook: {
    source: 'ASK 21 flight manual, Schleicher and Jane\'s, sea level, standard day, 600 kg',
    vs1Kcas: [40, 3],                                 // 74 km/h indicated; no calibration is published
    glide: { kias: 49, ratio: [34, 2.7] },
    landing: { kias: 49, flarePitch: 3.5 },           // 90 km/h approach; main wheel and tailwheel together at 3.9 deg; no landing roll is published
  },
};
