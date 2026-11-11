import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatComments } from '../lib/reddit.js';

const makeComment = (overrides = {}) => ({
  kind: 't1',
  data: {
    author: 'commenter',
    score: 10,
    body: 'Comment text',
    depth: 0,
    replies: '',
    ...overrides,
  },
});

const makeCommentTree = (comments) => ({
  data: { children: comments },
});

describe('formatComments', () => {
  it('formats a single top-level comment', () => {
    const tree = makeCommentTree([
      makeComment({ author: 'user1', score: 87, body: 'Great post!' }),
    ]);
    const result = formatComments(tree, { totalComments: 100, limit: 15, depth: 3 });
    assert.ok(result.includes('## Kommentare (1 von 100)'));
    assert.ok(result.includes('**u/user1** [+87]: Great post!'));
  });

  it('emits English header when lang=en', () => {
    const tree = makeCommentTree([
      makeComment({ author: 'user1', score: 87, body: 'Great post!' }),
    ]);
    const result = formatComments(tree, { totalComments: 100, limit: 15, depth: 3, lang: 'en' });
    assert.ok(result.includes('## Comments (1 of 100)'));
    assert.ok(!result.includes('## Kommentare'));
  });

  it('indents nested replies with 2 spaces per level', () => {
    const tree = makeCommentTree([
      makeComment({
        author: 'user1', score: 87, body: 'Top level',
        replies: {
          data: {
            children: [
              makeComment({
                author: 'replier', score: 23, body: 'Reply text',
                depth: 1,
                replies: {
                  data: {
                    children: [
                      makeComment({ author: 'deep', score: 5, body: 'Deep reply', depth: 2, replies: '' }),
                    ]
                  }
                }
              }),
            ]
          }
        }
      }),
    ]);
    const result = formatComments(tree, { totalComments: 50, limit: 15, depth: 3 });
    assert.ok(result.includes('**u/user1** [+87]: Top level'));
    assert.ok(result.includes('  **u/replier** [+23]: Reply text'));
    assert.ok(result.includes('    **u/deep** [+5]: Deep reply'));
  });

  it('skips [deleted] and [removed] comments', () => {
    const tree = makeCommentTree([
      makeComment({ author: '[deleted]', body: '[deleted]' }),
      makeComment({ author: '[removed]', body: '[removed]' }),
      makeComment({ author: 'real_user', score: 5, body: 'Visible comment' }),
    ]);
    const result = formatComments(tree, { totalComments: 10, limit: 15, depth: 3 });
    assert.ok(!result.includes('[deleted]'));
    assert.ok(!result.includes('[removed]'));
    assert.ok(result.includes('Visible comment'));
  });

  it('respects comment_limit', () => {
    const comments = Array.from({ length: 20 }, (_, i) =>
      makeComment({ author: `user${i}`, score: i, body: `Comment ${i}` })
    );
    const tree = makeCommentTree(comments);
    const result = formatComments(tree, { totalComments: 100, limit: 5, depth: 3 });
    assert.ok(result.includes('user0'));
    assert.ok(result.includes('user4'));
    assert.ok(!result.includes('user5'));
  });

  it('respects comment_depth', () => {
    const tree = makeCommentTree([
      makeComment({
        author: 'l0', score: 1, body: 'Level 0', depth: 0,
        replies: {
          data: {
            children: [
              makeComment({
                author: 'l1', score: 1, body: 'Level 1', depth: 1,
                replies: {
                  data: {
                    children: [
                      makeComment({ author: 'l2', score: 1, body: 'Level 2 (hidden)', depth: 2, replies: '' }),
                    ]
                  }
                }
              }),
            ]
          }
        }
      }),
    ]);
    const result = formatComments(tree, { totalComments: 10, limit: 15, depth: 2 });
    assert.ok(result.includes('Level 0'));
    assert.ok(result.includes('Level 1'));
    assert.ok(!result.includes('Level 2'));
  });

  it('separates top-level comments with blank lines', () => {
    const tree = makeCommentTree([
      makeComment({ author: 'a', score: 1, body: 'First' }),
      makeComment({ author: 'b', score: 2, body: 'Second' }),
    ]);
    const result = formatComments(tree, { totalComments: 10, limit: 15, depth: 3 });
    const lines = result.split('\n');
    const firstIdx = lines.findIndex(l => l.includes('First'));
    const secondIdx = lines.findIndex(l => l.includes('Second'));
    assert.ok(secondIdx > firstIdx + 1, 'Should have blank line between top-level comments');
  });
});
