import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../lib/auth.js';

const fastOpts = { timeCost: 1, memoryCost: 1024, parallelism: 1 };

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct-horse-battery', fastOpts);
    assert.ok(hash.startsWith('$argon2id$'), 'must be argon2id');
    assert.equal(await verifyPassword(hash, 'correct-horse-battery'), true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right', fastOpts);
    assert.equal(await verifyPassword(hash, 'wrong'), false);
  });

  it('produces different hashes for the same password (salt is random)', async () => {
    const a = await hashPassword('same', fastOpts);
    const b = await hashPassword('same', fastOpts);
    assert.notEqual(a, b);
  });

  it('verifyPassword returns false for malformed hash without throwing', async () => {
    assert.equal(await verifyPassword('not-a-real-hash', 'whatever'), false);
  });
});
