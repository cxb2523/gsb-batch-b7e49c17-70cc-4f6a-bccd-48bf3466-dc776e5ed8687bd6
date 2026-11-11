import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOldRedditHtml } from '../lib/reddit.js';

const MOCK_HTML = `
<html>
<body>
  <div class="thing" data-score="142">
    <a class="title may-blank" href="/r/javascript/comments/abc123/test_post/">Test Post Title</a>
    <p class="tagline">
      submitted by <a class="author" href="/user/testuser">testuser</a>
      to <a class="subreddit" href="/r/javascript">r/javascript</a>
    </p>
    <div class="expando">
      <div class="usertext-body">
        <div class="md">
          <p>This is the post body.</p>
          <p>With multiple paragraphs.</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

describe('parseOldRedditHtml', () => {
  it('extracts title from old reddit HTML', () => {
    const result = parseOldRedditHtml(MOCK_HTML);
    assert.equal(result.title, 'Test Post Title');
  });

  it('extracts author', () => {
    const result = parseOldRedditHtml(MOCK_HTML);
    assert.equal(result.author, 'testuser');
  });

  it('extracts subreddit', () => {
    const result = parseOldRedditHtml(MOCK_HTML);
    assert.equal(result.subreddit, 'javascript');
  });

  it('extracts score', () => {
    const result = parseOldRedditHtml(MOCK_HTML);
    assert.equal(result.score, 142);
  });

  it('extracts body text', () => {
    const result = parseOldRedditHtml(MOCK_HTML);
    assert.ok(result.selftext.includes('This is the post body.'));
    assert.ok(result.selftext.includes('With multiple paragraphs.'));
  });

  it('returns formatPost-compatible shape', () => {
    const result = parseOldRedditHtml(MOCK_HTML);
    assert.equal(result.is_self, true);
    assert.equal(result.is_video, false);
    assert.equal(result.media, null);
    assert.equal(typeof result.created_utc, 'number');
  });
});
