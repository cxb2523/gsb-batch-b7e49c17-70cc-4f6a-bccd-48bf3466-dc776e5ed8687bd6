import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { boardKeys } from '@/features/boards/keys';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import { BoardCanvas } from './BoardCanvas';
import { generateSymmetricKey } from '@/lib/crypto';
import { sealBoardPayload } from '@/lib/crypto-format';
import {
  deleteUnsavedPayload,
  getUnsavedPayload,
  saveUnsavedPayload,
} from '@/features/boards/unsaved-store';
import { clearRevisionStore } from '@/lib/revision-store';
import { toast } from 'sonner';
import {
  emptyResponse,
  errorResponse,
  jsonResponse,
  networkFailure,
  savedPayloadResponse,
} from '@/test/http';

function buildPackedRules(
  callback: (can: (action: string | string[], subject: string | string[]) => void) => void,
) {
  const { can, build } = new AbilityBuilder<MongoAbility>(createMongoAbility);
  callback(can);
  return packRules(build().rules);
}

const defaultEditorRules = buildPackedRules((can) => {
  can('read', 'Project');
  can('read', 'ProjectMember');
  can(['read', 'create', 'update', 'delete', 'share'], 'Board');
});

const defaultViewerRules = buildPackedRules((can) => {
  can('read', 'Project');
  can('read', 'ProjectMember');
  can('read', 'Board');
});

interface AccessOptions {
  projectRole?: string;
  workspaceRole?: string;
  isAdministrator?: boolean;
}

const makeAccessMeResponse = (options?: AccessOptions) => ({
  canCreateWorkspace: true,
  workspace: { id: 'org-1', name: 'Acme-corp', slug: 'acme-corp' },
  workspaceRole: options?.workspaceRole ?? 'editor',
  isWorkspaceAdministrator: options?.isAdministrator ?? false,
  rules: defaultEditorRules,
  projectRules: {
    editor: defaultEditorRules,
    viewer: defaultViewerRules,
  },
  projectRoles: {
    p1: options?.projectRole ?? 'editor',
  },
});

interface BoardOptions {
  title?: string;
  hasPayload?: boolean;
  revision?: number;
  keyVersion?: number;
  projectKeyVersion?: number;
  publicShareToken?: string | null;
  memberRole?: string;
  memberKey?: string | null;
  projectName?: string;
  organization?: { id: string; name: string; slug: string };
  encryptedProjectKey?: string;
}

const makeBoard = (options: BoardOptions = {}) => ({
  id: 'b1',
  title: options.title ?? 'Ingress Mesh Topology',
  projectId: 'p1',
  encryptedBoardKey: 'wrapped-board-key',
  keyVersion: options.keyVersion ?? 1,
  hasPayload: options.hasPayload ?? false,
  revision: options.revision ?? 0,
  publicShareToken: options.publicShareToken ?? null,
  updatedAt: new Date().toISOString(),
  project: {
    id: 'p1',
    name: options.projectName ?? 'Core Infrastructure',
    organizationId: 'org-1',
    keyVersion: options.projectKeyVersion ?? 1,
    ...(options.organization ? { organization: options.organization } : {}),
    ...(options.encryptedProjectKey ? { encryptedProjectKey: options.encryptedProjectKey } : {}),
    members: [
      {
        id: 'pm1',
        userId: 'user-lead',
        role: options.memberRole ?? 'editor',
        encryptedProjectKey:
          options.memberKey === undefined ? 'wrapped-project-key' : options.memberKey,
      },
    ],
  },
});

const makeWorkspace = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Acme-corp',
  slug: 'acme-corp',
  currentUserRole: 'editor',
  keyVersion: 1,
  ...overrides,
});

type ApiResponder = (init: RequestInit) => Response | Promise<Response>;

interface ApiStub {
  access?: AccessOptions;
  workspace?: Record<string, unknown>;
  /** GET /api/boards/b1 */
  board?: Response | (() => Response);
  patchBoard?: ApiResponder;
  getPayload?: ApiResponder;
  putPayload?: ApiResponder;
  publicShare?: (method: string) => Response;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** The title a rename request asks for. */
function requestedTitle(init: RequestInit): string {
  return typeof init.body === 'string' ? JSON.parse(init.body).title : '';
}

/** Serves the endpoints the canvas talks to with real `Response` objects. */
function stubApi(stub: ApiStub = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = requestUrl(input);
    const method = init.method ?? 'GET';

    if (url.includes('/api/access/me')) return jsonResponse(makeAccessMeResponse(stub.access));
    if (url.includes('/api/workspaces/')) return jsonResponse(stub.workspace ?? makeWorkspace());
    if (url.includes('/api/boards/b1/payload')) {
      if (method === 'PUT') return (stub.putPayload ?? (() => savedPayloadResponse()))(init);
      return (stub.getPayload ?? (() => errorResponse(404, 'NOT_FOUND', 'No payload')))(init);
    }
    if (url.includes('/api/boards/b1/public-share')) {
      if (stub.publicShare) return stub.publicShare(method);
      return method === 'DELETE'
        ? emptyResponse()
        : jsonResponse({ isPublic: true, publicShareToken: 'test-share-token-123' });
    }
    if (url.includes('/api/boards/b1')) {
      if (method === 'PATCH') {
        return (
          stub.patchBoard ??
          ((patchInit) => jsonResponse(makeBoard({ title: requestedTitle(patchInit) })))
        )(init);
      }
      const board = stub.board ?? (() => jsonResponse(makeBoard()));
      return typeof board === 'function' ? board() : board;
    }
    return jsonResponse({});
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function putRequests(fetchMock: ReturnType<typeof stubApi>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
}

const keyContextMock = vi.hoisted(() => ({
  privateKey: null,
  isUnlocked: true,
  promptUnlock: vi.fn(),
}));

const keyServiceMock = vi.hoisted(() => ({
  resolveProjectKey: vi.fn(),
  resolveBoardKey: vi.fn(),
  provisionBoardKeys: vi.fn(async () => {
    const cryptoModule = await import('@/lib/crypto');
    return {
      boardKey: await cryptoModule.generateSymmetricKey(),
      encryptedBoardKey: `AQAAAAIAAAAC${'A'.repeat(64)}`,
    };
  }),
}));

vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => keyContextMock,
}));

