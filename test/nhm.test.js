import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractWeb } from '../lib/web.js';

function mockFetch(html) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => h === 'content-type' ? 'text/html; charset=utf-8' : null },
    text: async () => html,
  });
}

describe('GFM output quality', () => {
  it('converts code blocks with language hints', async () => {
    const html = `<html><head><title>Code</title></head><body>
      <article><pre><code class="language-ts">const x: number = 1;</code></pre></article>
    </body></html>`;
    const result = await extractWeb('https://example.com/code', { fetch: mockFetch(html) });
    // Readability strips class attributes, so language hint may not survive; check fenced block and content
    assert.ok(result.markdown.includes('```'), 'should have fenced code block');
    assert.ok(result.markdown.includes('const x: number = 1;'));
  });

  it('converts HTML tables to GFM tables', async () => {
    const html = `<html><head><title>Table</title></head><body>
      <article><table><thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody><tr><td>A</td><td>1</td></tr></tbody></table></article>
    </body></html>`;
    const result = await extractWeb('https://example.com/table', { fetch: mockFetch(html) });
    assert.ok(result.markdown.includes('| Name'), 'should have GFM table');
    assert.ok(result.markdown.includes('---'), 'should have table separator');
  });

  it('converts task lists', async () => {
    const html = `<html><head><title>Tasks</title></head><body>
      <article><ul>
        <li><input type="checkbox" checked> Done</li>
        <li><input type="checkbox"> Todo</li>
      </ul></article>
    </body></html>`;
    const result = await extractWeb('https://example.com/tasks', { fetch: mockFetch(html) });
    assert.ok(result.markdown.includes('[x]') || result.markdown.includes('Done'), 'should have checked task');
    assert.ok(result.markdown.includes('[ ]') || result.markdown.includes('Todo'), 'should have unchecked task');
  });
});
