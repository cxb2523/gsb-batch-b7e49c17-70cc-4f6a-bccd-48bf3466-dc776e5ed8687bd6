import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { errorResponse, jsonResponse } from '@/test/http';
import { requestsTo, stubFetchRoutes, urlOf } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';
import { useProjects } from '@/features/projects/queries';
import { useAccessMe } from '@/features/workspaces/queries';
import { NotificationBell } from './NotificationBell';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/auth-client', () => ({ useSession: vi.fn() }));
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

function mockSession(signedIn: boolean) {
  const now = new Date();
  vi.mocked(useSession).mockReturnValue({
    data: signedIn
      ? {
          user: {
            id: 'u1',
            createdAt: now,
            updatedAt: now,
            email: 'u1@local.com',
            emailVerified: true,
            name: 'User',
            image: null,
            isAnonymous: false,
          },
          session: {
            id: 's1',
            token: 't1',
            userId: 'u1',
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + 86_400_000),
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
}

const joined = {
  id: 'n-joined',
  kind: 'invitation_accepted',
  workspaceId: 'w1',
  data: { workspaceName: 'Acme', personName: 'Ivy', projectsWaiting: 1 },
  readAt: null,
  createdAt: new Date().toISOString(),
};
const removed = {
  id: 'n-removed',
  kind: 'removed_from_workspace',
  workspaceId: 'w2',
  data: { workspaceName: 'Old Co' },
  readAt: null,
  createdAt: new Date().toISOString(),
};
const alreadyRead = {
  ...joined,
  id: 'n-read',
  readAt: new Date().toISOString(),
  data: { workspaceName: 'Acme', personName: 'Sam', projectsWaiting: 0 },
};

const onePage = (items: unknown[]) => ({
  items,
  pagination: {
    page: 1,
    limit: 20,
    total: items.length,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
});

function openBell() {
  fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows nothing to a visitor who is not signed in, and asks the server nothing', () => {
    mockSession(false);
    const fetchMock = stubFetchRoutes({});

    renderWithProviders(<NotificationBell />);

    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows how many are unread, and "9+" past nine', async () => {
    stubFetchRoutes({ 'GET /api/notifications/unread-count': () => jsonResponse({ count: 3 }) });
    const { unmount } = renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId('unread-count')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
    unmount();

    stubFetchRoutes({ 'GET /api/notifications/unread-count': () => jsonResponse({ count: 14 }) });
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByTestId('unread-count')).toHaveTextContent('9+');
  });

  it('shows no badge when everything is read', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 0 }),
    });
    renderWithProviders(<NotificationBell />);

    await waitFor(() =>
      expect(requestsTo(fetchMock, 'GET /api/notifications/unread-count')).toHaveLength(1),
    );
    expect(screen.queryByTestId('unread-count')).toBeNull();
  });

  it('does not read the inbox until it is opened, then lists it in words with the time', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 2 }),
      'GET /api/notifications': () => jsonResponse(onePage([joined, alreadyRead])),
    });
    renderWithProviders(<NotificationBell />);
    await screen.findByTestId('unread-count');
    expect(requestsTo(fetchMock, 'GET /api/notifications')).toHaveLength(0);

    openBell();

    expect(
      await screen.findByText('Ivy joined Acme. 1 project is waiting for you to grant access.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sam joined Acme.')).toBeInTheDocument();
    expect(screen.getAllByText(/Just now/)).toHaveLength(2);
    // Only the unread one says so
    expect(screen.getAllByText(/· unread/)).toHaveLength(1);
  });

  it('says so when there is nothing', async () => {
    stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 0 }),
      'GET /api/notifications': () => jsonResponse(onePage([])),
    });
    renderWithProviders(<NotificationBell />);

    openBell();

    expect(await screen.findByText(/Nothing new/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('marks one read and goes to where it can be acted on', async () => {
    let unreadAfterRead = 0;
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: unreadAfterRead || 1 }),
      'GET /api/notifications': () => jsonResponse(onePage([joined])),
      'POST /api/notifications/n-joined/read': () => {
        unreadAfterRead = 0;
        return jsonResponse({ id: 'n-joined' }, { status: 201 });
      },
    });
    renderWithProviders(<NotificationBell />);
    openBell();

    fireEvent.click(await screen.findByText(/Ivy joined Acme/));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/w/w1/management'));
    expect(requestsTo(fetchMock, 'POST /api/notifications/n-joined/read')).toHaveLength(1);
    // The panel closes behind the person
    expect(screen.queryByText('Mark all as read')).toBeNull();
  });

  it('reads the projects and rights again when one is opened, so the page it leads to is not stale', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 1 }),
      'GET /api/notifications': () => jsonResponse(onePage([joined])),
      'POST /api/notifications/n-joined/read': () => jsonResponse({ id: 'n-joined' }),
      'GET /api/projects': () => jsonResponse([]),
      'GET /api/access/me': () => jsonResponse({ canCreateWorkspace: false, rules: [] }),
    });
    // Stand-ins for the page behind the bell, which is where the stale data would show.
    function PageBehind() {
      useProjects('w1');
      useAccessMe('acme');
      return null;
    }
    renderWithProviders(
      <>
        <NotificationBell />
        <PageBehind />
      </>,
    );
    await waitFor(() => expect(requestsTo(fetchMock, 'GET /api/projects')).toHaveLength(1));
    await waitFor(() => expect(requestsTo(fetchMock, 'GET /api/access/me')).toHaveLength(1));
    openBell();

    fireEvent.click(await screen.findByText(/Ivy joined Acme/));

    await waitFor(() => expect(requestsTo(fetchMock, 'GET /api/projects')).toHaveLength(2));
    await waitFor(() => expect(requestsTo(fetchMock, 'GET /api/access/me')).toHaveLength(2));
  });

  it('does not mark one read again, and still goes where it points', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 0 }),
      'GET /api/notifications': () => jsonResponse(onePage([alreadyRead])),
    });
    renderWithProviders(<NotificationBell />);
    openBell();

    fireEvent.click(await screen.findByText('Sam joined Acme.'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/w/w1/management'));
    expect(requestsTo(fetchMock, 'POST /api/notifications/n-read/read')).toHaveLength(0);
  });

  it('marks a removal read but has nowhere to go, so the panel stays', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 1 }),
      'GET /api/notifications': () => jsonResponse(onePage([removed])),
      'POST /api/notifications/n-removed/read': () => jsonResponse({}, { status: 201 }),
    });
    renderWithProviders(<NotificationBell />);
    openBell();

    fireEvent.click(await screen.findByText('You were removed from Old Co.'));

    await waitFor(() =>
      expect(requestsTo(fetchMock, 'POST /api/notifications/n-removed/read')).toHaveLength(1),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Mark all as read')).toBeInTheDocument();
  });

  it('tells the person why when the server refuses to mark one read, and still goes on', async () => {
    stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 1 }),
      'GET /api/notifications': () => jsonResponse(onePage([joined])),
      'POST /api/notifications/n-joined/read': () =>
        errorResponse(404, 'NOT_FOUND', 'Notification not found'),
    });
    renderWithProviders(<NotificationBell />);
    openBell();

    fireEvent.click(await screen.findByText(/Ivy joined Acme/));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Notification not found'));
    expect(mockNavigate).toHaveBeenCalledWith('/w/w1/management');
  });

  it('marks everything read', async () => {
    let count = 2;
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count }),
      'GET /api/notifications': () => jsonResponse(onePage([joined, removed])),
      'POST /api/notifications/read-all': () => {
        count = 0;
        return jsonResponse({ updated: 2 }, { status: 201 });
      },
    });
    renderWithProviders(<NotificationBell />);
    await screen.findByTestId('unread-count');
    openBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(screen.queryByTestId('unread-count')).toBeNull());
    expect(requestsTo(fetchMock, 'POST /api/notifications/read-all')).toHaveLength(1);
  });

  it('tells the person why when marking everything read is refused', async () => {
    stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 2 }),
      'GET /api/notifications': () => jsonResponse(onePage([joined])),
      'POST /api/notifications/read-all': () => errorResponse(500, 'INTERNAL', 'Database is busy'),
    });
    renderWithProviders(<NotificationBell />);
    await screen.findByTestId('unread-count');
    openBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Database is busy'));
  });

  it('offers a retry when the inbox cannot be loaded', async () => {
    let failing = true;
    stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 1 }),
      'GET /api/notifications': () =>
        failing ? errorResponse(500, 'INTERNAL', 'Down') : jsonResponse(onePage([joined])),
    });
    renderWithProviders(<NotificationBell />);
    openBell();

    expect(await screen.findByText('Your notifications could not be loaded.')).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/Ivy joined Acme/)).toBeInTheDocument();
  });

  it('pages the inbox with Previous and Next once there is more than a page', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 25 }),
      'GET /api/notifications': () =>
        jsonResponse({
          items: [joined],
          pagination: {
            page: 1,
            limit: 20,
            total: 25,
            totalPages: 2,
            hasNextPage: true,
            hasPrevPage: false,
          },
        }),
    });
    renderWithProviders(<NotificationBell />);
    openBell();
    await screen.findByText(/Ivy joined Acme/);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(
        requestsTo(fetchMock, 'GET /api/notifications').some(([input]) =>
          urlOf(input).includes('page=2'),
        ),
      ).toBe(true),
    );
  });

  it('closes on Escape and on a click elsewhere', async () => {
    stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 0 }),
      'GET /api/notifications': () => jsonResponse(onePage([])),
    });
    renderWithProviders(
      <>
        <NotificationBell />
        <p>Elsewhere</p>
      </>,
    );

    openBell();
    expect(await screen.findByText('Mark all as read')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Mark all as read')).toBeNull();

    openBell();
    expect(await screen.findByText('Mark all as read')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Elsewhere'));
    expect(screen.queryByText('Mark all as read')).toBeNull();
  });

  it('lists each notification as a button inside a list', async () => {
    stubFetchRoutes({
      'GET /api/notifications/unread-count': () => jsonResponse({ count: 2 }),
      'GET /api/notifications': () => jsonResponse(onePage([joined, removed])),
    });
    renderWithProviders(<NotificationBell />);
    openBell();

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('button')).toHaveLength(2);
  });
});