vi.mock('@/lib/keys', () => keyServiceMock);

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => {
  const session: { data: { user: { id: string } } | null } = { data: null };
  return { session, getSession: vi.fn() };
});

vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
  authClient: {
    getSession: authMock.getSession,
    organization: {
      list: vi.fn().mockResolvedValue({ data: [{ id: 'org-1', slug: 'acme' }] }),
      setActive: vi.fn().mockResolvedValue({}),
    },
  },
}));

interface MockExcalidrawProps {
  UIOptions?: { canvasActions?: Record<string, boolean> };
  viewModeEnabled?: boolean;
  onChange?: (elements: unknown[], appState: object) => void;
  onExcalidrawAPI?: (api: object) => void;
  children?: React.ReactNode;
}

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: ({
    UIOptions,
    viewModeEnabled,
    onChange,
    onExcalidrawAPI,
    children,
  }: MockExcalidrawProps) => (
    <div
      data-testid="mock-excalidraw"
      ref={() =>
        onExcalidrawAPI?.({
          updateScene: vi.fn(),
          getFiles: () => ({}),
          getSceneElements: () => [],
          getSceneElementsIncludingDeleted: () => [],
          getAppState: () => ({
            viewBackgroundColor: '#ffffff',
            gridModeEnabled: true,
            currentItemRoundness: 'round',
            currentItemRoughness: 0,
          }),
        })
      }
    >
      <button
        data-testid="emit-change"
        onClick={() => onChange?.([{ id: 'rect-1', type: 'rectangle' }], {})}
      >
        change
      </button>
      {/* What the editor reports when nothing was edited (a scroll, a selection, the first render). */}
      <button
        data-testid="emit-unchanged"
        onClick={() =>
          onChange?.([], {
            viewBackgroundColor: '#ffffff',
            gridModeEnabled: true,
            currentItemRoundness: 'round',
            currentItemRoughness: 0,
          })
        }
      >
        unchanged
      </button>
      <span data-testid="export-opt">{String(UIOptions?.canvasActions?.export)}</span>
      <span data-testid="save-image-opt">{String(UIOptions?.canvasActions?.saveAsImage)}</span>
      <span data-testid="load-scene-opt">{String(UIOptions?.canvasActions?.loadScene)}</span>
      <span data-testid="view-mode-opt">{String(viewModeEnabled)}</span>
      <span data-testid="clear-canvas-opt">{String(UIOptions?.canvasActions?.clearCanvas)}</span>
      {children}
    </div>
  ),
  convertToExcalidrawElements: vi.fn().mockImplementation((elems: Array<{ id?: string }>) =>
    elems.map((el, i) => ({
      ...el,
      id: el.id || `mock-elem-${i}`,
      version: 1,
    })),
  ),
  getCommonBounds: vi.fn().mockReturnValue([0, 0, 100, 100]),
  exportToBlob: vi.fn().mockResolvedValue(new Blob()),
  getSceneVersion: vi
    .fn()
    .mockImplementation((elems: readonly unknown[]) => (elems?.length ? 1 + elems.length : 1)),
}));

const signedInUser = { user: { id: 'user-lead' } };

