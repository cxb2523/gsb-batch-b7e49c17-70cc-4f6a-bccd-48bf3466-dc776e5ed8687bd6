import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PublicFooter } from './PublicFooter';
import { APP_VERSION } from '@/lib/constants';

describe('PublicFooter Component', () => {
  it('renders current copyright year and company brand', () => {
    const currentYear = new Date().getFullYear();
    render(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    );

    expect(screen.getByText(`© ${currentYear} CanvHQ`)).toBeInTheDocument();
  });

  it('renders architecture badges and license specification', () => {
    render(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    );

    expect(screen.getByText('Self-hostable')).toBeInTheDocument();
    expect(screen.getByText('Open source')).toBeInTheDocument();
    expect(screen.getByText(`CanvHQ ${APP_VERSION}`)).toBeInTheDocument();
    expect(screen.getByText('Apache 2.0 Licensed')).toBeInTheDocument();
  });

  it('renders navigation links for Terms, Privacy, Security, and GitHub (BUG-FE-04)', () => {
    render(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    );

    const termsLink = screen.getByRole('link', { name: /terms/i });
    const privacyLink = screen.getByRole('link', { name: /privacy/i });
    const securityLink = screen.getByRole('link', { name: /security/i });
    const githubLink = screen.getByRole('link', { name: /github/i });

    expect(termsLink).toHaveAttribute('href', '/terms');
    expect(privacyLink).toHaveAttribute('href', '/privacy');
    expect(securityLink).toHaveAttribute('href', '/security');
    expect(githubLink).toHaveAttribute('href', expect.stringContaining('github.com'));
  });
});
