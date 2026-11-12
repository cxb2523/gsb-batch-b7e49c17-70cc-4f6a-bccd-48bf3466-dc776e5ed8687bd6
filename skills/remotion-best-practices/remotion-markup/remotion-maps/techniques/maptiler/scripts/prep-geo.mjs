// Geo prep for the map-explainer. Bakes the data the component reads:
//   out/river-flow.json    -> the river draw-on line   (→ copy to your Remotion project's src/geo/)
//   out/country-meta.json  -> per-country { stop, anchor, border }   (→ src/geo/)
//   out/borders.geojson    -> country polygons, each tagged {country}  (→ public/geo/  — loaded via staticFile)
//
// RUN:  node prep-geo.mjs        (needs YOUR geodata — see CONFIG; the source polygons are too large to ship,
//                                 so the skill ships the OUTPUTS in assets/sample-data/ instead.)
// TEST: node test-prep-geo.mjs   (self-contained fixture tests; every CONFIG knob below can be overridden
//                                 via a PREP_* env var — that is how the tests inject their fixtures.)
//
// RIVER INPUT MUST BE ONE CLEAN LINESTRING, source → mouth (features[0].geometry is a LineString). If your
// OSM river comes as many ways / braided channels, ROUTE it into a single line FIRST — a graph
// shortest-path from source node to mouth node. Do NOT greedily chain by nearest endpoint: it bounces
// between parallel channels. (That routing step is a prerequisite, not part of this script.)

import {readFileSync, writeFileSync, mkdirSync} from 'fs';
import {dirname, resolve} from 'path';
import {fileURLToPath} from 'url';

if (process.argv.includes('--help')) {
	console.log(
		'Configure COUNTRIES, RIVER, BORDER, label bounds, and output paths in this script (or via PREP_* env vars), then run: node scripts/prep-geo.mjs',
	);
	process.exit(0);
}

const turf = await import('@turf/turf');

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const ENV = process.env;
const geo = ENV.PREP_GEO_DIR
	? resolve(ENV.PREP_GEO_DIR)
	: resolve(root, '../geodata'); // ADAPT: where your input GeoJSON lives
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fail = (msg) => {
	console.error(`prep-geo: ERROR: ${msg}`);
	process.exit(1);
};

// ===== CONFIG — edit for your river + countries (or override via the PREP_* env vars noted) =====
const COUNTRIES = ENV.PREP_COUNTRIES
	? ENV.PREP_COUNTRIES.split(',').map((s) => s.trim()).filter(Boolean)
	: ['china', 'india', 'bangladesh']; // ORDERED headwaters → mouth; first = source (stop 0)
const RIVER = ENV.PREP_RIVER || resolve(geo, 'focus-rivers/yarlung-brahmaputra-full-osm.geojson'); // a single clean source→mouth LineString
const BORDER = (name) =>
	ENV.PREP_BORDER_DIR
		? resolve(ENV.PREP_BORDER_DIR, `${name}.geojson`)
		: resolve(geo, `project-borders/${name}.geojson`); // one polygon file per country, named <country>.geojson
const FRAME_BBOX = ENV.PREP_FRAME_BBOX ? JSON.parse(ENV.PREP_FRAME_BBOX) : [76, 14, 104, 33.5]; // [W,S,E,N] visible extent — fallback for label anchoring only
const ANCHOR_BBOX = ENV.PREP_ANCHOR_BBOX
	? JSON.parse(ENV.PREP_ANCHOR_BBOX)
	: {
			china: [82, 27, 96, 32],
			india: [76, 14, 99, 31],
			bangladesh: [86, 20, 93, 27],
		}; // [W,S,E,N] per-country label "story region"
const NUDGE = ENV.PREP_NUDGE
	? JSON.parse(ENV.PREP_NUDGE)
	: {china: [0, 0.6], india: [-1.0, 0], bangladesh: [0, -0.6]}; // [lng,lat] label nudge
