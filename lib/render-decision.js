import { metrics } from './scoring.js';

/**
 * Decide whether to fall back to Playwright rendering for a static-extraction result.
 *
 * @param {object} result  Output of convertWithReadability — must have .markdown and .metadata
 * @param {'force'|'skip'|undefined} override  Manual override from ?render= query param
 * @returns {{yes: boolean, reason: string}}
 */
export function renderDecision(result, override) {
  if (override === 'force') return { yes: true,  reason: 'forced via render=force' };
  if (override === 'skip')  return { yes: false, reason: 'skipped via render=skip' };

  const m = metrics(result.markdown);
  const reason = result.metadata?.extractorReason || '';
  const quality = result.metadata?.quality;

  // (i) Readability fell back AND output is thin
  if (reason.includes('fell back') && m.len < 500) {
    return { yes: true, reason: 'readability fell back, output thin (<500c)' };
  }

  // (ii) Body-soup signature: many headings, few paragraphs, modest length
  if (m.headings >= 5 && m.paragraphs > 0 && (m.headings / m.paragraphs) > 3 && m.len < 5000) {
    return { yes: true, reason: `body-soup signature (${m.headings} headings / ${m.paragraphs} paragraphs)` };
  }

  // (iii) Low overall quality safety net
  if (typeof quality === 'number' && quality < 0.5) {
    return { yes: true, reason: `low quality (${quality})` };
  }

  return { yes: false, reason: 'static extraction acceptable' };
}
