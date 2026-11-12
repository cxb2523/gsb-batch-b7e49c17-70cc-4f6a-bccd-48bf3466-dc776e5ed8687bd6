# prefabs_webgl_football_pitch tests

Tests for the parameterised football pitch prefab. The same suite runs in
Node and in a browser; no WebGL context or build step is required because the
prefab only builds entity vertex data.

## Run in Node

```sh
npm test
# or directly:
node test/football_pitch_test_node.js
```

## Run in a browser

Open `test/football_pitch.htm` (serve the repo root over HTTP if your browser
restricts `file://` script loading, e.g. `python -m http.server`). The page
loads the framework scripts and renders PASS/FAIL rows.

## Files

- `football_pitch_test.js` — the shared test suite and assertions, loaded
  unchanged by both runners.
- `football_pitch_test_node.js` — Node runner: loads the framework's
  global-scope scripts via `vm`, registers the minimal `opaque` entity type
  that `webgl_init()` would normally register, then runs the suite.
- `football_pitch.htm` — browser runner; same suite, results rendered into the
  page.
- `football_pitch_default_entities.json` / `.js` — golden fixture of every
  entity id and vertex produced by a default prefab call, captured **before**
  the parameterisation change. The default-call test asserts the current output
  is identical to this fixture.
- `capture_default.js` — regenerates the golden fixtures from a default call.

## What is covered

1. A default call reproduces the pre-change entity set (all 23 ids) and every
   vertex exactly.
2. Non-standard dimensions (`pitch_length: 120`, `pitch_width: 80`,
   `scaling: 2`): all entity ids exist, grass corners match the recomputed
   halves, the halfway line follows the new width, penalty spots sit
   `penalty_distance` inside the goal lines, goals stand on the goal lines,
   and corner flags sit on the pitch corners — with no non-finite vertices.
3. A configuration whose penalty arcs cannot intersect the penalty-box line
   (e.g. `circle_radius: 2`, smaller than the spot-to-box-line gap) skips only
   the two arc entities, emits a `console.warn` explaining the degradation,
   keeps every other entity, and produces no NaN.
4. Individual overrides (`line_width`, `line_height`, `flag_height`,
   `circle_radius`, `goal_width`, `goal_height`, `penalty_distance`) each take
   effect independently rather than relying on whole-pitch scaling.
