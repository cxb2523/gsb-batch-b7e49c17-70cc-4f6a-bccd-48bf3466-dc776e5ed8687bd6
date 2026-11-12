'use strict';

// Node runner for the football-pitch prefab tests.
//
//   node test/football_pitch_test_node.js
//
// It loads the repo's global-scope framework scripts into this realm,
// registers a minimal "opaque" entity type (in a browser webgl_init() does
// that), then executes test/football_pitch_test.js.  The same test file is
// used directly by test/football_pitch.htm in the browser.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');

// Browser globals the framework expects at load time; none of their callbacks
// need to fire while generating entities.
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.TouchEvent = class TouchEvent {};

const framework_files = [
  'js/math.js',
  'js/core.js',
  'js/entity.js',
  'js/webgl.js',
  'js/prefabs/webgl.js',
];
for(const file of framework_files){
  vm.runInThisContext(fs.readFileSync(path.join(repo, file), 'utf8'), {
    'filename': file,
  });
}

// Minimal stand-in for the "opaque" entity type registered in webgl_init().
entity_set({
  'defaults': true,
  'properties': {
    'alpha': 1,
    'attach_to': '',
    'attach_x': 0,
    'attach_y': 0,
    'attach_z': 0,
    'billboard': false,
    'collision': true,
    'draw': true,
    'draw_mode': 'TRIANGLE_FAN',
    'groups': [],
    'picking': false,
    'position_x': 0,
    'position_y': 0,
    'position_z': 0,
    'rotate_x': 0,
    'rotate_y': 0,
    'rotate_z': 0,
    'texture': 'default.png',
    'vertex_colors': [],
    'vertices': [],
  },
  'type': 'opaque',
});

globalThis.football_pitch_default_fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'football_pitch_default_entities.json'),
    'utf8'
  )
);

vm.runInThisContext(
  fs.readFileSync(path.join(__dirname, 'football_pitch_test.js'), 'utf8'),
  {'filename': 'football_pitch_test.js'}
);

const results = globalThis.football_pitch_run_tests();
let failed = 0;
for(const result of results){
  if(result.passed){
    console.log('PASS  ' + result.name);
  }else{
    failed++;
    console.log('FAIL  ' + result.name);
    console.log('      ' + result.error.split('\n').join('\n      '));
  }
}
console.log('');
console.log(
  (results.length - failed) + '/' + results.length + ' test groups passed'
);
process.exit(failed === 0 ? 0 : 1);