const RIVER_SIMPLIFY_TOL = Number(ENV.PREP_RIVER_SIMPLIFY_TOL || 0.006); // degrees — smooths the draw-on (bigger = simpler)
const OUT_DIR = ENV.PREP_OUT_DIR ? resolve(ENV.PREP_OUT_DIR) : resolve(root, 'out');
const OUT_RIVER = resolve(OUT_DIR, 'river-flow.json');
const OUT_META = resolve(OUT_DIR, 'country-meta.json');
const OUT_BORDERS = resolve(OUT_DIR, 'borders.geojson');
// =====================================================

const havKm = (a, b) => {
	const R = 6371,
		r = Math.PI / 180;
	const dLat = (b[1] - a[1]) * r,
		dLng = (b[0] - a[0]) * r;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
};

// --- River draw-on line: take the clean routed LineString, drop dangling cross-braid jumps at the
// tail (a >MAX_HOP_KM hop between consecutive tail points), then simplify so the wide-zoom draw-on
// reads as one smooth thread (no bezier — meander overshoot on a long river). Trimming must never
// cannibalize the river itself: once only MIN_RIVER_POINTS remain we stop, so a short river whose
// final reach is legitimately longer than MAX_HOP_KM keeps it instead of being eaten down to
// nothing. If even that leaves fewer than 2 points there is no river to draw — fail loudly. ---
const MAX_HOP_KM = 15; // a longer hop between tail points is a cross-braid jump, not river
const MIN_RIVER_POINTS = 3; // never trim below this — protects short rivers from the jump heuristic
const riverFc = read(RIVER);
const routed = riverFc?.features?.[0]?.geometry?.coordinates;
if (!Array.isArray(routed) || routed.length < 2)
	fail(
		`river LineString has ${Array.isArray(routed) ? routed.length : 0} point(s) — need at least 2 (source → mouth).`,
	);
let end = routed.length;
while (end > MIN_RIVER_POINTS && havKm(routed[end - 2], routed[end - 1]) > MAX_HOP_KM) end--; // drop final cross-braid jumps if present
const trimmed = routed.slice(0, end);
if (trimmed.length < 2)
	fail('river trimming left fewer than 2 points — refusing to write an empty river-flow.json.');
const flow = turf.simplify(turf.lineString(trimmed), {
	tolerance: RIVER_SIMPLIFY_TOL,
	highQuality: true,
}).geometry.coordinates;
if (flow.length < 2)
	fail(
		`simplification (tolerance ${RIVER_SIMPLIFY_TOL}°) collapsed the river below 2 points — lower RIVER_SIMPLIFY_TOL.`,
	);

// --- Borders + country fills (one source, filtered per country in the component) ---
const borders = {type: 'FeatureCollection', features: []};
const polys = {};
for (const name of COUNTRIES) {
	const fc = read(BORDER(name));
	polys[name] = fc;
	for (const f of fc.features) {
		f.properties = {...(f.properties || {}), country: name};
		borders.features.push(f);
	}
}

// --- Reveal stops: arc-length fraction of `flow` where the river first ENTERS each country. The first
// country (headwaters) is the source, so its stop is 0. A country whose polygons contain NO river
// point keeps the MISS_STOP sentinel (1) in the output: misses are tracked internally as null, so a
// miss can never decay into a fake 0..1 fraction, and a real entry is clamped just below 1 so it can
// never masquerade as the sentinel. ---
const MISS_STOP = 1; // sentinel in country-meta.json: "river never enters this country"
const flowKm = flow.slice(1).reduce((s, p, i) => s + havKm(flow[i], p), 0);
if (flowKm <= 0) fail('river line has zero length (all points identical).');
const insideCountry = (pt, name) =>
	polys[name].features.some((f) => turf.booleanPointInPolygon(pt, f));
const enteredAt = {};
COUNTRIES.forEach((c, i) => {
	enteredAt[c] = i === 0 ? 0 : null; // 0 = headwaters; null = not entered yet
});
let acc = 0;
for (let i = 0; i < flow.length; i++) {
	if (i > 0) acc += havKm(flow[i - 1], flow[i]);
	const frac = acc / flowKm;
	const pt = turf.point(flow[i]);
	for (const c of COUNTRIES)
		if (enteredAt[c] === null && insideCountry(pt, c)) enteredAt[c] = frac;
}
const stops = {};
for (const c of COUNTRIES)
	stops[c] = enteredAt[c] === null ? MISS_STOP : Math.min(enteredAt[c], 1 - 1e-9);

