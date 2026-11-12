import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { Login } from './Login';
import { authClient } from '@/lib/auth-client';
import { clearAuthConfigCache } from '@/lib/auth-config';
import { APP_VERSION } from '@/lib/constants';
import { jsonResponse } from '@/test/http';

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: {
      social: vi.fn(),
      anonymous: vi.fn(),
    },
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Login Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthConfigCache();
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/api/auth/config')
          ? jsonResponse({
              devLoginEnabled: true,
              allowSignups: true,
              isFirstAccountSetup: false,
              providers: ['google', 'github', 'microsoft'],
            })
          : jsonResponse({ success: true }),
      ),
    );
  });

  const renderLogin = () =>
    render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>,
    );

  it('renders social authentication buttons and does not render email/password inputs', async () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /Welcome to CanvHQ/i })).toBeInTheDocument();
    expect(
      screen.getByText('Sign in or create an account with your work provider'),
    ).toBeInTheDocument();

    // Social buttons loaded from config
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue with GitHub/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue with Microsoft/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Terms and Conditions/i })).toHaveAttribute(
      'href',
      '/terms',
    );

    // Verify email and password inputs are completely absent
    expect(screen.queryByLabelText(/Work Email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/i)).not.toBeInTheDocument();

    // Dev login button
    expect(screen.getByRole('button', { name: /Login with Test Account/i })).toBeInTheDocument();
    expect(screen.getByText(`CanvHQ ${APP_VERSION}`)).toBeInTheDocument();
  });

  it('calls authClient.signIn.social when clicking Google button', async () => {
    vi.mocked(authClient.signIn.social).mockResolvedValueOnce({
      data: { url: '', redirect: false },
      error: null,
    });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));

    await waitFor(() => {
      expect(authClient.signIn.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: `${window.location.origin}/workspace`,
      });
    });
  });

  it('triggers dev login and navigates to /workspace on success', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: /Login with Test Account/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/dev-login'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'q@local.com', name: 'Qarib' }),
        }),
      );
      expect(mockNavigate).toHaveBeenCalledWith('/workspace');
    });
  });

  it('does not render OAuth buttons by default when no providers are configured on server (zero flicker)', async () => {
    clearAuthConfigCache();
    global.fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/api/auth/config')
            ? jsonResponse({ devLoginEnabled: true, providers: [] })
            : jsonResponse({}),
        ),
      );

    renderLogin();

    // Verify OAuth buttons are never shown
    expect(screen.queryByRole('button', { name: /Continue with Google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue with GitHub/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Continue with Microsoft/i }),
    ).not.toBeInTheDocument();
  });

  it('renders demo mode view with Try the demo button and explanation, hiding OAuth and dev login', async () => {
    clearAuthConfigCache();
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/api/auth/config')
          ? jsonResponse({
              demoMode: true,
              devLoginEnabled: false,
              allowSignups: true,
              isFirstAccountSetup: false,
              providers: [],
            })
          : jsonResponse({}),
      ),
    );

    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Try the demo/i })).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /Explore CanvHQ with a temporary throwaway account\. All data is wiped nightly\./i,
      ),
    ).toBeInTheDocument();

    // Verify OAuth and dev login are not shown
    expect(screen.queryByRole('button', { name: /Continue with Google/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Login with Test Account/i }),
    ).not.toBeInTheDocument();
  });

  describe('first account setup', () => {
    const withConfig = (config: Record<string, unknown>) => {
      clearAuthConfigCache();
      global.fetch = vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/api/auth/config')
            ? jsonResponse({
                devLoginEnabled: false,
                allowSignups: true,
                providers: [],
                ...config,
              })
            : jsonResponse({}),
        ),
      );
    };

    it('welcomes the person setting up a new instance, in plain words', async () => {
      withConfig({ isFirstAccountSetup: true, providers: ['google'] });
      renderLogin();

      expect(await screen.findByText('First Account Setup')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Welcome to your new CanvHQ instance. Sign in below to set up the initial administrator account.',
        ),
      ).toBeInTheDocument();
    });

    it('is never shown on a demo, even when the server says the instance is empty', async () => {
      withConfig({ demoMode: true, isFirstAccountSetup: true });
      renderLogin();

      expect(await screen.findByRole('button', { name: /Try the demo/i })).toBeInTheDocument();
      expect(screen.queryByText('First Account Setup')).not.toBeInTheDocument();
    });
  });

  it('calls authClient.signIn.anonymous and navigates on Try the demo click', async () => {
    clearAuthConfigCache();
    vi.mocked(authClient.signIn.anonymous).mockResolvedValueOnce({
      data: {
        token: 'demo-token',
        user: {
          id: 'u1',
          createdAt: new Date(),
          updatedAt: new Date(),
          email: 'demo@canvhq.local',
          emailVerified: false,
          name: 'Demo User',
          isAnonymous: true,
        },
      },
      error: null,
    });
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/api/auth/config')
          ? jsonResponse({
              demoMode: true,
              devLoginEnabled: false,
              allowSignups: true,
              isFirstAccountSetup: false,
              providers: [],
            })
          : jsonResponse({}),
      ),
    );

    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Try the demo/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Try the demo/i }));

    await waitFor(() => {
      expect(authClient.signIn.anonymous).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/workspace');
    });
  });

  it('displays error if demo sign-in fails with limit error', async () => {
    clearAuthConfigCache();
    vi.mocked(authClient.signIn.anonymous).mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Too many signups from this IP. Please try again later.',
        status: 403,
        statusText: 'Forbidden',
      },
    });
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/api/auth/config')
          ? jsonResponse({
              demoMode: true,
              devLoginEnabled: false,
              allowSignups: true,
              isFirstAccountSetup: false,
              providers: [],
            })
          : jsonResponse({}),
      ),
    );

    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Try the demo/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Try the demo/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Too many signups from this IP. Please try again later.'),
      ).toBeInTheDocument();
    });
  });

  it('shows first-account refusal message when redirected from OAuth with error in URL', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/login?error=This%20instance%20only%20accepts%20its%20first%20account%20from%20the%20address%20its%20operator%20set%20up.',
        ]}
      >
        <Login />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        'This instance only accepts its first account from the address its operator set up.',
      ),
    ).toBeInTheDocument();
  });
});
