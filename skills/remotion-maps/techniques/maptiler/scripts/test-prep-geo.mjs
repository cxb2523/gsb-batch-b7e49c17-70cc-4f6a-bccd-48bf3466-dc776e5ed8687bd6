// Self-contained fixture tests for prep-geo.mjs. Builds tiny synthetic GeoJSON in a temp dir,
// runs the real script against it (via the PREP_* env overrides), and checks the baked outputs.
//
// RUN: node test-prep-geo.mjs        (from this directory; needs @turf/turf installed — see ../package.json)
//
// Covers:
//   1. normal multi-country run        -> stops ordered 0 < ... < 1, outputs well-formed
//   2. cross-braid tail jumps          -> >15 km dangling tail hops are trimmed
//   3. short river with long segments  -> a 2-3 point river is NEVER trimmed away
//   4. degenerate rivers (0/1 pts, zero length) -> script exits non-zero, writes no empty river-flow.json
//   5. country the river never enters  -> stop stays exactly the miss sentinel 1
//   6. entry exactly at the last point -> stop is a real fraction < 1, not the sentinel
//   7. story-region clip misses the country -> anchor falls back to the full polygon, no crash

import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join, dirname, resolve} from 'path';
import {fileURLToPath} from 'url';
import {spawnSync} from 'child_process';

const turf = await import('@turf/turf');

const __dir = dirname(fileURLToPath(import.meta.url));
const PREP = resolve(__dir, 'prep-geo.mjs');

// ---------- tiny test harness ----------
let passed = 0,
	failed = 0;
const check = (name, cond, detail = '') => {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

// ---------- fixture helpers ----------
const square = (w, s, e, n) => ({
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[w, s],
						[e, s],
						[e, n],
						[w, n],
						[w, s],
					],
				],
			},
		},
	],
});
const riverFc = (coords) => ({
	type: 'FeatureCollection',
	features: [
		{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: coords}},
	],
});

// Countries: three 1°×1° squares in a row (alpha=source … gamma=mouth), one far-away square the
// river never touches (delta), one thin rectangle containing ONLY the river's final point (epsilon).
const COUNTRIES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
const POLYS = {
	alpha: square(0, 0, 1, 1),
	beta: square(1, 0, 2, 1),
	gamma: square(2, 0, 3, 1),
	delta: square(10, 10, 11, 11),
	epsilon: square(2.85, 0.4, 2.95, 0.6),
};
// delta's story region deliberately does NOT intersect its polygon -> exercises the empty-clip fallback.
const ANCHOR_BBOX = {delta: [0, 0, 1, 1]};
const FRAME_BBOX = [-1, -1, 12, 12];

// Main river: source (0.2,~) → mouth (2.9,~), gentle zigzag (amplitude 0.03° > simplify tolerance
// 0.006° so interior points survive simplification), ~0.104° ≈ 11.6 km hops (< 15 km so the
// tail-trim heuristic never touches the body).
const mainRiver = [];
for (let i = 0; i <= 27; i++)
	mainRiver.push([+(0.2 + 0.1 * i).toFixed(6), i % 2 ? 0.53 : 0.5]);

const makeCase = (label) => {
	const dir = mkdtempSync(join(tmpdir(), `prep-geo-${label}-`));
	const geoDir = join(dir, 'geodata');
	const borderDir = join(geoDir, 'borders');
	const outDir = join(dir, 'out');
	mkdirSync(borderDir, {recursive: true});
	return {dir, geoDir, borderDir, outDir};
};
const writeBorders = (c, names) => {
	for (const n of names)
		writeFileSync(join(c.borderDir, `${n}.geojson`), JSON.stringify(POLYS[n]));
};
const writeRiver = (c, coords) =>
	writeFileSync(join(c.geoDir, 'river.geojson'), JSON.stringify(riverFc(coords)));
const runPrep = (c, countries) =>
	spawnSync(process.execPath, [PREP], {
		env: {
			...process.env,
			PREP_GEO_DIR: c.geoDir,
			PREP_COUNTRIES: countries.join(','),
			PREP_RIVER: join(c.geoDir, 'river.geojson'),
			PREP_BORDER_DIR: c.borderDir,
			PREP_OUT_DIR: c.outDir,
			PREP_FRAME_BBOX: JSON.stringify(FRAME_BBOX),
			PREP_ANCHOR_BBOX: JSON.stringify(ANCHOR_BBOX),
			PREP_NUDGE: '{}',
		},
		encoding: 'utf8',
	});
const readOut = (c, f) => JSON.parse(readFileSync(join(c.outDir, f), 'utf8'));
const inside = (pt, name) =>
	turf.booleanPointInPolygon(turf.point(pt), POLYS[name].features[0]);

