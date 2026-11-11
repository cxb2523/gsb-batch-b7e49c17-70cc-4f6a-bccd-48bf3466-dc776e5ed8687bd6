import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../lib/cache.js';
import { createAuth } from '../lib/auth.js';

describe('api keys', () => {
  let cache, auth, userId;

  beforeEach(() => {
    cache = createCache(':memory:');
    auth = createAuth({ db: cache.db, mode: 'multi-user', env: {} });
    const r = cache.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run('u@x.y', 'pw-hash');
    userId = r.lastInsertRowid;
  });

  it('createApiKey returns key with pmd_ prefix and 36 chars total', () => {
    const { fullKey, prefix } = auth.createApiKey(userId, 'My laptop');
    assert.match(fullKey, /^pmd_[A-Za-z0-9]{32}$/);
    assert.equal(fullKey.length, 36);
    assert.equal(prefix, fullKey.slice(0, 12));
  });

  it('lookupApiKey returns the user for a valid key', () => {
    const { fullKey } = auth.createApiKey(userId, 'k1');
    const user = auth.lookupApiKey(fullKey);
    assert.equal(user.id, userId);
    assert.equal(user.email, 'u@x.y');
  });

  it('lookupApiKey returns null for malformed prefix', () => {
    assert.equal(auth.lookupApiKey('bearer-no-prefix'), null);
    assert.equal(auth.lookupApiKey(''), null);
    assert.equal(auth.lookupApiKey(null), null);
  });

  it('lookupApiKey returns null for unknown key', () => {
    assert.equal(auth.lookupApiKey('pmd_' + 'x'.repeat(32)), null);
  });

  it('lookupApiKey updates last_used_at', () => {
    const { fullKey } = auth.createApiKey(userId, 'k2');
    const before = cache.db.prepare("SELECT last_used_at FROM api_keys WHERE label = 'k2'").get();
    assert.equal(before.last_used_at, null);
    auth.lookupApiKey(fullKey);
    const after = cache.db.prepare("SELECT last_used_at FROM api_keys WHERE label = 'k2'").get();
    assert.ok(after.last_used_at);
  });

  it('listApiKeys returns prefix + label, never the full key or hash', () => {
    auth.createApiKey(userId, 'k3');
    auth.createApiKey(userId, 'k4');
    const keys = auth.listApiKeys(userId);
    assert.equal(keys.length, 2);
    for (const k of keys) {
      assert.ok(k.id);
      assert.match(k.key_prefix, /^pmd_/);
      assert.ok('last_used_at' in k);
      assert.ok(!('key_hash' in k), 'must not leak key_hash');
    }
  });

  it('revokeApiKey deletes by id, scoped to user', () => {
    const { fullKey } = auth.createApiKey(userId, 'doomed');
    const id = cache.db.prepare("SELECT id FROM api_keys WHERE label = 'doomed'").get().id;
    assert.equal(auth.revokeApiKey(userId, id), true);
    assert.equal(auth.lookupApiKey(fullKey), null);
    assert.equal(auth.revokeApiKey(userId, id), false);
  });

  it('revokeApiKey refuses to delete another user\'s key', () => {
    const r = cache.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run('other@x.y', 'pw');
    const otherId = r.lastInsertRowid;
    auth.createApiKey(userId, 'mine');
    const myKeyId = cache.db.prepare("SELECT id FROM api_keys WHERE label = 'mine'").get().id;
    assert.equal(auth.revokeApiKey(otherId, myKeyId), false);
    assert.equal(auth.listApiKeys(userId).length, 1);
  });
});
