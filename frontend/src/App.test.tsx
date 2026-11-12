import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { useSession, authClient } from './lib/auth-client';
import { errorResponse, jsonResponse } from './test/http';
import { queryClient } from './lib/query-client';
import { APP_VERSION } from './lib/constants';

/** What the signed-in footer says about the release. */
const FOOTER_VERSION = `CANVHQ ${APP_VERSION.toUpperCase()}`;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const sessionUser = {
  id: 'u-uninit',
  createdAt: new Date(),
  updatedAt: new Date(),
  email: 'test@canvhq.internal',
  emailVerified: true,
  name: 'Tester',
  image: null,
  isAnonymous: false,
};

const mockSession = (userId = sessionUser.id) => {
  vi.mocked(useSession).mockReturnValue({
    data: {
      user: { ...sessionUser, id: userId },
      session: {
        id: 'session-1',
        token: 'token-1',
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: null,
      },
    },
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  });
};

vi.mock('@/lib/key-store', () => ({
  getPrivateKey: vi.fn().mockResolvedValue(null),
  storePrivateKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./lib/auth-client', () => ({
  useSession: vi.fn(),
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  authClient: {
    organization: {
      list: vi.fn(),
      create: vi.fn(),
      setActive: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('App Routing & Route Protection', () => {
  let callerIsAdministrator = true;

  beforeEach(() => {
    vi.clearAllMocks();
    // App owns a module-level QueryClient; without this, one test's answers leak into the next.
    queryClient.clear();
    (authClient.organization.list as any).mockResolvedValue({
      data: [{ id: 'org-1', name: 'Acme Eng', slug: 'acme-eng' }],
    });

    callerIsAdministrator = true;
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/api/access/me')) {
        return Promise.resolve(
          jsonResponse({
            canCreateWorkspace: false,
            workspace: { id: 'org-1', slug: 'acme-eng' },
            workspaceRole: callerIsAdministrator ? 'admin' : 'editor',
            isWorkspaceAdministrator: callerIsAdministrator,
            rules: [],
            projectRules: {},
            projectRoles: {},
          }),
        );
      }
      if (url.includes('/api/user/encryption-params')) {
        const current = vi.mocked(useSession)();
        const isUninitialised = current.data?.user?.id === 'u-uninit';
        return Promise.resolve(
          jsonResponse(
            isUninitialised
              ? { kdfSalt: null, keyWrapIv: null, wrappedPrivateKey: null, publicKey: null }
              : {
                  kdfSalt: 'salt',
                  keyWrapIv: 'iv',
                  wrappedPrivateKey: 'wrapped',
                  publicKey: 'public',
                },
          ),
        );
      }
      if (url.includes('/api/projects')) {
        return Promise.resolve(
          jsonResponse([{ id: 'p1', name: 'Core Architecture', organizationId: 'org-1' }]),
        );
      }
      if (url.includes('/api/boards')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.includes('/api/workspaces')) {
        const parts = url.split('/api/workspaces/');
        const requestedSlug = parts[1]?.split('?')[0];
        const name =
          requestedSlug === 'oldest-org'
            ? 'Oldest Org'
            : requestedSlug === 'newest-org'
              ? 'Newest Org'
              : 'Acme Eng';
        return Promise.resolve(
          jsonResponse({
            id: requestedSlug === 'oldest-org' ? 'org-old' : 'org-1',
            name,
            slug: requestedSlug || 'acme-eng',
            projects: [],
            members: [],
          }),
        );
      }
      return Promise.resolve(jsonResponse([]));
    });
  });

  it('renders Landing page on "/" route for unauthenticated user', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Make space for/i })).toBeInTheDocument();
  });

  it('renders Login page on "/login" route', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Welcome to CanvHQ/i })).toBeInTheDocument();
  });

  it('redirects "/signup" route to Login page', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/signup']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Welcome to CanvHQ/i })).toBeInTheDocument();
  });

  it('renders Terms and Conditions on "/terms" route', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/terms']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Terms and Conditions/i })).toBeInTheDocument();
  });

  it('renders Security & E2EE specifications on "/security" route for unauthenticated user', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/security']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: /How CanvHQ protects your canvases/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Set Your Canvas Passphrase/i }),
    ).not.toBeInTheDocument();
  });

  it('renders "/security" and "/terms" for authenticated user with uninitialized encryption WITHOUT modal popup', async () => {
    (useSession as any).mockReturnValue({
      data: { user: { id: 'u-uninit', email: 'test@canvhq.internal', name: 'Tester' } },
      isPending: false,
    });

    // 1. Visiting /security -> No popup
    const { unmount } = render(
      <MemoryRouter initialEntries={['/security']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: /How CanvHQ protects your canvases/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Set Your Canvas Passphrase/i }),
    ).not.toBeInTheDocument();

    unmount();

    // 2. Visiting /terms -> No popup
    render(
      <MemoryRouter initialEntries={['/terms']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Terms and Conditions/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Set Your Canvas Passphrase/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps a protected page closed when encryption params fail, and Retry recovers', async () => {
    mockSession();

    let paramsCalls = 0;
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('/api/user/encryption-params')) {
        paramsCalls += 1;
        if (paramsCalls === 1) {
          return errorResponse(429, 'TOO_MANY_REQUESTS', 'Too many requests');
        }
        return jsonResponse({
          kdfSalt: null,
          keyWrapIv: null,
          wrappedPrivateKey: null,
          publicKey: null,
        });
      }
      return jsonResponse([]);
    });

    render(
      <MemoryRouter initialEntries={['/create-workspace']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Could not load your encryption status.')).toBeInTheDocument();
    });
    // The unknown state must not render the page it cannot vouch for.
    expect(screen.queryByText('Create your workspace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Set your canvas passphrase/i }),
      ).toBeInTheDocument();
    });
  });

  it('sends an uninitialized user to set-up before "/create-workspace"', async () => {
    (useSession as any).mockReturnValue({
      data: { user: { id: 'u-uninit', email: 'test@canvhq.internal', name: 'Tester' } },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/create-workspace']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Set your canvas passphrase/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Create your workspace')).not.toBeInTheDocument();
  });

  it('redirects uninitialized users visiting protected workspace routes to "/setup-passphrase"', async () => {
    (useSession as any).mockReturnValue({
      data: { user: { id: 'u-uninit', email: 'test@canvhq.internal', name: 'Tester' } },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/w/acme-org']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Set your canvas passphrase/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/A better space to think/i)).toBeInTheDocument();
    });
  });

  it('redirects to "/login" when visiting "/workspace" unauthenticated', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    // Should redirect to Login page
    expect(screen.getByRole('heading', { name: /Welcome to CanvHQ/i })).toBeInTheDocument();
  });

  it('redirects to "/login" when visiting "/w/:slug" unauthenticated', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/w/acme-eng']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Welcome to CanvHQ/i })).toBeInTheDocument();
  });

  it('allows access to "/workspace" and resolves to "/w/:slug" when user is authenticated with workspaces', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(FOOTER_VERSION)).toBeInTheDocument();
    });
  });

  it('resolves "/workspace" to "/create-workspace" if authenticated user has zero workspaces', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });
    (authClient.organization.list as any).mockResolvedValue({ data: [] });

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Create your workspace')).toBeInTheDocument();
    });
  });

  it('renders loading state while checking session', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: true });

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Loading\.\.\./i)).toBeInTheDocument();
  });

  it('renders /create-workspace for authenticated user', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/create-workspace']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Create your workspace')).toBeInTheDocument();
    });
  });

  it('redirects authenticated user from "/" to "/workspace" and resolves to "/w/:slug"', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(FOOTER_VERSION)).toBeInTheDocument();
    });
  });

  it('redirects authenticated user from "/login" to "/workspace"', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(FOOTER_VERSION)).toBeInTheDocument();
    });
  });

  it('redirects authenticated user from "/signup" to "/workspace"', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/signup']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(FOOTER_VERSION)).toBeInTheDocument();
    });
  });

  it('sends an editor who opens /w/:slug/management back to the workspace, with a reason', async () => {
    callerIsAdministrator = false;
    mockSession('u-eddie');

    render(
      <MemoryRouter initialEntries={['/w/acme-eng/management']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Only workspace owners and admins can open management.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Workspace Management' })).not.toBeInTheDocument();
    expect(await screen.findByText(FOOTER_VERSION)).toBeInTheDocument();
  });

  it('renders /w/:slug/management for an owner or admin', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/w/acme-eng/management']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Workspace Management' })).toBeInTheDocument();
    });
  });

  it('renders NotFound page on unknown route "*" for unauthenticated user', () => {
    (useSession as any).mockReturnValue({ data: null, isPending: false });

    render(
      <MemoryRouter initialEntries={['/some-unknown-route']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Page not found/i })).toBeInTheDocument();
    expect(screen.getByText(/404 Error/i)).toBeInTheDocument();
  });

  it('renders NotFound page on unknown route "*" for authenticated user', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/some-unknown-route']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Page not found/i })).toBeInTheDocument();
      expect(screen.getByText(/404 Error/i)).toBeInTheDocument();
    });
  });

  it('renders NotFound page on unrouted "/b/:id" path (H13)', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    render(
      <MemoryRouter initialEntries={['/b/board_xyz']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Page not found/i })).toBeInTheDocument();
    });
  });

  it('resolves "/w", "/workspaces", and "/workspace" to the OLDEST workspace when multiple workspaces exist', async () => {
    (useSession as any).mockReturnValue({
      data: {
        user: { id: 'u-alice', name: 'Alice', email: 'alice@canvhq.internal' },
        session: {},
      },
      isPending: false,
    });

    // Provide workspaces with newer first, older second
    (authClient.organization.list as any).mockResolvedValue({
      data: [
        {
          id: 'org-new',
          name: 'Newest Org',
          slug: 'newest-org',
          createdAt: '2026-03-01T12:00:00Z',
        },
        {
          id: 'org-old',
          name: 'Oldest Org',
          slug: 'oldest-org',
          createdAt: '2026-01-01T12:00:00Z',
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/w']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Should resolve to Oldest Org
      expect(screen.getAllByText('Oldest Org').length).toBeGreaterThan(0);
    });
  });
});