const cases = [];
try {
	// ================= 1 + 5 + 6 + 7: normal run, miss sentinel, last-point entry, empty clip =================
	{
		console.log('\ncase: normal multi-country run');
		const c = makeCase('normal');
		cases.push(c);
		writeBorders(c, COUNTRIES);
		writeRiver(c, mainRiver);
		const r = runPrep(c, COUNTRIES);
		check('exits 0', r.status === 0, r.stderr);

		const flow = readOut(c, 'river-flow.json');
		check(
			'river-flow.json is an array of >=2 [lng,lat] pairs',
			Array.isArray(flow) &&
				flow.length >= 2 &&
				flow.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)),
		);

		const meta = readOut(c, 'country-meta.json');
		check(
			'country-meta.json has stop/anchor/border for every country',
			COUNTRIES.every(
				(n) =>
					meta[n] &&
					typeof meta[n].stop === 'number' &&
					Array.isArray(meta[n].anchor) &&
					meta[n].anchor.length === 2 &&
					Array.isArray(meta[n].border) &&
					meta[n].border.length > 0,
			),
		);
		check('source country stop is 0', meta.alpha.stop === 0);
		check(
			'beta stop is a real fraction in (0,1)',
			meta.beta.stop > 0 && meta.beta.stop < 1,
			`got ${meta.beta.stop}`,
		);
		check(
			'gamma stop is a real fraction, after beta',
			meta.gamma.stop > meta.beta.stop && meta.gamma.stop < 1,
			`got ${meta.gamma.stop}`,
		);
		check(
			'delta (never entered) keeps the miss sentinel exactly 1',
			meta.delta.stop === 1,
			`got ${meta.delta.stop}`,
		);
		check(
			'epsilon (entered only at the final point) is a real fraction < 1, not the sentinel',
			meta.epsilon.stop > 0.9 && meta.epsilon.stop < 1,
			`got ${meta.epsilon.stop}`,
		);
		for (const n of COUNTRIES)
			check(`anchor of ${n} lies inside its polygon`, inside(meta[n].anchor, n),
				`anchor ${JSON.stringify(meta[n].anchor)}`);
		check(
			'delta anchor fell back to the full polygon (story region does not intersect it)',
			inside(meta.delta.anchor, 'delta') &&
				meta.delta.anchor[0] >= 10 &&
				meta.delta.anchor[0] <= 11,
		);

		const borders = readOut(c, 'borders.geojson');
		check(
			'borders.geojson: one feature per country, each tagged {country}',
			borders.type === 'FeatureCollection' &&
				borders.features.length === COUNTRIES.length &&
				COUNTRIES.every((n) =>
					borders.features.some((f) => f.properties && f.properties.country === n),
				),
		);
	}

	// ================= 2: cross-braid tail jumps are trimmed =================
	{
		console.log('\ncase: cross-braid tail jumps');
		const c = makeCase('braid');
		cases.push(c);
		writeBorders(c, COUNTRIES);
		// two dangling tail hops of ~0.3° ≈ 33 km each (> 15 km) — cross-braid jumps
		writeRiver(c, [...mainRiver, [3.2, 0.5], [3.5, 0.53]]);
		const r = runPrep(c, COUNTRIES);
		check('exits 0', r.status === 0, r.stderr);
		const flow = readOut(c, 'river-flow.json');
		const last = flow[flow.length - 1];
		check(
			'dangling >15km tail hops are dropped (last point is the real mouth)',
			Math.abs(last[0] - 2.9) < 1e-6 && Math.abs(last[1] - 0.53) < 1e-6,
			`last ${JSON.stringify(last)}`,
		);
		check(
			'no trimmed jump point survives anywhere in the line',
			flow.every((p) => p[0] <= 2.9 + 1e-6),
		);
	}

	// ================= 3: short river with legitimately long segments is NOT trimmed =================
	{
		console.log('\ncase: short river, long legitimate segments');
		const c = makeCase('short');
		cases.push(c);
		writeBorders(c, COUNTRIES);
		// 3 points, both hops ~0.6-0.7° ≈ 70+ km — long but legitimate; must survive untouched
		writeRiver(c, [
			[0.2, 0.5],
			[0.8, 0.53],
			[1.5, 0.5],
		]);
		const r = runPrep(c, COUNTRIES);
		check('exits 0', r.status === 0, r.stderr);
		const flow = readOut(c, 'river-flow.json');
		check('3-point river keeps all 3 points', flow.length === 3, `got ${flow.length}`);

		const c2 = makeCase('short2');
		cases.push(c2);
		writeBorders(c2, COUNTRIES);
		writeRiver(c2, [
			[0.2, 0.5],
			[1.5, 0.5],
		]); // 2 points, one ~144 km hop — still a valid river
		const r2 = runPrep(c2, COUNTRIES);
		check('exits 0 (2-point river)', r2.status === 0, r2.stderr);
		const flow2 = readOut(c2, 'river-flow.json');
		check('2-point river keeps both points', flow2.length === 2, `got ${flow2.length}`);
	}

	// ================= 4: degenerate rivers fail loudly, never write an empty line =================
	{
		console.log('\ncase: degenerate rivers');
		for (const [label, coords] of [
			['single point', [[0.5, 0.5]]],
			['empty line', []],
			['zero-length (all points identical)', [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]],
		]) {
			const c = makeCase('degenerate');
			cases.push(c);
			writeBorders(c, COUNTRIES);
			writeRiver(c, coords);
			const r = runPrep(c, COUNTRIES);
			check(`${label}: exits non-zero`, r.status !== 0, `status ${r.status}`);
			check(
				`${label}: no river-flow.json written`,
				!existsSync(join(c.outDir, 'river-flow.json')),
			);
		}
	}
} finally {
	for (const c of cases) rmSync(c.dir, {recursive: true, force: true});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
