import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { PublicHeader } from './PublicHeader';

describe('PublicHeader Component', () => {
  it('renders brand logo and title linked to root /', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>,
    );

    const brandLink = screen.getByRole('link', { name: /CanvHQ/i });
    expect(brandLink).toBeInTheDocument();
    expect(brandLink).toHaveAttribute('href', '/');
  });

  it('renders breadcrumb with slash separator when breadcrumb prop is provided', () => {
    render(
      <MemoryRouter>
        <PublicHeader breadcrumb={<span data-testid="crumb">Security Architecture</span>} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('crumb')).toBeInTheDocument();
    expect(screen.getByText('Security Architecture')).toBeInTheDocument();
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('does not render breadcrumb separator when breadcrumb prop is omitted', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>,
    );

    expect(screen.queryByText('/')).not.toBeInTheDocument();
  });

  it('renders rightSlot elements such as navigation links, sign in and sign up buttons', () => {
    render(
      <MemoryRouter>
        <PublicHeader
          rightSlot={
            <>
              <Link to="/docs" className="active">
                Documentation
              </Link>
              <Link to="/login">Sign In</Link>
              <Link to="/login" data-testid="signup-btn">
                Get Started
              </Link>
            </>
          }
        />
      </MemoryRouter>,
    );

    const docsLink = screen.getByRole('link', { name: 'Documentation' });
    const signInLink = screen.getByRole('link', { name: 'Sign In' });
    const getStartedLink = screen.getByRole('link', { name: 'Get Started' });

    expect(docsLink).toBeInTheDocument();
    expect(docsLink).toHaveAttribute('href', '/docs');
    expect(docsLink).toHaveClass('active');

    expect(signInLink).toBeInTheDocument();
    expect(signInLink).toHaveAttribute('href', '/login');

    expect(getStartedLink).toBeInTheDocument();
    expect(getStartedLink).toHaveAttribute('href', '/login');
  });

  it('applies fixed positioning classes when fixed prop is true', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicHeader fixed={true} />
      </MemoryRouter>,
    );

    const header = container.querySelector('header');
    expect(header).toBeInTheDocument();
    expect(header?.className).toContain('fixed');
    expect(header?.className).toContain('top-0');
  });

  it('applies standard static width classes when fixed prop is false or omitted', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicHeader fixed={false} />
      </MemoryRouter>,
    );

    const header = container.querySelector('header');
    expect(header).toBeInTheDocument();
    expect(header?.className).toContain('w-full');
    expect(header?.className).not.toContain('fixed');
  });

  it('renders built-in navigation links and active route state highlighting when rightSlot is omitted (BUG-FE-02)', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <PublicHeader />
      </MemoryRouter>,
    );

    const docsLink = screen.getByRole('link', { name: /docs|documentation/i });
    expect(docsLink).toBeInTheDocument();
    expect(docsLink).toHaveClass('active');
  });

  it('renders built-in Sign In and Sign Up buttons when rightSlot is omitted (BUG-FE-03)', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /sign in|log in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /get started|sign up/i })).toBeInTheDocument();
  });

  it('hides built-in auth buttons when hideAuthActions is true or route is /create-workspace or /setup-passphrase', () => {
    const { unmount } = render(
      <MemoryRouter>
        <PublicHeader hideAuthActions={true} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /sign in|log in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /get started|sign up/i })).not.toBeInTheDocument();

    unmount();

    render(
      <MemoryRouter initialEntries={['/create-workspace']}>
        <PublicHeader />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /sign in|log in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /get started|sign up/i })).not.toBeInTheDocument();
  });
});
