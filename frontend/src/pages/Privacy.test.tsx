import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Privacy } from './Privacy';
import { clearAuthConfigCache } from '@/lib/auth-config';

describe('Privacy Component (/privacy)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuthConfigCache();
  });

  it('renders rewritten Privacy Notice with honest sections and unset operator notice', () => {
    render(
      <BrowserRouter>
        <Privacy />
      </BrowserRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: /Privacy Notice/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Who runs this instance/i })).toBeInTheDocument();
    expect(
      screen.getByText(/The person who runs this instance has not published contact details/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Personal data stored/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /What is not stored in readable form/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Cookies/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Data retention/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Your rights/i })).toBeInTheDocument();
  });

  it('says what notifications hold, how long they are kept, and that they are exported', () => {
    render(
      <BrowserRouter>
        <Privacy />
      </BrowserRouter>,
    );

    expect(screen.getByText(/the short notices in your inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/never canvas content/i)).toBeInTheDocument();
    expect(screen.getByText(/purged after 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/memberships, and notifications/i)).toBeInTheDocument();
  });
});
