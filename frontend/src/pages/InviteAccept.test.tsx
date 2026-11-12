import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { InviteAccept } from './InviteAccept';
import { signOut, useSession } from '@/lib/auth-client';
import { clearLocalKeyMaterial } from '@/lib/key-store';
import { clearAuthConfigCache } from '@/lib/auth-config';
import { jsonResponse, errorResponse } from '@/test/http';
import { stubFetchRoutes, requestsTo } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

const keyState = vi.hoisted(() => ({ isInitialized: null as boolean | null }));
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ isInitialized: keyState.isInitialized }),
}));
vi.mock('@/lib/key-store', () => ({ clearLocalKeyMaterial: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  authClient: {
    signIn: {
      social: vi.fn(),
    },
  },
}));

const sessionUser = (name: string, email: string) => ({
  id: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  email,
  emailVerified: true,
  name,
  image: null,
  isAnonymous: false,
});

const mockSession = (user: ReturnType<typeof sessionUser> | null) => {
  vi.mocked(useSession).mockReturnValue({
    data: user
      ? {
          user,
          session: {
            id: 'session-1',
            token: 'token-1',
            userId: user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: new Date(Date.now() + 86_400_000),
            ipAddress: null,
            userAgent: null,
            activeOrganizationId: null,
          },
        }
      : null,
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  });
};

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ inviteId: 'inv_123' }),
    useNavigate: () => mockNavigate,
  };
});

const pendingInvitation = {
  id: 'inv_123',
  organization: { id: 'org_1', name: 'Engineering Core', slug: 'engineering-core' },
  role: 'editor',
  inviterName: 'Qarib',
  status: 'pending',
};
const acceptedResult = { success: true, workspaceSlug: 'engineering-core' };
const forThisAccount = () => jsonResponse({ isRecipient: true });
const forAnotherAccount = () => jsonResponse({ isRecipient: false });

