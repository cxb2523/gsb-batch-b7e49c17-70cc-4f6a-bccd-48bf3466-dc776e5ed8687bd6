import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPost } from '../lib/reddit.js';

describe('Integration: real Reddit fetch', { skip: !process.env.RUN_INTEGRATION }, () => {
  it('extracts a known Reddit post', async () => {
    const markdown = await extractPost('https://www.reddit.com/r/AskReddit/comments/t0ynr/what_single_sentence_has_the_most_meaning_to_you/');
    assert.ok(markdown.includes('#'));
    assert.ok(markdown.length > 50);
  });

  it('extracts with comments', async () => {
    const markdown = await extractPost('https://www.reddit.com/r/AskReddit/comments/t0ynr/what_single_sentence_has_the_most_meaning_to_you/', {
      comments: true,
      commentLimit: 3,
      commentDepth: 2,
    });
    assert.ok(markdown.includes('Kommentare'));
  });
});
