import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRedditUrl } from '../lib/reddit.js';

describe('normalizeRedditUrl', () => {
  it('passes through standard www.reddit.com URL', () => {
    const url = 'https://www.reddit.com/r/javascript/comments/abc123/my_post/';
    const result = normalizeRedditUrl(url);
    assert.equal(result, 'https://www.reddit.com/r/javascript/comments/abc123/my_post/');
  });

  it('adds www to bare reddit.com', () => {
    const result = normalizeRedditUrl('https://reddit.com/r/javascript/comments/abc123/my_post/');
    assert.equal(result, 'https://www.reddit.com/r/javascript/comments/abc123/my_post/');
  });

  it('converts old.reddit.com to www.reddit.com', () => {
    const result = normalizeRedditUrl('https://old.reddit.com/r/javascript/comments/abc123/my_post/');
    assert.equal(result, 'https://www.reddit.com/r/javascript/comments/abc123/my_post/');
  });

  it('converts new.reddit.com to www.reddit.com', () => {
    const result = normalizeRedditUrl('https://new.reddit.com/r/javascript/comments/abc123/my_post/');
    assert.equal(result, 'https://www.reddit.com/r/javascript/comments/abc123/my_post/');
  });

  it('strips tracking query params', () => {
    const result = normalizeRedditUrl('https://www.reddit.com/r/javascript/comments/abc123/my_post/?utm_source=share&utm_medium=web');
    assert.equal(result, 'https://www.reddit.com/r/javascript/comments/abc123/my_post/');
  });

  it('strips hash fragments', () => {
    const result = normalizeRedditUrl('https://www.reddit.com/r/javascript/comments/abc123/my_post/#section');
    assert.equal(result, 'https://www.reddit.com/r/javascript/comments/abc123/my_post/');
  });

  it('ensures trailing slash', () => {
    const result = normalizeRedditUrl('https://www.reddit.com/r/javascript/comments/abc123/my_post');
    assert.equal(result, 'https://www.reddit.com/r/javascript/comments/abc123/my_post/');
  });

  it('rejects non-reddit URLs', () => {
    assert.throws(() => normalizeRedditUrl('https://example.com/foo'), { message: /not a valid Reddit URL/i });
  });

  it('rejects empty input', () => {
    assert.throws(() => normalizeRedditUrl(''), { message: /not a valid Reddit URL/i });
  });

  it('rejects null input', () => {
    assert.throws(() => normalizeRedditUrl(null), { message: /not a valid Reddit URL/i });
  });

  it('rejects undefined input', () => {
    assert.throws(() => normalizeRedditUrl(undefined), { message: /not a valid Reddit URL/i });
  });

  it('rejects non-URL strings', () => {
    assert.throws(() => normalizeRedditUrl('just some text'), { message: /not a valid Reddit URL/i });
  });

  it('identifies redd.it short links as needing redirect resolution', () => {
    const result = normalizeRedditUrl('https://redd.it/abc123');
    assert.equal(result, 'NEEDS_REDIRECT:https://redd.it/abc123');
  });

  it('identifies /s/ share links as needing redirect resolution', () => {
    const result = normalizeRedditUrl('https://www.reddit.com/r/javascript/s/AbCdEf123');
    assert.equal(result, 'NEEDS_REDIRECT:https://www.reddit.com/r/javascript/s/AbCdEf123');
  });
});
