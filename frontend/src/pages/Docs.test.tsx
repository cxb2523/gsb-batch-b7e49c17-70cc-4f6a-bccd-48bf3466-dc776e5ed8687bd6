import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Docs } from './Docs';

describe('Modern Public Documentation Hub (/docs/*)', () => {
  let writeTextSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    writeTextSpy = vi.fn().mockImplementation(() => Promise.resolve());
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });
  });

  const renderDocs = (initialEntry = '/docs') => {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:slug" element={<Docs />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('renders the first guide on /docs root path', () => {
    renderDocs('/docs');

    expect(
      screen.getByRole('heading', { level: 1, name: /^Run with Docker Compose$/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Getting started/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 min read/i)).toBeInTheDocument();
  });

  it('renders specific guide when navigating via slug (/docs/going-public)', () => {
    renderDocs('/docs/going-public');

    expect(
      screen.getByRole('heading', { level: 1, name: /^Behind a proxy and going public$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Proxy trust, closing sign-ups, limits and a public demo/i),
    ).toBeInTheDocument();
  });

  it('renders all four categories in the sidebar navigation', () => {
    renderDocs('/docs');

    const nav = screen.getByRole('navigation', { name: /Documentation navigation/i });
    expect(nav).toHaveTextContent(/Getting started/i);
    expect(nav).toHaveTextContent(/Running it/i);
    expect(nav).toHaveTextContent(/Keys and security/i);
    expect(nav).toHaveTextContent(/Reference/i);
  });

  it('filters articles in real time when typing in the search box', async () => {
    renderDocs('/docs');

    const searchInput = screen.getByPlaceholderText(/Search documentation.../i);
    fireEvent.change(searchInput, { target: { value: 'corepack' } });

    const nav = screen.getByRole('navigation', { name: /Documentation navigation/i });
    expect(nav).toHaveTextContent(/Upgrading/i);
    expect(nav).not.toHaveTextContent(/Sign in with Google/i);

    // Clear filter
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(nav).toHaveTextContent(/Sign in with Google/i);
  });

  it('renders GitHub-style callouts with distinct styles and badges', () => {
    renderDocs('/docs/backups-and-restore');

    const callout = document.querySelector('.doc-callout-warning');
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveTextContent(/WARNING/i);
    expect(callout).toHaveTextContent(/as sensitive as the instance itself/i);
  });

  it('renders the heading that follows a callout as a heading, not as text', () => {
    renderDocs('/docs/backups-and-restore');

    expect(screen.getByRole('heading', { name: /Back up/ })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('## Back up');
  });

  it('copies code snippet to clipboard when clicking Copy button', async () => {
    renderDocs('/docs/backups-and-restore');

    const copyButtons = screen.getAllByRole('button', { name: /Copy code to clipboard/i });
    expect(copyButtons.length).toBeGreaterThan(0);

    const firstCopyButton = copyButtons[0];
    if (!firstCopyButton) {
      throw new Error('expected a copy button');
    }
    fireEvent.click(firstCopyButton);

    expect(writeTextSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/Copied!/i)).toBeInTheDocument();
    });
  });

  it('renders previous and next navigation buttons accurately', () => {
    renderDocs('/docs/going-public');

    const prevLink = screen.getByText('Previous').closest('a');
    expect(prevLink).toHaveAttribute('href', '/docs/deploying-on-coolify');

    const nextLink = screen.getByText('Next').closest('a');
    expect(nextLink).toHaveAttribute('href', '/docs/storage');
  });

  it('renders the "On this page" TOC rail with headings', () => {
    renderDocs('/docs/architecture');

    expect(screen.getByText(/On this page/i)).toBeInTheDocument();
    const tocLinks = document.querySelectorAll('aside a[href^="#"]');
    const hrefs = Array.from(tocLinks).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('#what-is-encrypted');
    expect(hrefs).toContain('#what-is-not-end-to-end-encrypted');
    expect(hrefs).toContain('#the-limits');
  });
});