describe('BoardCanvas Component', () => {
  let validKey: CryptoKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await deleteUnsavedPayload('b1');
    await clearRevisionStore();
    authMock.session.data = signedInUser;

    validKey = await generateSymmetricKey();
    keyServiceMock.resolveBoardKey.mockResolvedValue(validKey);
    keyServiceMock.resolveProjectKey.mockResolvedValue(await generateSymmetricKey());

    stubApi();
  });

  const renderBoard = (
    route = '/w/acme-corp/board/b1',
    seed?: (queryClient: QueryClient) => void,
  ) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    seed?.(queryClient);
    const router = createMemoryRouter(
      [
        { path: '/w/:slug/board/:boardId', element: <BoardCanvas /> },
        { path: '/w/:slug', element: <div>Workspace Dashboard</div> },
        { path: '/login', element: <div>Login Page</div> },
      ],
      { initialEntries: [route] },
    );
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { ...rendered, queryClient, router };
  };

  it('renders precision HUD navbar and Excalidraw with CAD technical defaults', async () => {
    renderBoard();

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeInTheDocument();
      expect(screen.getByText('Acme-corp')).toBeInTheDocument();
      expect(screen.getByText('Core Infrastructure')).toBeInTheDocument();
      expect(screen.getByText('Ingress Mesh Topology')).toBeInTheDocument();
      expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
    });

    expect(screen.getByTestId('export-opt')).toHaveTextContent('false');
    expect(screen.getByTestId('save-image-opt')).toHaveTextContent('true');
  });

  describe('renaming the canvas', () => {
    it('allows editing board title when user is an editor', async () => {
      const fetchMock = stubApi();
      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Ingress Mesh Topology')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Ingress Mesh Topology'));

      const input = screen.getByDisplayValue('Ingress Mesh Topology');
      fireEvent.change(input, { target: { value: 'Updated Mesh Title' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/boards/b1'),
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ title: 'Updated Mesh Title' }),
          }),
        );
      });
      await waitFor(() => {
        expect(screen.getByText('Updated Mesh Title')).toBeInTheDocument();
      });
    });

    it('marks the dashboard canvas lists stale, which are keyed by workspace id not slug', async () => {
      const { queryClient } = renderBoard();
      queryClient.setQueryData(boardKeys.list('org-1'), { items: [] });
      await waitFor(() => {
        expect(screen.getByText('Ingress Mesh Topology')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Ingress Mesh Topology'));
      const input = screen.getByDisplayValue('Ingress Mesh Topology');
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(queryClient.getQueryState(boardKeys.list('org-1'))?.isInvalidated).toBe(true);
      });
    });

    it('tells the user and keeps the old title when the server refuses the rename', async () => {
      stubApi({ patchBoard: () => errorResponse(500, 'INTERNAL', 'Could not rename') });
      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Ingress Mesh Topology')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Ingress Mesh Topology'));
      const input = screen.getByDisplayValue('Ingress Mesh Topology');
      fireEvent.change(input, { target: { value: 'Refused Title' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Could not rename');
      });
      expect(screen.getByText('Ingress Mesh Topology')).toBeInTheDocument();
      expect(screen.queryByText('Refused Title')).not.toBeInTheDocument();
    });

    it('tells the user and keeps the old title when the network is down', async () => {
      stubApi({ patchBoard: () => networkFailure() });
      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Ingress Mesh Topology')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Ingress Mesh Topology'));
      const input = screen.getByDisplayValue('Ingress Mesh Topology');
      fireEvent.change(input, { target: { value: 'Offline Title' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Could not reach the server. Check your connection and try again.',
        );
      });
      expect(screen.getByText('Ingress Mesh Topology')).toBeInTheDocument();
    });
  });

  describe('sharing a public link', () => {
    it('enables public sharing and does NOT offer an insecure edit link', async () => {
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextSpy,
        },
      });
      const fetchMock = stubApi();

      renderBoard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument();
        // The caller's rules have arrived, so the share controls are the editor's.
        expect(screen.getByText('MODE: EDITING (READY)')).toBeInTheDocument();
      });

      // Open Share popover
      fireEvent.click(screen.getByRole('button', { name: /Share/i }));

      expect(screen.getByText('SHARE CANVAS')).toBeInTheDocument();
      expect(screen.getByText('Public Share Link')).toBeInTheDocument();
      // An editor cannot add people, so is not pointed at the page that does
      expect(screen.queryByText('Project Collaborators')).not.toBeInTheDocument();
      // Insecure Edit Link MUST NOT exist
      expect(screen.queryByText('Copy Edit Link')).not.toBeInTheDocument();
      expect(screen.queryByText('Edit Link')).not.toBeInTheDocument();

      // Toggle public sharing switch
      fireEvent.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/boards/b1/public-share'),
          expect.objectContaining({ method: 'POST' }),
        );
        expect(screen.getByRole('button', { name: /Copy Public Link/i })).toBeInTheDocument();
      });

      // Copy public link
      fireEvent.click(screen.getByRole('button', { name: /Copy Public Link/i }));

      await waitFor(() => {
        expect(writeTextSpy).toHaveBeenCalledWith(
          expect.stringContaining('/share/test-share-token-123#key='),
        );
        // The public link must NEVER point to internal /w/:slug path
        expect(writeTextSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('/w/acme-corp/board/'),
        );
        expect(screen.getByText('Link Copied!')).toBeInTheDocument();
      });
    });

    it('points an administrator at member management from the share panel', async () => {
      stubApi({ access: { workspaceRole: 'admin', isAdministrator: true } });

      renderBoard();

      fireEvent.click(await screen.findByRole('button', { name: /Share/i }));

      expect(await screen.findByText('Project Collaborators')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Manage Project Members' })).toBeInTheDocument();
    });

    it('allows toggling public share off to revoke public access and renders capitalized breadcrumbs', async () => {
      // Start with board already public
      const fetchMock = stubApi({
        board: () =>
          jsonResponse(
            makeBoard({
              publicShareToken: 'initial-token-111',
              organization: { id: 'org-1', name: 'Acme Workspace', slug: 'acme-corp' },
            }),
          ),
      });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument();
        // The caller's rules have arrived, so the share controls are the editor's.
        expect(screen.getByText('MODE: EDITING (READY)')).toBeInTheDocument();
        // Verify breadcrumbs have capitalized workspace and project names
        expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
        expect(screen.getByText('Core Infrastructure')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Share/i }));

      const toggleBtn = screen.getByRole('switch', { name: /Disable public link/i });
      expect(toggleBtn).toBeInTheDocument();

      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/boards/b1/public-share'),
          expect.objectContaining({ method: 'DELETE' }),
        );
      });
      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /Enable public link/i })).toBeInTheDocument();
      });
    });

    it('leaves the link off and says so when enabling fails', async () => {
      stubApi({ publicShare: () => errorResponse(500, 'INTERNAL', 'Could not share') });
      renderBoard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument();
        // The caller's rules have arrived, so the share controls are the editor's.
        expect(screen.getByText('MODE: EDITING (READY)')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Share/i }));
      fireEvent.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to enable public sharing');
      });
      expect(screen.getByRole('switch', { name: /Enable public link/i })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.queryByRole('button', { name: /Copy Public Link/i })).not.toBeInTheDocument();
    });

    it('keeps the link on and says so when disabling fails', async () => {
      stubApi({
        board: () => jsonResponse(makeBoard({ publicShareToken: 'initial-token-111' })),
        publicShare: () => errorResponse(500, 'INTERNAL', 'Could not unshare'),
      });
      renderBoard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument();
        // The caller's rules have arrived, so the share controls are the editor's.
        expect(screen.getByText('MODE: EDITING (READY)')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Share/i }));
      fireEvent.click(screen.getByRole('switch', { name: /Disable public link/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to disable public sharing');
      });
      expect(screen.getByRole('switch', { name: /Disable public link/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
  });

  it('enforces strict view-only mode when user has project role viewer', async () => {
    stubApi({
      access: { projectRole: 'viewer' },
      board: () => jsonResponse(makeBoard({ memberRole: 'viewer' })),
    });

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
    });

    // Excalidraw viewModeEnabled should be true
    expect(screen.getByTestId('view-mode-opt')).toHaveTextContent('true');
    expect(screen.getByTestId('clear-canvas-opt')).toHaveTextContent('false');

    // Header displays viewer badge
    expect(screen.getByText('VIEWER')).toBeInTheDocument();

    // Clicking title does NOT open an edit input
    const titleEl = screen.getByText('Ingress Mesh Topology');
    fireEvent.click(titleEl);
    expect(screen.queryByDisplayValue('Ingress Mesh Topology')).not.toBeInTheDocument();

    // Bottom dock displays read-only status
    expect(screen.getByText('MODE: VIEWER (READ-ONLY)')).toBeInTheDocument();
    expect(screen.getByText('ACCESS: PROJECT VIEWER')).toBeInTheDocument();
    expect(screen.getByText('AUTOSAVE: DISABLED (READ-ONLY)')).toBeInTheDocument();

    // A viewer is offered neither the Mermaid import nor sharing
    expect(screen.queryByRole('button', { name: /Import Mermaid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share/i })).not.toBeInTheDocument();
  });

  it('elevates user to editor mode when assigned as project editor even if workspace role is viewer', async () => {
    stubApi({
      access: { workspaceRole: 'viewer', projectRole: 'editor' },
      workspace: makeWorkspace({ name: 'Acme Corp', currentUserRole: 'viewer' }),
    });

    renderBoard();

    await waitFor(() => {
      expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
    });

    // Excalidraw viewModeEnabled should be false (can edit!)
    expect(screen.getByTestId('view-mode-opt')).toHaveTextContent('false');
    expect(screen.queryByText('VIEWER')).not.toBeInTheDocument();
    expect(screen.getByText('MODE: EDITING (READY)')).toBeInTheDocument();
  });

  it('renders Import Mermaid button in HUD and opens modal on click', async () => {
    renderBoard();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import Mermaid/i })).not.toBeDisabled();
    });

    const mermaidBtn = screen.getByRole('button', { name: /Import Mermaid/i });

    fireEvent.click(mermaidBtn);

    expect(screen.getByText('IMPORT MERMAID TO CANVAS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Insert into Canvas/i })).toBeInTheDocument();
  });

  describe('when the canvas details cannot be read', () => {
    it('redirects to workspace dashboard rather than login when user is removed from project (403/401 with active session)', async () => {
      stubApi({
        board: () =>
          errorResponse(403, 'FORBIDDEN', 'You do not have access to this project diagram'),
      });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Workspace Dashboard')).toBeInTheDocument();
        expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
      });
      expect(toast.error).toHaveBeenCalledWith('You do not have access to this canvas');
    });

    it('says the canvas is gone and returns to the workspace on a 404', async () => {
      stubApi({ board: () => errorResponse(404, 'NOT_FOUND', 'No such board') });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Workspace Dashboard')).toBeInTheDocument();
      });
      expect(toast.error).toHaveBeenCalledWith('Canvas not found');
    });

    it('sends a signed-out visitor to the login page on a 401', async () => {
      authMock.session.data = null;
      stubApi({ board: () => errorResponse(401, 'UNAUTHORIZED', 'Sign in') });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Login Page')).toBeInTheDocument();
      });
    });

    it('shows a retryable error on a server failure instead of loading forever', async () => {
      let attempts = 0;
      stubApi({
        board: () => {
          attempts += 1;
          return attempts === 1
            ? errorResponse(500, 'INTERNAL', 'Boom')
            : jsonResponse(makeBoard());
        },
      });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Canvas details could not be loaded')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mock-excalidraw')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });
    });

    it('shows a retryable error when the network is down', async () => {
      global.fetch = vi.fn(async (input: RequestInfo | URL) =>
        requestUrl(input).includes('/api/boards/b1')
          ? networkFailure()
          : jsonResponse(makeAccessMeResponse()),
      );

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Canvas details could not be loaded')).toBeInTheDocument();
      });
    });
  });

  it('passes route param slug as active-organization header when fetching board metadata (TAB-01)', async () => {
    const fetchMock = stubApi();
    renderBoard();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/boards/b1'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'active-organization': 'acme-corp',
          }),
        }),
      );
    });
  });

  describe('a board that did not load cannot be edited (C3)', () => {
    it('does not mount the editor, does not save, and leaves no local key behind', async () => {
      const payloadKey = await generateSymmetricKey();
      const ciphertext = await sealBoardPayload(
        payloadKey,
        { elements: [{ id: 'the-real-content' }] },
        { boardId: 'b1', keyVersion: 1, revision: 1 },
      );

      const fetchMock = stubApi({
        board: () => jsonResponse(makeBoard({ hasPayload: true })),
        getPayload: () => new Response(ciphertext, { status: 200 }),
      });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Could not decrypt this canvas')).toBeInTheDocument();
      });

      // The editor never mounted, so nothing could be drawn or saved over the real board.
      expect(screen.queryByTestId('mock-excalidraw')).not.toBeInTheDocument();
      expect(putRequests(fetchMock)).toHaveLength(0);

      // Nothing about the failed key is cached locally.
      expect(localStorage.getItem('canvhq_key_b1')).toBeNull();
    });

    it('blocks a server error instead of opening an empty canvas', async () => {
      const fetchMock = stubApi({
        board: () => jsonResponse(makeBoard({ hasPayload: true })),
        getPayload: () => errorResponse(500, 'INTERNAL', 'Storage is down'),
      });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Canvas could not be loaded')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mock-excalidraw')).not.toBeInTheDocument();
      expect(putRequests(fetchMock)).toHaveLength(0);
    });

    it('blocks a network failure instead of opening an empty canvas', async () => {
      const fetchMock = stubApi({
        board: () => jsonResponse(makeBoard({ hasPayload: true })),
        getPayload: () => networkFailure(),
      });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Canvas could not be loaded')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mock-excalidraw')).not.toBeInTheDocument();
      expect(putRequests(fetchMock)).toHaveLength(0);
    });

    it('opens the board when Retry is pressed after a transient failure', async () => {
      let payloadRequests = 0;
      const ciphertext = await sealBoardPayload(
        validKey,
        { elements: [{ id: 'recovered' }] },
        { boardId: 'b1', keyVersion: 1, revision: 1 },
      );

      stubApi({
        board: () => jsonResponse(makeBoard({ hasPayload: true })),
        getPayload: () => {
          payloadRequests += 1;
          return payloadRequests === 1
            ? errorResponse(503, 'UNAVAILABLE', 'Try later')
            : new Response(ciphertext, { status: 200 });
        },
      });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByText('Canvas could not be loaded')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });
    });
  });

  describe('a failed save keeps the work (H11)', () => {
    const saveStub = (status: () => number) =>
      stubApi({
        putPayload: () => {
          const code = status();
          return code >= 200 && code < 300
            ? savedPayloadResponse()
            : errorResponse(code, 'SAVE_FAILED', 'Save failed');
        },
      });

    it('does not navigate away on 401, keeps the editor, and saves when the session returns', async () => {
      let status = 401;
      saveStub(() => status);
      authMock.getSession.mockResolvedValue({ data: { session: null } });

      renderBoard();

      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(
        () => {
          expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('session expired'),
            expect.objectContaining({ id: 'board-save-sign-in' }),
          );
        },
        { timeout: 3000 },
      );

      // The user stays on the canvas: no navigation to the login page.
      expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
      expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      // The unsaved work is on this device.
      expect(await getUnsavedPayload('b1')).not.toBeNull();

      // The session comes back in another tab; regaining focus retries and succeeds quietly.
      status = 200;
      authMock.getSession.mockResolvedValue({ data: { session: { id: 's1' } } });
      fireEvent(window, new Event('focus'));

      await waitFor(
        () => {
          expect(screen.getByText('Saved')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
      expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
      // A successful save clears the local copy.
      await waitFor(async () => expect(await getUnsavedPayload('b1')).toBeNull());
    });

    it('uses one stable toast id for repeated save failures instead of stacking them', async () => {
      saveStub(() => 500);

      renderBoard();

      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(
        () => {
          expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('Could not save'),
            expect.objectContaining({ id: 'board-save-failed' }),
          );
        },
        { timeout: 3000 },
      );

      // The browser comes back online and the retry fails again; the toast is replaced, not added.
      fireEvent(window, new Event('online'));

      await waitFor(
        () => {
          const failureCalls = vi
            .mocked(toast.error)
            .mock.calls.filter((call) => call[1]?.id === 'board-save-failed');
          expect(failureCalls.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 3000 },
      );

      const ids = vi
        .mocked(toast.error)
        .mock.calls.filter((call) => call[1]?.id === 'board-save-failed')
        .map((call) => call[1]?.id);
      expect(new Set(ids).size).toBe(1);
    });

    it('stashes the encrypted scene on this device when the server fails', async () => {
      saveStub(() => 500);

      renderBoard();
      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(() => expect(screen.getByText('Save Error')).toBeInTheDocument(), {
        timeout: 3000,
      });
      const stash = await getUnsavedPayload('b1');
      expect(stash).not.toBeNull();
      // The stash is ciphertext in the v1 format, never the scene itself.
      expect(stash?.ciphertext[0]).toBe(0x01);
      expect(new TextDecoder().decode(stash?.ciphertext)).not.toContain('rect-1');
    });

    it('stashes the scene and reports the failure when the network is down', async () => {
      stubApi({ putPayload: () => networkFailure() });

      renderBoard();
      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(
        () => {
          expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('Could not save'),
            expect.objectContaining({ id: 'board-save-failed' }),
          );
        },
        { timeout: 3000 },
      );
      expect(screen.getByText('Save Error')).toBeInTheDocument();
      expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      expect(await getUnsavedPayload('b1')).not.toBeNull();
    });

    it('switches to read-only when the server revokes edit access', async () => {
      saveStub(() => 403);

      renderBoard();
      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(
        () => {
          expect(toast.warning).toHaveBeenCalledWith(
            expect.stringContaining('permission to edit this canvas has been revoked'),
            expect.anything(),
          );
        },
        { timeout: 3000 },
      );
      expect(screen.getByTestId('view-mode-opt')).toHaveTextContent('true');
      expect(await getUnsavedPayload('b1')).not.toBeNull();
    });
  });

  describe('an unsaved copy kept on this device', () => {
    const newerThanBoard = () => Date.now() + 60_000;

    it('offers it, restores it, and clears the banner', async () => {
      const ciphertext = await sealBoardPayload(
        validKey,
        { elements: [{ id: 'kept-offline' }] },
        { boardId: 'b1', keyVersion: 1, revision: 1 },
      );
      await saveUnsavedPayload('b1', ciphertext, newerThanBoard());

      renderBoard();

      await waitFor(() => {
        expect(
          screen.getByText(/Unsaved changes from .* are stored on this device/),
        ).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Restore unsaved changes' }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Restored unsaved changes');
      });
      expect(screen.queryByText(/are stored on this device/)).not.toBeInTheDocument();
      // The restored scene is saved; let that finish so it does not touch the next test's stash.
      await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument(), {
        timeout: 4000,
      });
    });

    it('discards it on request and deletes the local copy', async () => {
      const ciphertext = await sealBoardPayload(
        validKey,
        { elements: [{ id: 'kept-offline' }] },
        { boardId: 'b1', keyVersion: 1, revision: 1 },
      );
      await saveUnsavedPayload('b1', ciphertext, newerThanBoard());

      renderBoard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

      await waitFor(() => {
        expect(screen.queryByText(/are stored on this device/)).not.toBeInTheDocument();
      });
      expect(await getUnsavedPayload('b1')).toBeNull();
    });

    it('drops a copy that no longer decrypts and says so', async () => {
      const otherKey = await generateSymmetricKey();
      const ciphertext = await sealBoardPayload(
        otherKey,
        { elements: [{ id: 'unreadable' }] },
        { boardId: 'b1', keyVersion: 1, revision: 1 },
      );
      await saveUnsavedPayload('b1', ciphertext, newerThanBoard());

      renderBoard();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Restore unsaved changes' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Restore unsaved changes' }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'The unsaved copy could not be opened and was discarded.',
        );
      });
      expect(screen.queryByText(/are stored on this device/)).not.toBeInTheDocument();
      expect(await getUnsavedPayload('b1')).toBeNull();
    });

    it('does not offer a copy older than the stored board', async () => {
      const ciphertext = await sealBoardPayload(
        validKey,
        { elements: [{ id: 'stale' }] },
        { boardId: 'b1', keyVersion: 1, revision: 1 },
      );
      await saveUnsavedPayload('b1', ciphertext, 1);

      renderBoard();

      await waitFor(() => {
        expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      });
      expect(screen.queryByText(/are stored on this device/)).not.toBeInTheDocument();
    });
  });

  describe('opening a canvas and leaving it', () => {
    const savedScene = { elements: [{ id: 'kept', type: 'rectangle' }] };
    const sealedAt = (revision: number) =>
      sealBoardPayload(validKey, savedScene, { boardId: 'b1', keyVersion: 1, revision });

    const requestedRevision = (init: RequestInit | undefined) =>
      new Headers(init?.headers).get('x-board-revision');

    const payloadReads = (fetchMock: ReturnType<typeof stubApi>) =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          requestUrl(input).includes('/payload') && (init?.method ?? 'GET') === 'GET',
      );

    it('opens a canvas saved earlier from what the server holds, not from the copy an earlier visit cached', async () => {
      const payload = await sealedAt(3);
      const fetchMock = stubApi({
        board: () => jsonResponse(makeBoard({ hasPayload: true, revision: 3 })),
        getPayload: () => new Response(payload, { status: 200 }),
      });

      // The copy from before the first save says the board was never saved, at revision 0.
      renderBoard('/w/acme-corp/board/b1', (queryClient) =>
        queryClient.setQueryData(
          boardKeys.detail('acme-corp', 'b1'),
          makeBoard({ hasPayload: false, revision: 0 }),
        ),
      );

      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      expect(payloadReads(fetchMock)).toHaveLength(1);

      // The first save starts from the server's revision, so it is not refused as a conflict.
      fireEvent.click(screen.getByTestId('emit-change'));
      await waitFor(() => expect(putRequests(fetchMock)).toHaveLength(1), { timeout: 4000 });
      expect(requestedRevision(putRequests(fetchMock)[0]?.[1])).toBe('3');
      expect(screen.queryByText('This canvas was changed elsewhere.')).not.toBeInTheDocument();
    });

    it('keeps the open canvas when a later refresh of the board record fails', async () => {
      let failing = false;
      stubApi({
        board: () => (failing ? errorResponse(500, 'INTERNAL', 'Down') : jsonResponse(makeBoard())),
      });
      const { queryClient } = renderBoard();
      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      const opens = keyServiceMock.resolveBoardKey.mock.calls.length;

      failing = true;
      await queryClient.refetchQueries({ queryKey: boardKeys.detail('acme-corp', 'b1') });

      expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      expect(screen.queryByText('Canvas details could not be loaded')).not.toBeInTheDocument();
      expect(keyServiceMock.resolveBoardKey.mock.calls.length).toBe(opens);
    });

    it('writes nothing for a canvas that was only opened', async () => {
      const fetchMock = stubApi();
      renderBoard();
      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());

      // The editor reports its first render and every scroll or selection as a change.
      fireEvent.click(screen.getByTestId('emit-unchanged'));
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(putRequests(fetchMock)).toHaveLength(0);
      expect(screen.getByText('Saved')).toBeInTheDocument();
      expect(await getUnsavedPayload('b1')).toBeNull();
    });

    it('writes nothing for a saved canvas that was only opened', async () => {
      const payload = await sealedAt(2);
      const fetchMock = stubApi({
        board: () => jsonResponse(makeBoard({ hasPayload: true, revision: 2 })),
        getPayload: () => new Response(payload, { status: 200 }),
      });
      renderBoard();
      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());

      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(putRequests(fetchMock)).toHaveLength(0);
    });

    it('holds the person on the canvas until they decide, while changes are not saved', async () => {
      // The first attempt fails, so the work is still unsaved when the person tries to leave.
      let puts = 0;
      const fetchMock = stubApi({
        putPayload: () => (++puts === 1 ? networkFailure() : savedPayloadResponse()),
      });
      renderBoard();
      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('emit-change'));

      fireEvent.click(screen.getByText('Back'));
      expect(await screen.findByRole('dialog', { name: 'Leave this canvas?' })).toBeInTheDocument();
      expect(screen.queryByText('Workspace Dashboard')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Stay on this canvas' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalled();

      fireEvent.click(screen.getByText('Back'));
      fireEvent.click(await screen.findByRole('button', { name: 'Leave anyway' }));
      expect(await screen.findByText('Workspace Dashboard')).toBeInTheDocument();
      // Leaving anyway does not drop the edit: it is sent, and sent again after the failure.
      await waitFor(() => expect(puts).toBe(2), { timeout: 5000 });
    });

    it('asks again when a save failed, because that work is not on the server either', async () => {
      stubApi({ putPayload: () => errorResponse(500, 'SAVE_FAILED', 'Save failed') });
      renderBoard();
      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('emit-change'));
      await waitFor(() => expect(screen.getByText('Save Error')).toBeInTheDocument(), {
        timeout: 4000,
      });

      fireEvent.click(screen.getByText('Back'));

      expect(await screen.findByRole('dialog', { name: 'Leave this canvas?' })).toBeInTheDocument();
    });

    it('leaves without asking once everything is saved', async () => {
      const fetchMock = stubApi();
      renderBoard();
      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('emit-change'));
      await waitFor(() => expect(putRequests(fetchMock)).toHaveLength(1), { timeout: 4000 });
      await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Back'));

      expect(await screen.findByText('Workspace Dashboard')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('warns before the tab is closed or reloaded while changes are not saved, and not otherwise', async () => {
      stubApi({ putPayload: () => networkFailure() });
      renderBoard();
      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());

      const beforeEdit = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(beforeEdit);
      expect(beforeEdit.defaultPrevented).toBe(false);

      fireEvent.click(screen.getByTestId('emit-change'));
      const whileUnsaved = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(whileUnsaved);
      expect(whileUnsaved.defaultPrevented).toBe(true);

      // Still true after the save has failed: the work lives only in this browser.
      await waitFor(() => expect(screen.getByText('Save Error')).toBeInTheDocument(), {
        timeout: 4000,
      });
      const afterFailure = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(afterFailure);
      expect(afterFailure.defaultPrevented).toBe(true);
    });

    describe('when the canvas was changed elsewhere', () => {
      it('Reload opens what the server holds now and clears the banner', async () => {
        const newer = await sealedAt(7);
        let boardReads = 0;
        const fetchMock = stubApi({
          putPayload: () =>
            jsonResponse(
              {
                code: 'BOARD_CONFLICT',
                message: 'This canvas was modified elsewhere.',
                revision: 7,
              },
              { status: 409 },
            ),
          board: () => {
            boardReads += 1;
            // The first read is the open; once another session saved, the board is at revision 7.
            return jsonResponse(
              boardReads === 1 ? makeBoard() : makeBoard({ hasPayload: true, revision: 7 }),
            );
          },
          getPayload: () => new Response(newer, { status: 200 }),
        });
        renderBoard();
        await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('emit-change'));
        await waitFor(
          () => expect(screen.getByText('This canvas was changed elsewhere.')).toBeInTheDocument(),
          { timeout: 4000 },
        );

        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

        await waitFor(() => expect(payloadReads(fetchMock)).toHaveLength(1));
        await waitFor(() =>
          expect(screen.queryByText('This canvas was changed elsewhere.')).not.toBeInTheDocument(),
        );
        expect(boardReads).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('Saved')).toBeInTheDocument();
        // Nothing from before the reload is sent on top of what was just opened.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(putRequests(fetchMock)).toHaveLength(1);
      });

      it("Overwrite saves the person's scene on top of the server's revision", async () => {
        let puts = 0;
        const revisions: Array<string | null> = [];
        stubApi({
          putPayload: (init) => {
            puts += 1;
            revisions.push(requestedRevision(init));
            return puts === 1
              ? jsonResponse(
                  { code: 'BOARD_CONFLICT', message: 'Modified elsewhere.', revision: 7 },
                  { status: 409 },
                )
              : savedPayloadResponse(8);
          },
        });
        renderBoard();
        await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('emit-change'));
        await waitFor(
          () => expect(screen.getByText('This canvas was changed elsewhere.')).toBeInTheDocument(),
          { timeout: 4000 },
        );

        fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));

        await waitFor(() => expect(puts).toBe(2), { timeout: 4000 });
        expect(revisions).toEqual(['0', '7']);
        await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
      });
    });

    it('restores an unsaved copy that was made for an earlier revision, on top of the current one', async () => {
      const current = await sealedAt(5);
      const stashed = await sealBoardPayload(
        validKey,
        { elements: [{ id: 'kept-offline', type: 'rectangle' }] },
        { boardId: 'b1', keyVersion: 1, revision: 2 },
      );
      await saveUnsavedPayload('b1', stashed, Date.now() + 60_000);
      const fetchMock = stubApi({
        board: () => jsonResponse(makeBoard({ hasPayload: true, revision: 5 })),
        getPayload: () => new Response(current, { status: 200 }),
      });
      renderBoard();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Restore unsaved changes' })).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Restore unsaved changes' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restored unsaved changes'));
      expect(toast.error).not.toHaveBeenCalled();
      await waitFor(() => expect(putRequests(fetchMock)).toHaveLength(1), { timeout: 4000 });
      expect(requestedRevision(putRequests(fetchMock)[0]?.[1])).toBe('5');
    });
  });

  it('shows waiting for access when the project grant is still pending', async () => {
    stubApi({
      board: () =>
        jsonResponse(
          makeBoard({ title: 'Pending Board', projectName: 'Pending Project', memberKey: null }),
        ),
      workspace: makeWorkspace({ name: 'Acme Corp', encryptedOrgKey: null }),
    });

    renderBoard();

    await waitFor(() => {
      expect(screen.getByText('Waiting for access')).toBeInTheDocument();
      expect(screen.getByText(/An administrator needs to grant you access/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mock-excalidraw')).not.toBeInTheDocument();
  });

  function extractHeaders(raw?: HeadersInit): Record<string, string> {
    const result: Record<string, string> = {};
    if (!raw) return result;
    new Headers(raw).forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  describe('saving an old board after the project key rotated', () => {
    const rotatedBoard = (isPublic = false) =>
      jsonResponse(
        makeBoard({
          title: 'Rotated Board',
          keyVersion: 1,
          projectKeyVersion: 2,
          publicShareToken: isPublic ? 'public-token' : null,
          encryptedProjectKey: 'wrapped-project-key',
          memberKey: 'my-project-key',
        }),
      );

    beforeEach(async () => {
      keyServiceMock.resolveProjectKey.mockResolvedValue(await generateSymmetricKey());
    });

    it('re-seals under the current project key and sends the new wrapped board key', async () => {
      const puts: Array<{ headers: Record<string, string>; body: Uint8Array }> = [];
      stubApi({
        board: () => rotatedBoard(),
        putPayload: async (init) => {
          const bodyBuffer =
            init.body instanceof Blob
              ? await init.body.arrayBuffer()
              : init.body instanceof ArrayBuffer
                ? init.body
                : new ArrayBuffer(0);
          puts.push({ headers: extractHeaders(init.headers), body: new Uint8Array(bodyBuffer) });
          return jsonResponse({});
        },
      });

      renderBoard();

      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(() => expect(puts).toHaveLength(1), { timeout: 4000 });
      expect(puts[0]?.headers['x-encrypted-board-key']).toBeDefined();
      expect(puts[0]?.body[0]).toBe(0x01);
      const buffer = puts[0]?.body.buffer ?? new ArrayBuffer(0);
      expect(new DataView(buffer).getUint32(1, false)).toBe(2);
    }, 15000);

    it('does not re-key a board with an active public link', async () => {
      const puts: Array<{ headers: Record<string, string> }> = [];
      stubApi({
        board: () => rotatedBoard(true),
        putPayload: (init) => {
          puts.push({ headers: extractHeaders(init.headers) });
          return jsonResponse({});
        },
      });

      renderBoard();

      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(() => expect(puts).toHaveLength(1), { timeout: 8000 });
      expect(puts[0]?.headers['x-encrypted-board-key']).toBeUndefined();
    }, 15000);

    it('re-seals and retries silently when the server answers KEY_ROTATED', async () => {
      let puts = 0;
      stubApi({
        board: () => rotatedBoard(),
        putPayload: () => {
          puts += 1;
          return puts === 1
            ? errorResponse(409, 'KEY_ROTATED', 'The project key rotated')
            : savedPayloadResponse();
        },
      });

      renderBoard();

      await waitFor(() => expect(screen.getByTestId('mock-excalidraw')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('emit-change'));

      await waitFor(() => expect(puts).toBe(2), { timeout: 6000 });
      await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
      expect(toast.error).not.toHaveBeenCalledWith(
        'Could not save your changes.',
        expect.anything(),
      );
    }, 15000);
  });
});
