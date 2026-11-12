'use strict';

// Tests for prefabs_webgl_football_pitch().
//
// Runs unchanged in Node (via test/football_pitch_test_node.js, which loads
// the global-scope framework functions) and in the browser (via
// test/football_pitch.htm, which loads the framework <script> tags first).
//
// Every call uses a fresh prefix, and this module reads the generated entities
// straight out of the global entity_entities registry.
function football_pitch_run_tests(){
    const assert = football_pitch_assert;
    const results = [];
    const expected_suffixes = [
      'grass',
      'line_outer',
      'line_half',
      'circle_centre',
      'spot_centre',
      'line_goalbox_0',
      'line_goalbox_1',
      'line_penaltybox_0',
      'line_penaltybox_1',
      'line_penaltyarc_0',
      'line_penaltyarc_1',
      'spot_penalty_0',
      'spot_penalty_1',
      'line_corner_00',
      'line_corner_01',
      'line_corner_10',
      'line_corner_11',
      'flag_corner_00',
      'flag_corner_01',
      'flag_corner_10',
      'flag_corner_11',
      'goal_0',
      'goal_1',
    ];
    const has_nan = vertices => vertices.some(value => !Number.isFinite(value));
    // Collects the (x, y, z) points of an entity as {x, y, z} objects.
    const points_of = vertices => {
      const points = [];
      for(let i = 0; i < vertices.length; i += 3){
        points.push({
          'x': vertices[i],
          'y': vertices[i + 1],
          'z': vertices[i + 2],
        });
      }
      return points;
    };
    const run = (name, fn) => {
      try{
        fn();
        results.push({
          'name': name,
          'passed': true,
        });
      }catch(error){
        results.push({
          'name': name,
          'passed': false,
          'error': String(error && error.stack ? error.stack : error),
        });
      }
    };

    // 1. Default call must produce exactly the pre-change entity set.
    run('default call matches the pre-change entity set and vertices', () => {
      const fixture = football_pitch_default_fixture;
      const prefix = 'default_check';
      prefabs_webgl_football_pitch({
        'prefix': prefix,
      });

      const expected_ids = Object.keys(fixture);
      assert.equal(
        expected_ids.length,
        23,
        'fixture should contain the 23 standard entities'
      );
      for(const expected_id of expected_ids){
        const actual_id = expected_id.replace(/^default/, prefix);
        const entity = entity_entities[actual_id];
        assert(
          entity !== void 0,
          'default entity missing: ' + actual_id
        );
        assert.deep_equal(
          [...entity.vertices],
          fixture[expected_id],
          'vertices changed for default entity ' + actual_id
        );
      }

      const actual_ids = Object.keys(entity_entities)
        .filter(id => id.startsWith(prefix + '_'))
        .sort();
      assert.deep_equal(
        actual_ids,
        expected_ids
          .map(id => id.replace(/^default/, prefix))
          .sort(),
        'default call must not create or remove entities'
      );
    });

    // 2. Non-standard dimensions: length 120, width 80, scaling 2.
    run('non-standard dimensions derive all geometry from the given values', () => {
      const prefix = 'nonstandard';
      const scaling = 2;
      const pitch_length = 120;
      const pitch_width = 80;
      prefabs_webgl_football_pitch({
        'pitch_length': pitch_length,
        'pitch_width': pitch_width,
        'prefix': prefix,
        'scaling': scaling,
      });

      // 2a. Every standard entity id prefix exists.
      for(const suffix of expected_suffixes){
        const id = prefix + '_' + suffix;
        assert(
          entity_entities[id] !== void 0,
          'missing entity id ' + id
        );
      }
      const created = Object.keys(entity_entities)
        .filter(id => id.startsWith(prefix + '_'));
      assert.equal(
        created.length,
        expected_suffixes.length,
        'all 23 standard entities are generated for a valid configuration'
      );

      const half_length = (pitch_length / 2) * scaling;
      const half_width = (pitch_width / 2) * scaling;

      // 2b. Grass corners use the recomputed halves.
      const grass = entity_entities[prefix + '_grass'].vertices;
      assert.deep_equal(
        grass,
        [
          half_length, 0, -half_width,
          -half_length, 0, -half_width,
          -half_length, 0, half_width,
          half_length, 0, half_width,
        ],
        'grass four corners must match the scaled half length/width'
      );

      // 2c. The halfway line spans the recomputed width, centred on x = 0
      // (its vertices carry the line-width thickness, +/- line_width / 2).
      const half_line = points_of(
        entity_entities[prefix + '_line_half'].vertices
      );
      const half_line_xs = half_line.map(point => point.x);
      assert.approx(
        (Math.min(...half_line_xs) + Math.max(...half_line_xs)) / 2,
        0,
        'halfway line must be centred on x = 0'
      );
      assert(
        Math.max(...half_line_xs) <= half_width,
        'halfway line must stay inside the pitch width'
      );
      const half_line_zs = half_line.map(point => point.z);
      assert(
        Math.min(...half_line_zs) < 0 && Math.max(...half_line_zs) > 0,
        'halfway line must span both sides of the pitch'
      );
      assert.approx(
        Math.max(...half_line_zs),
        half_width - .12 * scaling,
        'halfway line length must follow the scaled pitch width'
      );

      // 2d. Penalty spots sit penalty_distance inside the goal lines.
      const penalty_distance = 11 * scaling;
      const spot_center_x = vertices => {
        const xs = points_of(vertices).map(point => point.x);
        return (Math.min(...xs) + Math.max(...xs)) / 2;
      };
      assert.approx(
        spot_center_x(entity_entities[prefix + '_spot_penalty_0'].vertices),
        -half_length + penalty_distance,
        'left penalty spot x position'
      );
      assert.approx(
        spot_center_x(entity_entities[prefix + '_spot_penalty_1'].vertices),
        half_length - penalty_distance,
        'right penalty spot x position'
      );
      for(const suffix of ['spot_penalty_0', 'spot_penalty_1']){
        const zs = points_of(
          entity_entities[prefix + '_' + suffix].vertices
        ).map(point => point.z);
        assert.approx(
          (Math.min(...zs) + Math.max(...zs)) / 2,
          0,
          suffix + ' must be centred on z'
        );
      }

      // 2e. Goals stand on the goal lines (x = +/- half_length) and stay on
      // the pitch surface.
      const goal_0 = points_of(entity_entities[prefix + '_goal_0'].vertices);
      const goal_1 = points_of(entity_entities[prefix + '_goal_1'].vertices);
      for(const point of goal_0){
        assert.approx(
          point.x,
          -half_length,
          'left goal posts must stand on the left goal line'
        );
        assert(
          point.y >= 0,
          'goal vertices must not go below the grass'
        );
      }
      for(const point of goal_1){
        assert.approx(
          point.x,
          half_length,
          'right goal posts must stand on the right goal line'
        );
        assert(
          point.y >= 0,
          'goal vertices must not go below the grass'
        );
      }
      const goal_width_half = (7.32 / 2) * scaling;
      assert.approx(
        Math.max(...goal_0.map(point => Math.abs(point.z))),
        goal_width_half,
        'goal width must follow goal_width and scaling'
      );
      assert.approx(
        Math.max(...goal_0.map(point => point.y)),
        2.44 * scaling,
        'goal height must follow goal_height and scaling'
      );

      // 2f. Corner flags stand on the four pitch corners.  Pole base
      // vertices carry a small thickness, so compare their centre.
      const flags = [
        ['flag_corner_00', -half_length, -half_width],
        ['flag_corner_01', -half_length, half_width],
        ['flag_corner_10', half_length, -half_width],
        ['flag_corner_11', half_length, half_width],
      ];
      for(const [suffix, x, z] of flags){
        const base = points_of(
          entity_entities[prefix + '_' + suffix].vertices
        ).filter(point => point.y === 0);
        assert(
          base.length > 0,
          suffix + ' needs base vertices resting on the grass'
        );
        const base_xs = base.map(point => point.x);
        const base_zs = base.map(point => point.z);
        assert.approx(
          (Math.min(...base_xs) + Math.max(...base_xs)) / 2,
          x,
          suffix + ' base centre x must be the corner x'
        );
        assert.approx(
          (Math.min(...base_zs) + Math.max(...base_zs)) / 2,
          z,
          suffix + ' base centre z must be the corner z'
        );
      }

      // 2g. Nothing NaN anywhere.
      for(const id of created){
        assert(
          !has_nan(entity_entities[id].vertices),
          'NaN vertex in ' + id
        );
      }
    });

    // 3. Configuration where the penalty arcs cannot intersect the
    // penalty-box line: circle_radius smaller than the gap between the
    // penalty spot and that line (penaltybox_length - penalty_distance).
    run('invalid penalty arcs are skipped without NaN and everything else remains', () => {
      const warnings = [];
      const original_warn = console.warn;
      console.warn = message => warnings.push(String(message));

      let thrown = null;
      let created = [];
      try{
        const prefix = 'invalidarc';
        prefabs_webgl_football_pitch({
          'circle_radius': 2,
          'penalty_distance': 11,
          'penaltybox_length': 16.5,
          'prefix': prefix,
        });
        created = Object.keys(entity_entities)
          .filter(id => id.startsWith(prefix + '_'));
      }catch(error){
        thrown = error;
      }finally{
        console.warn = original_warn;
      }

      assert(thrown === null, 'prefab must not throw for invalid arcs: ' + thrown);
      assert(
        warnings.length > 0,
        'an explicit degradation warning must be emitted'
      );

      // 3a. The two arcs are the only missing entities.
      assert.equal(
        created.length,
        expected_suffixes.length - 2,
        'only the two penalty arc entities may be dropped'
      );
      for(const suffix of expected_suffixes){
        const id = 'invalidarc_' + suffix;
        if(suffix === 'line_penaltyarc_0' || suffix === 'line_penaltyarc_1'){
          assert(
            entity_entities[id] === void 0,
            suffix + ' must be skipped when no intersection exists'
          );
          continue;
        }
        assert(
          entity_entities[id] !== void 0,
          'non-arc entity missing: ' + id
        );
      }

      // 3b. No NaN in any generated vertex.
      for(const id of created){
        assert(
          !has_nan(entity_entities[id].vertices),
          'NaN vertex in ' + id
        );
      }
    });

    // 4. Per-parameter overrides: line width/height, flag height, circle
    // radius, penalty distance, goal dimensions each take effect instead of
    // falling back to a hard-coded constant or whole-pitch scaling.
    run('individual overrides (line, flag, circle, goal) take effect', () => {
      const prefix = 'overrides';
      prefabs_webgl_football_pitch({
        'circle_radius': 12,
        'flag_height': 3,
        'goal_height': 3,
        'goal_width': 9,
        'line_height': .1,
        'line_width': .5,
        'pitch_length': 100,
        'pitch_width': 70,
        'prefix': prefix,
        'scaling': 1,
      });
      const half_length = 50;
      const half_width = 35;

      const outer = entity_entities[prefix + '_line_outer'].vertices;
      // Outer-line vertices are inset by line_width and raised to line_height.
      assert.approx(
        outer[0],
        half_length - .5,
        'line_width override must inset the outer line'
      );
      assert.approx(
        outer[1],
        .1,
        'line_height override must raise line vertices'
      );

      const circle = points_of(
        entity_entities[prefix + '_circle_centre'].vertices
      );
      assert.approx(
        Math.max(...circle.map(point => Math.abs(point.x))),
        12,
        'circle_radius override must size the centre circle'
      );

      const flag = points_of(
        entity_entities[prefix + '_flag_corner_00'].vertices
      );
      assert.approx(
        Math.max(...flag.map(point => point.y)),
        3,
        'flag_height override must size the corner flags'
      );

      const goal = points_of(entity_entities[prefix + '_goal_1'].vertices);
      assert.approx(
        Math.max(...goal.map(point => point.y)),
        3,
        'goal_height override must size the goal'
      );
      assert.approx(
        Math.max(...goal.map(point => Math.abs(point.z))),
        4.5,
        'goal_width override must size the goal'
      );

      // Penalty spot follows the overridden penalty_distance (11 default kept,
      // pitch half changed to 50); take the centre of the spot's x extent.
      const spot_xs = points_of(
        entity_entities[prefix + '_spot_penalty_1'].vertices
      ).map(point => point.x);
      assert.approx(
        (Math.min(...spot_xs) + Math.max(...spot_xs)) / 2,
        half_length - 11,
        'penalty spot must follow penalty_distance on the resized pitch'
      );
    });

    return results;
}

// Minimal assertion helpers shared by every environment.
const format = value => JSON.stringify(value);

globalThis.football_pitch_assert = Object.assign(
  (condition, message) => {
    if(!condition){
      throw new Error(message || 'assertion failed');
    }
  },
  {
    'equal': (actual, expected, message) => {
      if(actual !== expected){
        throw new Error(
          (message || 'equal') + ': expected ' + format(expected)
            + ', got ' + format(actual)
        );
      }
    },
    'approx': (actual, expected, message, epsilon = 1e-9) => {
      if(Math.abs(actual - expected) > epsilon){
        throw new Error(
          (message || 'approx') + ': expected ~' + format(expected)
            + ', got ' + format(actual)
        );
      }
    },
    'deep_equal': (actual, expected, message) => {
      if(JSON.stringify(actual) !== JSON.stringify(expected)){
        throw new Error(
          (message || 'deep_equal') + ': expected ' + format(expected)
            + ', got ' + format(actual)
        );
      }
    },
  }
);
globalThis.football_pitch_run_tests = football_pitch_run_tests;
