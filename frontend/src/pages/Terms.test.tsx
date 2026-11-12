import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Terms } from './Terms';
import { clearAuthConfigCache } from '@/lib/auth-config';

describe('Terms Component', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuthConfigCache();
  });

  it('links the open-source licences file', () => {
    render(
      <BrowserRouter>
        <Terms />
      </BrowserRouter>,
    );

    expect(screen.getByRole('link', { name: /open-source licences file/i })).toHaveAttribute(
      'href',
      '/THIRD_PARTY_LICENSES.txt',
    );
  });

  it('renders Terms and Conditions with rewritten honest sections', () => {
    render(
      <BrowserRouter>
        <Terms />
      </BrowserRouter>,
    );

    expect(screen.getByRole('heading', { name: /Terms and Conditions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Instance operator/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Open-source and self-hosting/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Your passphrase and your canvases/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Workspace ownership/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Software provided as-is/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Sign In/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