describe('InviteAccept Component', () => {
  beforeEach(() => {
    clearAuthConfigCache();
    keyState.isInitialized = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders invitation details and social login options when unauthenticated', async () => {
    mockSession(null);
    stubFetchRoutes({
      'GET /api/auth/config': () =>
        jsonResponse({ devLoginEnabled: true, providers: ['google', 'github', 'microsoft'] }),
      'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
    });

    renderWithProviders(<InviteAccept />);

    expect(await screen.findByText('Engineering Core')).toBeInTheDocument();
    expect(screen.getByText(/Invited by Qarib/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Continue with Google/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accept with Test Account/i })).toBeInTheDocument();
  });

  it('auto-accepts invitation and navigates to workspace when user is authenticated', async () => {
    mockSession(sessionUser('Alice', 'alice@local.com'));
    const fetchMock = stubFetchRoutes({
      'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
      'GET /api/invitations/inv_123/recipient': forThisAccount,
      'POST /api/invitations/inv_123/accept': () => jsonResponse(acceptedResult),
    });

    renderWithProviders(<InviteAccept />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/w/engineering-core'));
    expect(requestsTo(fetchMock, 'POST /api/invitations/inv_123/accept')).toHaveLength(1);
  });

  it('uses the server status instead of an isExpired flag and never accepts a revoked link', async () => {
    mockSession(sessionUser('Alice', 'alice@local.com'));
    const fetchMock = stubFetchRoutes({
      'GET /api/auth/config': () => jsonResponse({ devLoginEnabled: true, providers: [] }),
      'GET /api/invitations/inv_123': () =>
        jsonResponse({ ...pendingInvitation, status: 'revoked' }),
    });

    renderWithProviders(<InviteAccept />);

    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    expect(requestsTo(fetchMock, 'POST /api/invitations/inv_123/accept')).toHaveLength(0);
  });

  it('accepts with no body, so no key can be posted', async () => {
    mockSession(sessionUser('Alice', 'alice@local.com'));
    const fetchMock = stubFetchRoutes({
      'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
      'GET /api/invitations/inv_123/recipient': forThisAccount,
      'POST /api/invitations/inv_123/accept': () => jsonResponse(acceptedResult),
    });

    renderWithProviders(<InviteAccept />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/w/engineering-core'));

    const [, init] = requestsTo(fetchMock, 'POST /api/invitations/inv_123/accept')[0] ?? [];
    expect(init?.body).toBeUndefined();
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['content-type']).toBeUndefined();
    expect(headers?.['x-encrypted-org-key']).toBeUndefined();
  });

  it('shows the server message and a retry when the invitation cannot be loaded', async () => {
    mockSession(null);
    let found = false;
    stubFetchRoutes({
      'GET /api/auth/config': () => jsonResponse({ devLoginEnabled: false, providers: [] }),
      'GET /api/invitations/inv_123': () =>
        found
          ? jsonResponse(pendingInvitation)
          : errorResponse(404, 'NOT_FOUND', 'This invitation does not exist'),
    });

    renderWithProviders(<InviteAccept />);

    expect(await screen.findByText('This invitation does not exist')).toBeInTheDocument();
    found = true;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Engineering Core')).toBeInTheDocument();
  });

  it('shows the server error and lets the user retry when accepting fails', async () => {
    mockSession(sessionUser('Alice', 'alice@local.com'));
    stubFetchRoutes({
      'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
      'GET /api/invitations/inv_123/recipient': forThisAccount,
      'POST /api/invitations/inv_123/accept': () =>
        errorResponse(403, 'FORBIDDEN', 'This invitation was sent to another email address'),
    });

    renderWithProviders(<InviteAccept />);

    expect(
      await screen.findByText('This invitation was sent to another email address'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept & Enter Workspace' })).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalledWith('/w/engineering-core');
  });

  describe('an account the invitation was not sent to', () => {
    const wrongAccountRoutes = {
      'GET /api/invitations/inv_123': () =>
        jsonResponse({ ...pendingInvitation, emailHint: 'q***@gmail.com' }),
      'GET /api/invitations/inv_123/recipient': forAnotherAccount,
      'POST /api/invitations/inv_123/accept': () => jsonResponse(acceptedResult),
    };

    it('is stopped with a clear message that hints at the right account, and nothing is accepted', async () => {
      mockSession(sessionUser('Colleague', 'colleague@local.com'));
      const fetchMock = stubFetchRoutes(wrongAccountRoutes);

      renderWithProviders(<InviteAccept />);

      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent('sent to a different account');
      expect(notice).toHaveTextContent('q***@gmail.com');
      expect(notice).toHaveTextContent('colleague@local.com');
      expect(screen.queryByRole('button', { name: 'Accept & Enter Workspace' })).toBeNull();
      expect(requestsTo(fetchMock, 'POST /api/invitations/inv_123/accept')).toHaveLength(0);
    });

    it('is not sent to set up a passphrase first', async () => {
      keyState.isInitialized = false;
      mockSession(sessionUser('Colleague', 'colleague@local.com'));
      stubFetchRoutes(wrongAccountRoutes);

      renderWithProviders(<InviteAccept />);

      await screen.findByRole('alert');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('signs out, clears the keys on this device and comes back to the invitation', async () => {
      const { origin, port } = window.location;
      const location = { origin, port, href: '' };
      vi.stubGlobal('location', location);
      mockSession(sessionUser('Colleague', 'colleague@local.com'));
      stubFetchRoutes(wrongAccountRoutes);

      renderWithProviders(<InviteAccept />);
      fireEvent.click(
        await screen.findByRole('button', { name: /Sign out and use another account/i }),
      );

      await waitFor(() => expect(location.href).toBe('/invite/inv_123'));
      expect(clearLocalKeyMaterial).toHaveBeenCalledTimes(1);
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('asks for the passphrase only once the invitation is confirmed to be for this account', async () => {
    keyState.isInitialized = false;
    mockSession(sessionUser('Alice', 'alice@local.com'));
    stubFetchRoutes({
      'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
      'GET /api/invitations/inv_123/recipient': forThisAccount,
    });

    renderWithProviders(<InviteAccept />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/setup-passphrase?next=%2Finvite%2Finv_123', {
        replace: true,
      }),
    );
  });

  it.each([
    ['not known yet', null],
    ['not set up', false],
  ])(
    'does not accept the invitation while the passphrase is %s',
    async (_description, isInitialized) => {
      keyState.isInitialized = isInitialized;
      mockSession(sessionUser('Alice', 'alice@local.com'));
      const fetchMock = stubFetchRoutes({
        'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
        'GET /api/invitations/inv_123/recipient': forThisAccount,
        'POST /api/invitations/inv_123/accept': () => jsonResponse(acceptedResult),
      });

      renderWithProviders(<InviteAccept />);

      await waitFor(() =>
        expect(requestsTo(fetchMock, 'GET /api/invitations/inv_123/recipient')).toHaveLength(1),
      );
      // Give an accept, if one were going to happen, the time to happen.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(requestsTo(fetchMock, 'POST /api/invitations/inv_123/accept')).toHaveLength(0);
      expect(mockNavigate).not.toHaveBeenCalledWith('/w/engineering-core');
    },
  );

  it('does not go on, and offers a retry, when the check itself fails', async () => {
    mockSession(sessionUser('Alice', 'alice@local.com'));
    let answering = false;
    const fetchMock = stubFetchRoutes({
      'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
      'GET /api/invitations/inv_123/recipient': () =>
        answering ? forThisAccount() : errorResponse(500, 'INTERNAL', 'Check is down'),
      'POST /api/invitations/inv_123/accept': () => jsonResponse(acceptedResult),
    });

    renderWithProviders(<InviteAccept />);

    expect(await screen.findByText('Could not check this invitation')).toBeInTheDocument();
    expect(requestsTo(fetchMock, 'POST /api/invitations/inv_123/accept')).toHaveLength(0);

    answering = true;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/w/engineering-core'));
  });

  it('shows the server error when the test-account login fails', async () => {
    mockSession(null);
    stubFetchRoutes({
      'GET /api/auth/config': () => jsonResponse({ devLoginEnabled: true, providers: [] }),
      'GET /api/invitations/inv_123': () => jsonResponse(pendingInvitation),
      'POST /api/auth/dev-login': () => errorResponse(403, 'FORBIDDEN', 'Dev login is disabled'),
    });

    renderWithProviders(<InviteAccept />);

    fireEvent.click(await screen.findByRole('button', { name: /Accept with Test Account/i }));

    expect(await screen.findByText('Dev login is disabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accept with Test Account/i })).toBeEnabled();
  });
});
