import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

import { Security } from '@/pages/Security';
import { Privacy } from '@/pages/Privacy';
import { Terms } from '@/pages/Terms';
import { Login } from '@/pages/Login';
import { Landing } from '@/pages/Landing';
import { PublicFooter } from '@/components/PublicFooter';
import { BoardBlockedState } from '@/features/boards/components/BoardBlockedState';
import { BoardFooter } from '@/features/boards/components/BoardFooter';
import { ProfileAsideNotes } from '@/features/user/components/ProfileAsideNotes';
import { DataExportSection } from '@/features/user/components/DataExportSection';
import { clearAuthConfigCache } from '@/lib/auth-config';
import { renderWithProviders } from '@/test/render-with-providers';

const BANNED_COPY_WORDS = [
  'zero-knowledge',
  'zero knowledge',
  'impossible',
  'unhackable',
  'unbreakable',
  'backdoor',
  'nobody can',
  '100%',
  'military',
  'guarantee',
  'mathematically',
  'gdpr compliant',
  'anonymized',
  'anonymised',
];

const BANNED_DOC_CLAIMS = [
  'zero egress',
  'affordable',
  'recommended for production',
  'free tier',
  'per month',
  'seamlessly',
  'well-suited',
  'cheapest',
  'zero phone-home',
  'local-first',
];

function assertNoBannedWords(text: string, context: string) {
  const lower = text.toLowerCase();
  for (const word of BANNED_COPY_WORDS) {
    expect(lower.includes(word), `Found banned word "${word}" in ${context}`).toBe(false);
  }
}

describe('Copy safety test (Batch 19: Honest Claims)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuthConfigCache();
  });

  it('verifies Security page text contains no banned copy words', () => {
    const { container } = render(
      <BrowserRouter>
        <Security />
      </BrowserRouter>,
    );
    assertNoBannedWords(container.textContent || '', 'Security page');
  });

  it('verifies Privacy page text contains no banned copy words', () => {
    const { container } = render(
      <BrowserRouter>
        <Privacy />
      </BrowserRouter>,
    );
    assertNoBannedWords(container.textContent || '', 'Privacy page');
  });

  it('verifies Terms page text contains no banned copy words', () => {
    const { container } = render(
      <BrowserRouter>
        <Terms />
      </BrowserRouter>,
    );
    assertNoBannedWords(container.textContent || '', 'Terms page');
  });

  it('verifies Login page text contains no banned copy words', () => {
    const { container } = render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>,
    );
    assertNoBannedWords(container.textContent || '', 'Login page');
  });

  it('verifies Landing page text contains no banned copy words or vendor claims', () => {
    const { container } = render(
      <BrowserRouter>
        <Landing />
      </BrowserRouter>,
    );
    const text = container.textContent || '';
    assertNoBannedWords(text, 'Landing page');
    for (const claim of BANNED_DOC_CLAIMS) {
      expect(text.toLowerCase().includes(claim), `Found "${claim}" in Landing page`).toBe(false);
    }
  });

  it('verifies PublicFooter text contains no banned copy words', () => {
    const { container } = render(
      <BrowserRouter>
        <PublicFooter />
      </BrowserRouter>,
    );
    assertNoBannedWords(container.textContent || '', 'PublicFooter component');
  });

  it('verifies BoardBlockedState and BoardFooter contains no banned copy words', () => {
    const blocked = render(
      <BrowserRouter>
        <BoardBlockedState reason="cannot-decrypt" workspaceRef="test-ws" onRetry={() => {}} />
      </BrowserRouter>,
    );
    assertNoBannedWords(blocked.container.textContent || '', 'BoardBlockedState');

    const footer = render(
      <BrowserRouter>
        <BoardFooter isViewer={false} accessRole="admin" isGridOn={false} />
      </BrowserRouter>,
    );
    assertNoBannedWords(footer.container.textContent || '', 'BoardFooter');
  });

  it('verifies Profile components contain no banned copy words', () => {
    const notes = render(<ProfileAsideNotes />);
    assertNoBannedWords(notes.container.textContent || '', 'ProfileAsideNotes');

    const exportSection = renderWithProviders(<DataExportSection />);
    assertNoBannedWords(exportSection.container.textContent || '', 'DataExportSection');
  });

  it('scans all docs markdown articles for banned copy words and third-party vendor claims', () => {
    const articlesDir = path.resolve(__dirname, '../docs/articles');
    const files = fs.readdirSync(articlesDir).filter((f) => f.endsWith('.md'));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(path.join(articlesDir, file), 'utf-8');
      assertNoBannedWords(content, `Doc article ${file}`);

      const lower = content.toLowerCase();
      for (const claim of BANNED_DOC_CLAIMS) {
        expect(
          lower.includes(claim),
          `Found banned vendor claim "${claim}" in Doc article ${file}`,
        ).toBe(false);
      }
    }
  });
});
