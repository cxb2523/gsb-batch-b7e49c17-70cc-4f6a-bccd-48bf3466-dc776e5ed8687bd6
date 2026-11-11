import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { extractPost } from '../lib/reddit.js';

const MOCK_JSON = [
  {
    data: {
      children: [{
        data: {
          title: 'Test Post',
          author: 'testuser',
          subreddit: 'javascript',
          score: 100,
          created_utc: Math.floor(Date.now() / 1000) - 3600,
          selftext: 'Post body text.',
          is_self: true,
          url: 'https://www.reddit.com/r/javascript/comments/abc123/test/',
          num_comments: 50,
          is_video: false,
          media: null,
          gallery_data: null,
          media_metadata: null,
          post_hint: undefined,
        }
      }]
    }
  },
  {
    data: {
      children: [
        {
          kind: 't1',
          data: { author: 'commenter', score: 10, body: 'Nice!', depth: 0, replies: '' }
        }
      ]
    }
  }
];

const MOCK_ABOUT = {
  data: {
    display_name: 'AskReddit',
    title: 'Ask Reddit...',
    subscribers: 50000000,
    active_user_count: 12345,
    public_description: 'Public description here.',
    description: 'Long markdown description.',
  },
};

const MOCK_LISTING = {
  data: {
    children: [
      { kind: 't3', data: { title: 'Pinned thread', stickied: true, author: 'mod', score: 1, num_comments: 0, created_utc: Math.floor(Date.now()/1000) - 86400, permalink: '/r/AskReddit/comments/p1/', is_self: true, selftext: '' } },
      { kind: 't3', data: { title: 'What is the best advice you got?', stickied: false, author: 'asker1', score: 1234, num_comments: 567, created_utc: Math.floor(Date.now()/1000) - 7200, permalink: '/r/AskReddit/comments/abc/best_advice/', is_self: true, selftext: 'Looking for life-changing advice from this community.' } },
      { kind: 't3', data: { title: 'Cool external link', stickied: false, author: 'sharer', score: 100, num_comments: 5, created_utc: Math.floor(Date.now()/1000) - 3600, permalink: '/r/AskReddit/comments/xyz/cool_link/', is_self: false, url: 'https://example.com/article' } },
    ],
  },
};

describe('extractSubreddit (via extractPost)', () => {
  it('renders subreddit header + hot post listing', async () => {
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async (url) => {
      if (url.includes('/about.json')) return { ok: true, json: async () => MOCK_ABOUT };
      if (url.includes('/hot.json')) return { ok: true, json: async () => MOCK_LISTING };
      throw new Error('unexpected url: ' + url);
    });

    try {
      const result = await extractPost('https://www.reddit.com/r/AskReddit/');
      assert.ok(result.includes('# r/AskReddit'), 'has subreddit header');
      assert.ok(result.includes('Hot posts'), 'has listing section');
      assert.ok(result.includes('What is the best advice'), 'lists real post');
      assert.ok(!result.includes('Pinned thread'), 'skips stickied posts');
      assert.ok(result.includes('https://example.com/article'), 'shows external link for non-self post');
      assert.ok(result.includes('Looking for life-changing advice'), 'shows snippet for self post');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('still works when listing fetch fails', async () => {
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async (url) => {
      if (url.includes('/about.json')) return { ok: true, json: async () => MOCK_ABOUT };
      return { ok: false, status: 503 };
    });

    try {
      const result = await extractPost('https://www.reddit.com/r/AskReddit/');
      assert.ok(result.includes('# r/AskReddit'));
      assert.ok(!result.includes('Hot posts'));
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('extractPost', () => {
  it('returns formatted markdown without comments when comments=false', async () => {
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async () => ({
      ok: true, status: 200,
      json: async () => MOCK_JSON,
    }));

    try {
      const result = await extractPost('https://www.reddit.com/r/javascript/comments/abc123/test/', { comments: false });
      assert.ok(result.includes('# Test Post'));
      assert.ok(result.includes('Post body text.'));
      assert.ok(!result.includes('Kommentare'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('includes comments when requested', async () => {
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async () => ({
      ok: true, status: 200,
      json: async () => MOCK_JSON,
    }));

    try {
      const result = await extractPost('https://www.reddit.com/r/javascript/comments/abc123/test/', {
        comments: true,
        commentDepth: 3,
        commentLimit: 15,
      });
      assert.ok(result.includes('# Test Post'));
      assert.ok(result.includes('---'));
      assert.ok(result.includes('Kommentare'));
      assert.ok(result.includes('Nice!'));
    } finally {
      global.fetch = originalFetch;
    }
  });
});
