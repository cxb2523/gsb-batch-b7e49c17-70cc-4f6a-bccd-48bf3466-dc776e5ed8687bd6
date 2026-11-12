import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, type NavigateOptions, type To } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import { Workspace } from './Workspace';
import { signOut } from '@/lib/auth-client';
import { APP_VERSION } from '@/lib/constants';
import { errorResponse, jsonResponse } from '@/test/http';

function buildPackedRules(
  callback: (can: (action: string | string[], subject: string | string[]) => void) => void,
) {
  const { can, build } = new AbilityBuilder<MongoAbility>(createMongoAbility);
  callback(can);
  return packRules(build().rules);
}

const ownerWorkspaceRules = buildPackedRules((can) => {
  can('read', 'Workspace');
  can('update', 'Workspace');
  can('delete', 'Workspace');
  can('transfer', 'Workspace');
  can(['create', 'read', 'delete'], 'Invitation');
  can(['read', 'create', 'update', 'delete'], 'Project');
  can('read', 'Member');
  can('update', 'Member');
  can('delete', 'Member');
  can('manage', 'ProjectMember');
  can(['read', 'create', 'update', 'delete', 'share'], 'Board');
});

const editorProjectRules = buildPackedRules((can) => {
  can('read', 'Project');
  can(['read', 'create', 'update', 'delete', 'share'], 'Board');
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// Handles to the auth client's stubs, so a test can script them without casting the real client's types.
const authStubs = vi.hoisted(() => ({
  useSession: vi.fn(),
  listOrganizations: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: authStubs.useSession,
  signOut: vi.fn(),
  authClient: {
    organization: {
      list: authStubs.listOrganizations,
      create: vi.fn(),
      setActive: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('@/lib/keys', () => ({
  resolveOrgKey: vi.fn().mockResolvedValue({}),
  resolveProjectKey: vi.fn().mockResolvedValue({}),
  prepareProjectGrant: vi.fn().mockResolvedValue({ encryptedProjectKey: 'wrapped-for-target' }),
  provisionProjectKeys: vi.fn().mockResolvedValue({
    id: 'p-new',
    name: 'Project',
    encryptedProjectKey: 'wrapped-project-key',
    creatorEncryptedProjectKey: 'wrapped-creator-project-key',
  }),
  provisionBoardKeys: vi
    .fn()
    .mockResolvedValue({ boardKey: {}, encryptedBoardKey: 'wrapped-board-key' }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => {
      const realNavigate = actual.useNavigate();
      return (to: To, options?: NavigateOptions) => {
        if (options !== undefined) {
          mockNavigate(to, options);
        } else {
          mockNavigate(to);
        }
        return realNavigate(to, options);
      };
    },
  };
});

type Route = (url: string, init: RequestInit | undefined) => Response | undefined;

const isWrite = (init: RequestInit | undefined, method: string) => init?.method === method;

const ownerAccess = (slug: string) =>
  jsonResponse({
    canCreateWorkspace: true,
    workspace: { id: slug === 'core-platform' ? 'org-2' : 'org-1', name: slug, slug },
    workspaceRole: 'owner',
    isWorkspaceAdministrator: true,
    rules: ownerWorkspaceRules,
    projectRules: { admin: ownerWorkspaceRules },
    projectRoles: { p1: 'admin' },
  });

function defaultRoute(url: string): Response {
  if (url.includes('/api/workspaces/')) {
    const slug = url.split('/api/workspaces/')[1]?.split('?')[0] || 'acme-eng';
    let name = 'Acme Eng';
    let id = 'org-1';
    if (slug === 'alpha-old' || slug === 'org-older') {
      name = 'Alpha Infrastructure (Old)';
      id = 'org-older';
    } else if (slug === 'core-platform' || slug === 'org-2') {
      name = 'Core Platform';
      id = 'org-2';
    }
    return jsonResponse({ id, name, slug, currentUserRole: 'owner', keyVersion: 1 });
  }
  if (url.includes('/api/projects')) {
    return jsonResponse([
      {
        id: 'p1',
        name: 'Core Architecture',
        organizationId: 'org-1',
        keyVersion: 1,
        _count: { boards: 1 },
      },
    ]);
  }
  if (url.includes('/api/boards')) {
    return jsonResponse([
      {
        id: 'b1',
        title: 'Topology Mesh Architecture',
        projectId: 'p1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  }
  if (url.includes('/api/access/me')) {
    const parts = url.split('workspace=')[1]?.split('&')[0];
    return ownerAccess(parts ? decodeURIComponent(parts) : 'acme-eng');
  }
  return jsonResponse([]);
}

/** Answers with the first route that returns a response, then with the default dashboard data. */
function stubApi(...routes: Route[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    return defaultRoute(url);
  });
}

describe('Workspace Dashboard Component', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    authStubs.useSession.mockReturnValue({
      data: {
        user: { id: 'u-dev-lead', name: 'Dev Lead', email: 'lead@canvhq.internal' },
        session: { id: 'sess-1' },
      },
    });
    authStubs.listOrganizations.mockResolvedValue({
      data: [
        { id: 'org-1', name: 'Acme Eng', slug: 'acme-eng', role: 'owner' },
        { id: 'org-2', name: 'Core Platform', slug: 'core-platform', role: 'owner' },
      ],
    });
    stubApi();
  });

  const renderWorkspace = (initialPath = '/w/acme-eng') =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/w/:slug" element={<Workspace />} />
            <Route path="/create-workspace" element={<div>Create Workspace Page</div>} />
            <Route path="/login" element={<div>Login Page</div>} />
            <Route path="/w/:slug/canvas/:id" element={<div>Canvas Page</div>} />
          </Routes>
        </MemoryRouter>
        <Toaster />
      </QueryClientProvider>,
    );

  it('renders header, breadcrumb, and boards cleanly', async () => {
    renderWorkspace();
    expect(screen.getByText('CanvHQ')).toBeInTheDocument();
    expect(screen.getByText(`CANVHQ ${APP_VERSION.toUpperCase()}`)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Acme Eng').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Core Architecture').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
    });
  });

  it('redirects to /create-workspace if user has zero workspaces', async () => {
    authStubs.listOrganizations.mockResolvedValue({ data: [] });

    renderWorkspace();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/create-workspace');
    });
  });

  it('opens clean workspace switcher without fake URLs and navigates to create workspace', async () => {
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Acme Eng').length).toBeGreaterThan(0);
    });

    const switcherTrigger = screen.getByRole('button', { name: /Acme Eng/i });
    fireEvent.click(switcherTrigger);

    expect(screen.getByText('Core Platform')).toBeInTheDocument();
    expect(screen.queryByText(/acme-eng\.canvhq\.internal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/core-platform\.canvhq\.internal/i)).not.toBeInTheDocument();

    const createBtn = screen.getByRole('button', { name: /Create Workspace/i });
    fireEvent.click(createBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/create-workspace');
  });

  it('sorts workspaces in switcher from oldest to newest', async () => {
    authStubs.listOrganizations.mockResolvedValue({
      data: [
        {
          id: 'org-newer',
          name: 'Zeta Project (New)',
          slug: 'zeta-new',
          createdAt: '2026-05-01T00:00:00Z',
        },
        {
          id: 'org-older',
          name: 'Alpha Infrastructure (Old)',
          slug: 'alpha-old',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'org-mid',
          name: 'Beta Mesh (Mid)',
          slug: 'beta-mid',
          createdAt: '2026-03-01T00:00:00Z',
        },
      ],
    });

    renderWorkspace('/w/alpha-old');

    await waitFor(() => {
      expect(screen.getAllByText('Alpha Infrastructure (Old)').length).toBeGreaterThan(0);
    });

    const switcherTrigger = screen.getByRole('button', { name: /Alpha Infrastructure \(Old\)/i });
    fireEvent.click(switcherTrigger);

    const buttons = screen.getAllByRole('button');
    const orgButtons = buttons.filter(
      (b) =>
        b.textContent?.includes('Alpha Infrastructure') ||
        b.textContent?.includes('Beta Mesh') ||
        b.textContent?.includes('Zeta Project'),
    );
    const popoverButtons = orgButtons.slice(1);

    // Should be in order: Alpha (Jan), Beta (Mar), Zeta (May)
    expect(popoverButtons[0]?.textContent).toContain('Alpha Infrastructure (Old)');
    expect(popoverButtons[1]?.textContent).toContain('Beta Mesh (Mid)');
    expect(popoverButtons[2]?.textContent).toContain('Zeta Project (New)');
  });

  it('provides navigation link to Workspace Management on sidebar and top nav', async () => {
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Acme Eng').length).toBeGreaterThan(0);
    });

    const managementLinks = screen.getAllByRole('link', { name: /Management/i });
    expect(managementLinks.length).toBeGreaterThan(0);
    expect(managementLinks[0]).toHaveAttribute('href', '/w/acme-eng/management');
  });

  it('does not offer Workspace Management to an editor', async () => {
    stubApi((url) => {
      if (url.includes('/api/access/me')) {
        return jsonResponse({
          canCreateWorkspace: false,
          workspace: { id: 'org-1', name: 'Acme Eng', slug: 'acme-eng' },
          workspaceRole: 'editor',
          isWorkspaceAdministrator: false,
          rules: [],
          projectRules: { editor: editorProjectRules },
          projectRoles: { p1: 'editor' },
        });
      }
      return undefined;
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Core Architecture').length).toBeGreaterThan(0);
    });
    await waitFor(() => expect(screen.getByTestId('role-badge')).toHaveTextContent(/editor/i));

    expect(screen.queryByRole('link', { name: /Management/i })).not.toBeInTheDocument();
  });

  it('opens Command+K board search modal and filters boards by title', async () => {
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByTitle('Search (⌘K)'));

    expect(screen.getByPlaceholderText(/Search by title or project/i)).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search by title or project/i);
    fireEvent.change(searchInput, { target: { value: 'Mesh' } });

    expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(1);

    fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });
    expect(screen.getByText(/No results found for/i)).toBeInTheDocument();
  });

  it('logs out and redirects to /login when clicking signout', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByLabelText('User profile and account settings'));
    fireEvent.click(screen.getByText('Log Out'));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  it('instantly creates an Untitled board with a wrapped key and navigates', async () => {
    stubApi((url, init) =>
      url.includes('/api/boards') && isWrite(init, 'POST')
        ? jsonResponse({ id: 'new-b-1', title: 'Untitled', projectId: 'p1' })
        : undefined,
    );

    renderWorkspace();

    const newBtn = await screen.findByRole('button', { name: /New Canvas/i });
    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/w/acme-eng/canvas/new-b-1');
    });
    const post = vi
      .mocked(global.fetch)
      .mock.calls.find(
        ([input, init]) => requestUrl(input).includes('/api/boards') && isWrite(init, 'POST'),
      );
    const body = post?.[1]?.body;
    expect(typeof body === 'string' ? JSON.parse(body) : null).toMatchObject({
      projectId: 'p1',
      encryptedBoardKey: 'wrapped-board-key',
    });
  });

  it('clicking the "Create a canvas" tile creates a canvas and navigates', async () => {
    stubApi((url, init) =>
      url.includes('/api/boards') && isWrite(init, 'POST')
        ? jsonResponse({ id: 'card-b-1', title: 'Untitled', projectId: 'p1' })
        : undefined,
    );

    renderWorkspace();

    const blankCard = (await screen.findByText(/Create a canvas/i)).closest('div')!;
    fireEvent.click(blankCard);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/w/acme-eng/canvas/card-b-1');
    });
  });

  it('tells the user when creating a canvas fails and stays on the dashboard', async () => {
    stubApi((url, init) =>
      url.includes('/api/boards') && isWrite(init, 'POST')
        ? errorResponse(500, 'INTERNAL', 'Storage is down')
        : undefined,
    );

    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: /New Canvas/i }));

    expect(await screen.findByText('Storage is down')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/canvas/'));
    expect(screen.getByRole('button', { name: /New Canvas/i })).toBeEnabled();
  });

  it('renders clean Next / Previous pagination controls and navigates across pages', async () => {
    const pageOne = {
      items: [{ id: 'b1', title: 'Page 1 Diagram', projectId: 'p1' }],
      pagination: {
        page: 1,
        limit: 20,
        total: 21,
        totalPages: 2,
        hasNextPage: true,
        hasPrevPage: false,
      },
    };
    const pageTwo = {
      items: [{ id: 'b21', title: 'Page 2 Diagram', projectId: 'p1' }],
      pagination: {
        page: 2,
        limit: 20,
        total: 21,
        totalPages: 2,
        hasNextPage: false,
        hasPrevPage: true,
      },
    };
    stubApi((url, init) => {
      if (!url.includes('/api/boards') || (init?.method && init.method !== 'GET')) return undefined;
      if (!url.includes('projectId=')) {
        return jsonResponse([{ id: 'b1', title: 'Page 1 Diagram', projectId: 'p1' }]);
      }
      return jsonResponse(url.includes('page=2') ? pageTwo : pageOne);
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Page 1 Diagram').length).toBeGreaterThan(0);
      expect(screen.getByText(/SHOWING 1.*OF 21 CANVASES/i)).toBeInTheDocument();
    });

    const prevBtn = screen.getByRole('button', { name: /← PREVIOUS/i });
    const nextBtn = screen.getByRole('button', { name: /NEXT →/i });

    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    expect(screen.queryByRole('button', { name: /^1$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^2$/ })).not.toBeInTheDocument();

    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText(/SHOWING 21.*OF 21 CANVASES/i)).toBeInTheDocument();
      expect(screen.getAllByText('Page 2 Diagram').length).toBeGreaterThan(0);
    });

    expect(prevBtn).toBeEnabled();
    expect(nextBtn).toBeDisabled();
  });

  it('renders sort selector and passes sort parameter to API', async () => {
    renderWorkspace();

    const sort = await screen.findByLabelText(/^Sort$/i);
    expect(sort).toHaveValue('updated-desc');

    const boardUrls = () =>
      vi
        .mocked(global.fetch)
        .mock.calls.map(([input]) => requestUrl(input))
        .filter((url) => url.includes('/api/boards'));
    await waitFor(() => {
      expect(boardUrls().some((url) => url.includes('sort=updated-desc'))).toBe(true);
    });

    fireEvent.change(sort, { target: { value: 'title-asc' } });

    await waitFor(() => {
      expect(boardUrls().some((url) => url.includes('sort=title-asc'))).toBe(true);
    });
  });

  it('renders centered project watermark without AES-GCM badge', async () => {
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Core Architecture').length).toBeGreaterThan(0);
    expect(screen.queryByText(/🔒 AES-GCM/i)).not.toBeInTheDocument();
  });

  it('opens contextual menu on diagram card and handles delete confirmation modal', async () => {
    let deleteCalled = false;
    stubApi((url, init) => {
      if (isWrite(init, 'DELETE') && url.includes('/api/boards/b1')) {
        deleteCalled = true;
        return jsonResponse({ success: true });
      }
      return undefined;
    });

    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: /Canvas options/i }));

    expect(screen.getByText('Copy Canvas Link')).toBeInTheDocument();
    expect(screen.getByText('Delete Canvas')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete Canvas'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteCalled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Canvas options/i }));
    fireEvent.click(screen.getByText('Delete Canvas'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const confirmBtn = screen
      .getAllByRole('button', { name: 'Delete Canvas' })
      .find((btn) => btn.closest('[role="dialog"]'));
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });

  it('keeps the delete dialog open and the canvas listed when the server refuses the deletion', async () => {
    stubApi((url, init) =>
      isWrite(init, 'DELETE') && url.includes('/api/boards/b1')
        ? errorResponse(403, 'FORBIDDEN', 'You cannot delete this canvas')
        : undefined,
    );

    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: /Canvas options/i }));
    fireEvent.click(screen.getByText('Delete Canvas'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Canvas' }));

    expect(await screen.findByText('You cannot delete this canvas')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Delete Canvas' })).toBeEnabled();
    expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
  });

  it('renders left sidebar with viewport height and sticky positioning', async () => {
    const { container } = renderWorkspace();
    await waitFor(() => {
      expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
    });

    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
    expect(aside?.className).toContain('min-h-[calc(100vh-3.5rem)]');
    const stickyContainer = aside?.querySelector('.lg\\:sticky');
    expect(stickyContainer).toBeInTheDocument();
  });

  it('renders board thumbnail cover with seeded SVG artwork and centered title label without backdrop project watermark', async () => {
    const { container } = renderWorkspace();
    await waitFor(() => {
      expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
    });

    const legacyWatermarks = container.querySelectorAll(
      'span.font-black.uppercase.tracking-tighter',
    );
    expect(legacyWatermarks.length).toBe(0);

    expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
  });

  it('handles searching boards with special regex characters ([ * ( \\) without regex error', async () => {
    const stamp = new Date().toISOString();
    const specialBoards = [
      {
        id: 'b-regex-1',
        title: '[Core] Architecture [v2.0]',
        projectId: 'p1',
        createdAt: stamp,
        updatedAt: stamp,
        project: { id: 'p1', name: 'Core Architecture' },
      },
      {
        id: 'b-regex-2',
        title: 'Auth*Service (OAuth2) \\ Legacy',
        projectId: 'p1',
        createdAt: stamp,
        updatedAt: stamp,
        project: { id: 'p1', name: 'Core Architecture' },
      },
      {
        id: 'b-plain',
        title: 'Simple Flowchart',
        projectId: 'p1',
        createdAt: stamp,
        updatedAt: stamp,
        project: { id: 'p1', name: 'Core Architecture' },
      },
    ];
    stubApi((url) => (url.includes('/api/boards') ? jsonResponse(specialBoards) : undefined));

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('[Core] Architecture [v2.0]').length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const searchInput = screen.getByPlaceholderText(/Search by title or project/i);
    expect(searchInput).toBeInTheDocument();
    const palette = searchInput.closest<HTMLElement>('div.fixed.inset-0');
    if (!palette) {
      throw new Error('Expected CommandPalette container to be in the document');
    }

    fireEvent.change(searchInput, { target: { value: '[' } });
    expect(within(palette).getByText('[Core] Architecture [v2.0]')).toBeInTheDocument();
    expect(within(palette).queryByText('Simple Flowchart')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '*' } });
    expect(within(palette).getByText(/Auth\*Service \(OAuth2\) \\ Legacy/i)).toBeInTheDocument();
    expect(within(palette).queryByText('[Core] Architecture [v2.0]')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '(' } });
    expect(within(palette).getByText(/Auth\*Service \(OAuth2\) \\ Legacy/i)).toBeInTheDocument();
    expect(within(palette).queryByText('Simple Flowchart')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '\\' } });
    expect(within(palette).getByText(/Auth\*Service \(OAuth2\) \\ Legacy/i)).toBeInTheDocument();
    expect(within(palette).queryByText('Simple Flowchart')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '[+++' } });
    expect(within(palette).getByText(/No results found for/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/Search by title or project/i)).not.toBeInTheDocument();
  });

  it('navigates to /w/:slug/canvas/:id when a board is selected in the command palette (H13)', async () => {
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const searchInput = screen.getByPlaceholderText(/Search by title or project/i);
    const palette = searchInput.closest<HTMLElement>('div.fixed.inset-0');
    if (!palette) {
      throw new Error('Expected CommandPalette container to be in the document');
    }

    fireEvent.click(within(palette).getByText('Topology Mesh Architecture'));

    expect(mockNavigate).toHaveBeenCalledWith('/w/acme-eng/canvas/b1');
  });

  it('preserves sort order and resets page when switching project tabs', async () => {
    stubApi((url) =>
      url.includes('/api/projects')
        ? jsonResponse([
            { id: 'p1', name: 'Core Architecture', organizationId: 'org-1', _count: { boards: 3 } },
            { id: 'p2', name: 'Security Systems', organizationId: 'org-1', _count: { boards: 5 } },
          ])
        : undefined,
    );

    renderWorkspace('/w/acme-eng?sort=title-asc&page=2');

    await waitFor(() => {
      expect(screen.getByText('Security Systems')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Security Systems/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Security Systems' })).toBeInTheDocument();
    });
  });

  it('wraps a project created after a workspace switch with the new workspace key', async () => {
    const { resolveOrgKey, provisionProjectKeys } = await import('@/lib/keys');
    // One real key per wrapped value, so the assertion below can tell which workspace's key was used.
    const generateKey = () =>
      crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const [org1Key, org2Key, otherKey] = await Promise.all([
      generateKey(),
      generateKey(),
      generateKey(),
    ]);
    const keysByWrapped = new Map([
      ['org-1-key', org1Key],
      ['org-2-key', org2Key],
    ]);
    // The implementation outlives this test (clearAllMocks keeps it), so an unknown value still gets a key.
    vi.mocked(resolveOrgKey).mockImplementation(
      async (encryptedOrgKey) => keysByWrapped.get(encryptedOrgKey ?? '') ?? otherKey,
    );

    stubApi((url, init) => {
      if (url.includes('/api/workspaces/org-1') || url.includes('/api/workspaces/acme-eng')) {
        return jsonResponse({
          id: 'org-1',
          name: 'Acme Eng',
          slug: 'acme-eng',
          currentUserRole: 'owner',
          encryptedOrgKey: 'org-1-key',
          keyVersion: 1,
        });
      }
      if (url.includes('/api/workspaces/org-2') || url.includes('/api/workspaces/core-platform')) {
        return jsonResponse({
          id: 'org-2',
          name: 'Core Platform',
          slug: 'core-platform',
          currentUserRole: 'owner',
          encryptedOrgKey: 'org-2-key',
          keyVersion: 3,
        });
      }
      if (url.includes('/api/projects') && isWrite(init, 'POST')) {
        return jsonResponse({ id: 'p-new', name: 'Switched Project', organizationId: 'org-2' });
      }
      if (url.includes('/api/projects') || url.includes('/api/boards')) {
        return jsonResponse({ items: [] });
      }
      return undefined;
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Acme Eng').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: /Acme Eng/ }));
    fireEvent.click(screen.getByRole('button', { name: /Core Platform/ }));

    await waitFor(() => {
      expect(screen.getAllByText('Core Platform').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByTitle('New Project'));
    fireEvent.change(screen.getByPlaceholderText('Project name...'), {
      target: { value: 'Switched Project' },
    });
    fireEvent.submit(screen.getByPlaceholderText('Project name...').closest('form')!);

    await waitFor(() => {
      expect(provisionProjectKeys).toHaveBeenCalled();
    });

    const [provisioningArgs] = vi.mocked(provisionProjectKeys).mock.calls.at(-1)!;
    expect(provisioningArgs?.orgKey).toBe(org2Key);
    expect(provisioningArgs).toMatchObject({ workspaceId: 'org-2', workspaceKeyVersion: 3 });
  });

  it('selects the new project and closes the form after creating a project', async () => {
    const existing = {
      id: 'p1',
      name: 'Core Architecture',
      organizationId: 'org-1',
      keyVersion: 1,
    };
    const fresh = { id: 'p-new', name: 'Fresh Project', organizationId: 'org-1', keyVersion: 1 };
    let created = false;
    stubApi((url, init) => {
      if (!url.includes('/api/projects')) return undefined;
      if (isWrite(init, 'POST')) {
        created = true;
        return jsonResponse(fresh);
      }
      return jsonResponse(created ? [existing, fresh] : [existing]);
    });

    renderWorkspace();

    fireEvent.click(await screen.findByTitle('New Project'));
    fireEvent.change(screen.getByPlaceholderText('Project name...'), {
      target: { value: 'Fresh Project' },
    });
    fireEvent.submit(screen.getByPlaceholderText('Project name...').closest('form')!);

    expect(await screen.findByRole('heading', { name: 'Fresh Project' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Project name...')).not.toBeInTheDocument();
  });

  it('tells the user when creating a project fails and keeps the form as typed', async () => {
    stubApi((url, init) =>
      url.includes('/api/projects') && isWrite(init, 'POST')
        ? errorResponse(409, 'CONFLICT', 'A project with that name already exists')
        : undefined,
    );

    renderWorkspace();

    fireEvent.click(await screen.findByTitle('New Project'));
    fireEvent.change(screen.getByPlaceholderText('Project name...'), {
      target: { value: 'Core Architecture' },
    });
    fireEvent.submit(screen.getByPlaceholderText('Project name...').closest('form')!);

    expect(await screen.findByText('A project with that name already exists')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Project name...')).toHaveValue('Core Architecture');
  });

  it('shows an error with a retry when the projects cannot be loaded', async () => {
    stubApi((url, init) =>
      url.includes('/api/projects') && !isWrite(init, 'POST')
        ? errorResponse(500, 'INTERNAL', 'Database unavailable')
        : undefined,
    );

    renderWorkspace();

    expect(await screen.findByText('The projects could not be loaded.')).toBeInTheDocument();

    stubApi();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getAllByText('Topology Mesh Architecture').length).toBeGreaterThan(0);
    });
  });

  it('shows waiting for access instead of boards when the grant is pending', async () => {
    let projectBoardsFetched = false;
    stubApi((url) => {
      if (url.includes('/api/workspaces/')) {
        return jsonResponse({
          id: 'org-1',
          name: 'Acme Eng',
          slug: 'acme-eng',
          currentUserRole: 'editor',
          encryptedOrgKey: null,
        });
      }
      if (url.includes('/api/projects')) {
        return jsonResponse([
          {
            id: 'p1',
            name: 'Pending Project',
            organizationId: 'org-1',
            keyStatus: 'pending',
            members: [{ id: 'pm1', userId: 'u1', encryptedProjectKey: null }],
            _count: { boards: 2 },
          },
        ]);
      }
      if (url.includes('/api/boards') && url.includes('projectId=')) {
        projectBoardsFetched = true;
        return jsonResponse({ items: [] });
      }
      if (url.includes('/api/access/me')) {
        return jsonResponse({
          canCreateWorkspace: false,
          workspace: { id: 'org-1', name: 'Acme Eng', slug: 'acme-eng' },
          workspaceRole: 'editor',
          isWorkspaceAdministrator: false,
          rules: [],
          projectRules: { editor: editorProjectRules },
          projectRoles: { p1: 'editor' },
        });
      }
      return undefined;
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('Waiting for access')).toBeInTheDocument();
      expect(screen.getByText(/An administrator needs to grant you access/i)).toBeInTheDocument();
    });

    expect(screen.queryByText('New Canvas')).not.toBeInTheDocument();
    expect(screen.queryByText('Create a canvas')).not.toBeInTheDocument();
    expect(projectBoardsFetched).toBe(false);
    expect(screen.queryByRole('button', { name: 'Add members' })).not.toBeInTheDocument();
  });

  describe('Add members', () => {
    const projectAdminRules = buildPackedRules((can) => {
      can('read', 'Project');
      can('update', 'Project');
      can('read', 'ProjectMember');
      can('manage', 'ProjectMember');
      can(['read', 'create', 'update', 'delete', 'share'], 'Board');
    });
    const viewerProjectRules = buildPackedRules((can) => {
      can('read', 'Project');
      can('read', 'ProjectMember');
      can('read', 'Board');
    });

    /** The caller is a workspace Editor or Viewer who holds `projectRole` on the project. */
    const memberAccess =
      (workspaceRole: 'editor' | 'viewer', projectRole: 'admin' | 'editor' | 'viewer'): Route =>
      (url) =>
        url.includes('/api/access/me')
          ? jsonResponse({
              canCreateWorkspace: false,
              workspace: { id: 'org-1', name: 'Acme Eng', slug: 'acme-eng' },
              workspaceRole,
              isWorkspaceAdministrator: false,
              rules: [],
              projectRules: {
                admin: projectAdminRules,
                editor: editorProjectRules,
                viewer: viewerProjectRules,
              },
              projectRoles: { p1: projectRole },
            })
          : undefined;
    const asMemberWithProjectRole = (
      workspaceRole: 'editor' | 'viewer',
      projectRole: 'admin' | 'editor' | 'viewer',
    ) => stubApi(memberAccess(workspaceRole, projectRole));

    const projectLoaded = () =>
      waitFor(() => expect(screen.getAllByText('Core Architecture').length).toBeGreaterThan(0));

    it('is offered to an Owner, beside the sort menu and New Canvas', async () => {
      renderWorkspace();

      const button = await screen.findByRole('button', { name: 'Add members' });
      const newCanvas = await screen.findByRole('button', { name: /New Canvas/ });
      expect(button.parentElement).toBe(newCanvas.parentElement);
    });

    it('is offered to a Project Admin who is only an Editor in the workspace', async () => {
      asMemberWithProjectRole('editor', 'admin');
      renderWorkspace();

      expect(await screen.findByRole('button', { name: 'Add members' })).toBeVisible();
      expect(screen.queryByRole('link', { name: /Management/i })).not.toBeInTheDocument();
    });

    it.each([
      ['an Editor in the project', 'editor', 'editor'],
      ['a Viewer in the project', 'editor', 'viewer'],
      ['a workspace Viewer', 'viewer', 'viewer'],
    ] as const)('is not offered to %s', async (_label, workspaceRole, projectRole) => {
      asMemberWithProjectRole(workspaceRole, projectRole);
      renderWorkspace();

      await projectLoaded();
      // The header badge appears once the caller's rights have loaded.
      await waitFor(() =>
        expect(screen.getByTestId('role-badge')).toHaveTextContent(workspaceRole),
      );
      expect(screen.queryByRole('button', { name: 'Add members' })).not.toBeInTheDocument();
    });

    it('lets a Project Admin pick from the people the project offers and grant them a key', async () => {
      const requests: Array<{ url: string; method: string | undefined; body: unknown }> = [];
      stubApi(memberAccess('editor', 'admin'), (url, init) => {
        requests.push({
          url,
          method: init?.method,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        if (url.includes('/api/projects/p1/assignable-members')) {
          return jsonResponse({
            items: [{ userId: 'u9', name: 'Nina New', email: 'nina@canvhq.internal' }],
            pagination: {
              page: 1,
              limit: 100,
              total: 1,
              totalPages: 1,
              hasNextPage: false,
              hasPrevPage: false,
            },
          });
        }
        if (url.includes('/api/projects/p1/members') && init?.method === 'POST') {
          return jsonResponse({ id: 'pm-9', role: 'viewer' }, { status: 201 });
        }
        if (url.includes('/api/projects/p1/members')) {
          return jsonResponse([]);
        }
        return undefined;
      });
      renderWorkspace();

      fireEvent.click(await screen.findByRole('button', { name: 'Add members' }));
      await screen.findByRole('option', { name: /Nina New \(nina@canvhq\.internal\)/ });
      fireEvent.change(screen.getByLabelText('Workspace member to assign'), {
        target: { value: 'u9' },
      });
      fireEvent.change(screen.getByLabelText('Project role'), { target: { value: 'viewer' } });
      fireEvent.click(screen.getByRole('button', { name: 'Assign Member' }));

      await waitFor(() =>
        expect(
          requests.find((r) => r.method === 'POST' && r.url.includes('/members'))?.body,
        ).toEqual({
          userId: 'u9',
          role: 'viewer',
          encryptedProjectKey: 'wrapped-for-target',
        }),
      );
      expect(requests.some((r) => r.url.includes('/api/workspaces/org-1/members'))).toBe(false);
    });
  });
});
