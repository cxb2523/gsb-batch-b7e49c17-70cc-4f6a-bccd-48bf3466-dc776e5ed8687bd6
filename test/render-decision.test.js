import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderDecision } from '../lib/render-decision.js';

function build(markdown, { quality = 1, extractorReason = null } = {}) {
  return { markdown, metadata: { quality, extractorReason } };
}

describe('renderDecision', () => {
  it('renders when readability fell back AND output is thin', () => {
    const r = build('short body', { quality: 0.6, extractorReason: 'readability fell back to body, trafilatura empty' });
    const d = renderDecision(r);
    assert.equal(d.yes, true);
    assert.match(d.reason, /fell back/i);
  });

  it('renders on body-soup signature: many headings, few paragraphs, modest length', () => {
    // Mistral profile: 19 headings, 3 paragraphs, len ~4178
    const headings = Array.from({ length: 19 }, (_, i) => `## H${i}`).join('\n\n');
    const paragraphs = Array.from({ length: 3 }, () => 'A paragraph with at least forty characters of body text here.').join('\n\n');
    const md = headings + '\n\n' + paragraphs + '\n' + 'x'.repeat(2000);
    const r = build(md, { quality: 0.8 });
    const d = renderDecision(r);
    assert.equal(d.yes, true);
    assert.match(d.reason, /body-soup/i);
  });

  it('renders on low overall quality (<0.5)', () => {
    const r = build('# Title\n\nSome content here.', { quality: 0.3 });
    const d = renderDecision(r);
    assert.equal(d.yes, true);
    assert.match(d.reason, /low quality/i);
  });

  it('does not render a clean article (paulgraham profile)', () => {
    const md = '# Great Work\n\n' + Array.from({ length: 12 }, () =>
      'A paragraph with at least forty characters of body text in it for sure.'
    ).join('\n\n') + '\n\n## Subheading\n\nMore body here for sure thanks.';
    const r = build(md, { quality: 0.95 });
    const d = renderDecision(r);
    assert.equal(d.yes, false);
  });

  it('does not render when only 4 headings (under threshold)', () => {
    const md = ['## A', '## B', '## C', '## D'].join('\n\n') +
      '\n\n' + Array.from({ length: 3 }, () => 'A paragraph with at least forty characters of body text in it for sure.').join('\n\n');
    const r = build(md, { quality: 0.7 });
    const d = renderDecision(r);
    assert.equal(d.yes, false);
  });

  it('override=force renders regardless of quality', () => {
    const r = build('clean clean clean', { quality: 0.99 });
    const d = renderDecision(r, 'force');
    assert.equal(d.yes, true);
    assert.match(d.reason, /force/);
  });

  it('override=skip never renders, even on body-soup', () => {
    const headings = Array.from({ length: 19 }, (_, i) => `## H${i}`).join('\n\n');
    const r = build(headings, { quality: 0.3, extractorReason: 'fell back' });
    const d = renderDecision(r, 'skip');
    assert.equal(d.yes, false);
    assert.match(d.reason, /skip/);
  });
});
