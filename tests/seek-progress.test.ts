import test from 'node:test';
import assert from 'node:assert/strict';
import {seekPosition,visiblePlaybackTime} from '../src/renderer/seek-progress';

test('manual seeking accepts uncached positions and preserves a near-end target',()=>{
 assert.equal(seekPosition(48,60),48);
 assert.equal(seekPosition(59.5,60),59.5);
 assert.equal(seekPosition(60,60),59.95);
 assert.equal(seekPosition(-10,60),0);
 assert.equal(seekPosition(Infinity,60),undefined);
 assert.equal(seekPosition(10,0),undefined);
});

test('pending user selection wins over stale media time until the seek finishes',()=>{
 assert.equal(visiblePlaybackTime(0,48),48);
 assert.equal(visiblePlaybackTime(1,32),32);
 assert.equal(visiblePlaybackTime(40,0),0);
 assert.equal(visiblePlaybackTime(32.3,null),32.3);
});
