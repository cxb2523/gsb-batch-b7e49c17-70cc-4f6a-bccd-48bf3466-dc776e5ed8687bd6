// Extra 300L (EA 300/L), 950 kg.
//
// Published, and where from:
//   EASA TCDS EASA.A.362 issue 9, section C: span 8.00 m, wing area 10.84 sq m, length 6.96 m,
//     height 2.62 m, masses (950 kg normal, 870 / 820 kg aerobatic), Lycoming AEIO-540-L1B5
//     300 hp at 2700 rpm, MT MTV-9-B-C/C200-15 three-blade 2.00 m constant-speed propeller,
//     control travels (aileron +-30, elevator +-25, rudder +-30), 171 l of fuel, datum at the firewall.
//   Extra 300L Pilot's Operating Handbook (EA-06701): root chord 1.85 m, tip 0.88 m, MAC 1.404 m,
//     MA 15 S / MA 12 S symmetric sections, aileron area 2 x 0.855 sq m with the hinge at 25 % of
//     the aileron chord, tailplane 3.20 m and 2.56 sq m, elevator 0.77 sq m, fin 1.39 sq m, rudder
//     0.51 sq m, track 1.80 m, weighing arms (main wheels 0.33 m and tailwheel 5.23 m aft of the
//     firewall), CG 0.671 to 0.841 m aft of the firewall, 270 hp at 2400 rpm, and every figure in
//     `handbook`. Its calibration chart shows indicated and calibrated airspeed equal below 100 kt.
// Estimated, and how:
//   Twist, incidence and dihedral are not published: taken as zero (the front view in the handbook
//     shows a flat wing). Measured off the handbook three-view against the published length: the
//     aileron runs from 1.01 m to the tip, the quarter-chord line is unswept and 0.74 m aft of
//     the firewall (the middle of the CG range sits 14 mm behind it), and the tail and hub
//     stations. Gear leg lengths follow from the published height (the top of the propeller
//     disc, tail down) and the weighing arms; they give a ground attitude of 11.3 deg.
//   Inertias: Roskam's radii of gyration for single-engine propeller aircraft (Rx 0.25 of b/2,
//     Ry 0.38 of L/2, Rz 0.39 of (b+L)/4) at 950 kg.
//   Control power: thin-aerofoil flap effectiveness for the chord behind the hinge (aileron: the
//     published area over the measured span, 15 % of the local chord at the root end and 23 % at
//     the tip, 0.53 weighted by roll moment), times the plain-flap correction for the deflection
//     (0.55 at 30 deg for the ailerons, 0.8 for the tail). Nothing here is fitted to the roll rate.
//     Fin lift slope: Helmbold at 1.2 times the geometric aspect ratio.
//   Propeller: the pitch stops are not published (13 deg fine at three-quarter radius and 22 deg
//     of travel assumed); the blade chord gives the activity factor of the reference propeller
//     (80). Engine friction: a mechanical efficiency of 0.88 at rated power.
//   Section (clmax, cd0, k) and the fuselage drag area are tuned inside physical ranges.
// Not modelled: the spades, the inverted fuel and oil systems.
export default {
  id: 'extra300', name: 'Extra 300L', role: 'Two-seat aerobatic', power: '300 hp',
  mass: { empty: 660, max: 950, payload: 100, fuel: 60, fuelMax: 119 },          // as loaded: 820 kg, the single-seat aerobatic weight
  inertia: { Ixx: 950, Iyy: 1661, Izz: 2021 },
  wing: {
    span: 8.0, area: 10.84, x: 0.014, z: 0.28, strips: 40,
    chord: [[0, 1.85], [4.0, 0.88]],
    twist: [[0, 0], [4.0, 0]],
    dihedral: 0, dihedralEff: -2,                   // flat wing, less the low-wing fuselage effect
    section: { slope: 0.97, alpha0: 0, clmax: [1.38, 1.34], clmin: 1.36, sep: 0.26, cd0: 0.0075, k: 0.010, clmd: 0, cm0: 0 },
    aileron: { y0: 1.01, y1: 4.0, tau: 0.29, up: 30, down: 30 },
  },
  htail: { xLE: -3.33, sweep: 0.27, z: -0.30, halfSpan: 1.60, chord: [0.92, 0.68], area: 2.56, incidence: 0, e: 0.85, slope: 0.95, clmax: 1.15, tau: 0.53 },
  fin: { xLE: -3.55, sweep: 0.35, h0: -0.28, h1: 1.05, chord: [1.20, 0.55], area: 1.39, a: 2.13, clmax: 1.2, tau: 0.58 },
  controls: { elevUp: 25, elevDown: 25, trim: 4, rudder: 30 },
  cockpit: { controls: 'stick' },
  body: {
    stations: [[1.7, 0.6, 0.80, 0.85], [1.1, 0.6, 0.95, 0.90], [0.4, 0.8, 1.05, 0.88], [-0.4, 0.8, 1.15, 0.85], [-1.2, 0.8, 1.10, 0.75], [-2.1, 1.0, 0.75, 0.55], [-3.1, 1.0, 0.50, 0.35], [-4.1, 1.0, 0.35, 0.18]],
    munkYaw: 1.3, munkPitch: 1.0, cda: 0.175,
  },
  parts: [
    { r: [0.43, -0.90, 1.20], cda: 0.022 }, { r: [0.43, 0.90, 1.20], cda: 0.022 }, { r: [-4.47, 0, 0.35], cda: 0.006 },
  ],
  gear: {
    tailwheel: true, rest: 1.27, restPitch: 0.197,
    contacts: [
      { name: 'tailwheel', r: [-4.47, 0, 0.44], k: 28000, c: 900, wheel: true, steer: -1 },
      { name: 'left', r: [0.43, -0.90, 1.44], k: 60000, c: 4600, wheel: true, brake: 'L' },
      { name: 'right', r: [0.43, 0.90, 1.44], k: 60000, c: 4600, wheel: true, brake: 'R' },
      { name: 'prop', r: [1.87, 0, 1.0], k: 60000, c: 6000 },
      { name: 'belly', r: [0.3, 0, 0.55], k: 60000, c: 6000 },
      { name: 'tipL', r: [0.0, -4.0, 0.28], k: 60000, c: 6000 },
      { name: 'tipR', r: [0.0, 4.0, 0.28], k: 60000, c: 6000 },
      { name: 'fin', r: [-4.5, 0, -1.05], k: 60000, c: 6000 },
    ],
  },
  engine: { gross: 924, rpmMax: 2700, peak: 2450, f0: 49, f1: 59, inertia: 2.6, idleRpm: 750 },
  prop: { D: 2.00, blades: 3, pitch: 1.05, chord: 0.130, hub: [1.87, 0.0], governor: { min: 1800, max: 2700, range: 22 } },
  limits: { vne: 220, vno: 158, vs0: 60, vs1: 60 },
  handbook: {
    source: 'Extra 300L POH (EA-06701), sea level, standard day, 950 kg',
    vs1Kcas: [60, 3], vmaxRpm: [2700, 100], bhp: [300, 12],
    climb: { kias: 104, fpm: [2100, 250] },           // read from the handbook's climb chart, fig. 5.6
    // 75 % (225 hp) at 4000 ft: 2400 rpm, 24.6 in Hg, best power. The throttle is the one that gives 225 hp here (23.9 in Hg)
    cruise: { altFt: 4000, throttle: 0.82, prop: 0.667, mixture: 0.75, ktas: [170.9, 4], gph: [18.2, 3.6], rpm: [2400, 100] },
    glide: { kias: 90, ratio: [6.2, 0.5] },
    takeoff: { rotateKias: 65, pitch: 17, rollFt: [377, 85], over50Ft: [813, 180] },    // 17 deg is the attitude of the 93 kt best-angle climb
    // the runner lands at the default load, which is the 820 kg aerobatic weight: the handbook's 820 kg column, power off
    landing: { kias: 72, throttle: 0, approachPitch: 4.8, holdAttitude: true, rollFt: [512, 115] },
    handlingKias: 145, rollRate: [370, 30],           // quoted between 340 and 400 deg/s, no speed given; 145 kt is what the runner's power setting holds
  },
};
