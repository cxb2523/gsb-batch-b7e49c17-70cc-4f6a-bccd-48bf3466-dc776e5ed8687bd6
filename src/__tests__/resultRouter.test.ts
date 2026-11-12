// Unit tests for the async-result plumbing behind the imperative API.
// Run with `yarn test` (plain `node --test`; no RN runtime needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PendingRequests,
  normalizeExportFormat,
  parseMaybeJson,
  parsePhotoLibraryResult,
  type ResultPayload,
} from '../resultRouter.ts';

const payload = (over: Partial<ResultPayload>): ResultPayload => ({
  requestId: 'req-1',
  type: 'toBase64',
  ...over,
});

/** Records how a pending entry was settled. */
const makeResolver = () => {
  const calls: Array<{ kind: 'resolve' | 'reject'; arg: unknown }> = [];
  return {
    calls,
    resolver: {
      type: 'toBase64',
      resolve: (value: string) => calls.push({ kind: 'resolve', arg: value }),
      reject: (error: Error) => calls.push({ kind: 'reject', arg: error }),
    },
  };
};

test('normalizeExportFormat accepts png/jpeg/jpg, defaults to png', () => {
  assert.equal(normalizeExportFormat(undefined), 'png');
  assert.equal(normalizeExportFormat('png'), 'png');
  assert.equal(normalizeExportFormat('PNG'), 'png');
  assert.equal(normalizeExportFormat('jpeg'), 'jpeg');
  assert.equal(normalizeExportFormat('jpg'), 'jpeg');
  assert.equal(normalizeExportFormat('JPG'), 'jpeg');
});

test('normalizeExportFormat throws a readable Error on unsupported formats', () => {
  for (const bad of ['gif', 'webp', 'heic', '']) {
    assert.throws(
      () => normalizeExportFormat(bad),
      (e: unknown) =>
        e instanceof Error && /unsupported export format/.test(e.message)
    );
  }
});

test('settle resolves with the native value', () => {
  const pending = new PendingRequests();
  const { calls, resolver } = makeResolver();
  pending.add('req-1', resolver);
  assert.equal(pending.settle(payload({ value: 'aGk=' })), true);
  assert.deepEqual(calls, [{ kind: 'resolve', arg: 'aGk=' }]);
  assert.equal(pending.size, 0);
});

test('settle rejects with the native error', () => {
  const pending = new PendingRequests();
  const { calls, resolver } = makeResolver();
  pending.add('req-1', resolver);
  pending.settle(payload({ error: 'boom' }));
  const [call] = calls;
  assert.equal(call?.kind, 'reject');
  assert.equal((call?.arg as Error).message, 'boom');
});

test('settle rejects when the payload has neither value nor error', () => {
  for (const empty of [payload({}), payload({ value: '' })]) {
    const pending = new PendingRequests();
    const { calls, resolver } = makeResolver();
    pending.add('req-1', resolver);
    pending.settle(empty);
    const [call] = calls;
    assert.equal(call?.kind, 'reject');
    assert.match((call?.arg as Error).message, /empty result/);
    assert.equal(pending.size, 0);
  }
});

test('settle prefers error over value when both are present', () => {
  const pending = new PendingRequests();
  const { calls, resolver } = makeResolver();
  pending.add('req-1', resolver);
  pending.settle(payload({ value: 'aGk=', error: 'boom' }));
  assert.equal(calls[0]?.kind, 'reject');
});

test('settle ignores unknown request ids (late/duplicate events)', () => {
  const pending = new PendingRequests();
  assert.equal(pending.settle(payload({ value: 'aGk=' })), false);
});

test('rejectAll rejects every pending request and drops late results', () => {
  const pending = new PendingRequests();
  const a = makeResolver();
  const b = makeResolver();
  pending.add('req-1', a.resolver);
  pending.add('req-2', { ...b.resolver, type: 'toFile' });

  pending.rejectAll();

  assert.equal(a.calls[0]?.kind, 'reject');
  assert.match((a.calls[0]?.arg as Error).message, /unmounted/);
  assert.match((a.calls[0]?.arg as Error).message, /toBase64/);
  assert.match((b.calls[0]?.arg as Error).message, /toFile/);
  assert.equal(pending.size, 0);

  // A late onResult for either request must not settle anything again.
  assert.equal(pending.settle(payload({ value: 'aGk=' })), false);
  assert.equal(
    pending.settle(payload({ requestId: 'req-2', value: 'x' })),
    false
  );
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
});

test('parseMaybeJson keeps the getStrokeData empty-array fallback', () => {
  assert.deepEqual(parseMaybeJson('not json', []), []);
  assert.deepEqual(parseMaybeJson('', []), []);
  assert.deepEqual(parseMaybeJson(undefined, []), []);
  assert.deepEqual(parseMaybeJson('[[{"x":1}]]', []), [[{ x: 1 }]]);
});

test('parsePhotoLibraryResult parses valid payloads', () => {
  assert.deepEqual(parsePhotoLibraryResult('{"granted":true}'), {
    granted: true,
  });
  assert.deepEqual(
    parsePhotoLibraryResult('{"granted":true,"uri":"content://x"}'),
    { granted: true, uri: 'content://x' }
  );
  assert.deepEqual(parsePhotoLibraryResult('{"granted":false}'), {
    granted: false,
  });
});

test('parsePhotoLibraryResult throws on malformed JSON instead of faking a denial', () => {
  assert.throws(
    () => parsePhotoLibraryResult('not json'),
    (e: unknown) => e instanceof Error && /unparseable result/.test(e.message)
  );
});