// --- Per-country meta: anchor = pole of inaccessibility of the visible landmass (centred, away from
// borders/edges) within the country's story region + a NUDGE; border = every exterior ring from the
// complete named source. Never crop a country or bilateral boundary to the viewport. ---
const biggestPoly = (geom) => {
	if (!geom || !Array.isArray(geom.coordinates) || geom.coordinates.length === 0)
		return null; // empty clip / empty geometry — caller must fall back
	const rings =
		geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
	let best = null,
		bestA = 0; // require positive area
	for (const c of rings) {
		if (!Array.isArray(c) || c.length === 0) continue;
		const p = turf.polygon(c);
		const a = turf.area(p);
		if (a > bestA) {
			bestA = a;
			best = p;
		}
	}
	return best;
};
const largestPolygon = (fc) => {
	let best = null,
		bestA = 0;
	for (const f of fc.features) {
		const p = biggestPoly(f.geometry);
		if (!p) continue;
		const a = turf.area(p);
		if (a > bestA) {
			bestA = a;
			best = p;
		}
	}
	return best;
};
const completeExteriorSegments = (fc) => {
	const segments = [];
	for (const feature of fc.features) {
		const polygons =
			feature.geometry.type === 'MultiPolygon'
				? feature.geometry.coordinates
				: [feature.geometry.coordinates];
		for (const polygon of polygons)
			if (polygon[0]?.length > 1) segments.push(polygon[0]);
	}
	return segments;
};
const poleOfInaccessibility = (poly) => {
	const bb = turf.bbox(poly),
		boundary = turf.polygonToLine(poly),
		N = 46;
	let best = null,
		bestD = -1;
	for (let i = 0; i <= N; i++)
		for (let j = 0; j <= N; j++) {
			const lng = bb[0] + ((bb[2] - bb[0]) * i) / N,
				lat = bb[1] + ((bb[3] - bb[1]) * j) / N;
			const pt = turf.point([lng, lat]);
			if (!turf.booleanPointInPolygon(pt, poly)) continue;
			const d = turf.pointToLineDistance(pt, boundary);
			if (d > bestD) {
				bestD = d;
				best = [lng, lat];
			}
		}
	return best;
};
const countryMeta = {};
for (const name of COUNTRIES) {
	const poly = largestPolygon(polys[name]);
	if (!poly) fail(`no usable polygon found for country "${name}" (${BORDER(name)}).`);
	// Clip to the story region for label anchoring. If the clip comes back empty (story region does
	// not intersect the country) fall back to the full polygon — never let empty geometry crash the
	// script or produce a nonsense anchor.
	const storyRegion =
		biggestPoly(turf.bboxClip(poly, ANCHOR_BBOX[name] || FRAME_BBOX).geometry) || poly;
	const pole =
		poleOfInaccessibility(storyRegion) ||
		turf.pointOnSurface(storyRegion).geometry.coordinates; // degenerate sliver → any interior point
	const segs = completeExteriorSegments(polys[name]);
	const nudge = NUDGE[name] || [0, 0];
	countryMeta[name] = {
		stop: stops[name],
		anchor: [pole[0] + nudge[0], pole[1] + nudge[1]],
		border: segs,
	};
}

mkdirSync(dirname(OUT_RIVER), {recursive: true});
writeFileSync(OUT_RIVER, JSON.stringify(flow));
writeFileSync(OUT_META, JSON.stringify(countryMeta));
writeFileSync(OUT_BORDERS, JSON.stringify(borders));
console.log(
	'river:',
	flow.length,
	'pts ·',
	flowKm.toFixed(0),
	'km · entry stops',
	JSON.stringify(stops),
);
for (const n of COUNTRIES) {
	const km = countryMeta[n].border.reduce(
		(s, seg) => s + turf.length(turf.lineString(seg)),
		0,
	);
	console.log(
		`  ${n}: anchor ${countryMeta[n].anchor.map((v) => v.toFixed(2)).join(',')} · border ${km.toFixed(0)} km`,
	);
}
console.log(
	"\nNext: copy out/river-flow.json + out/country-meta.json → your project's src/geo/ ; out/borders.geojson → public/geo/",
);
