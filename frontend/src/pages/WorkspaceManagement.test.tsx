import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { WorkspaceManagement } from './WorkspaceManagement';
import { renderWithProviders } from '@/test/render-with-providers';
import { errorResponse, jsonResponse } from '@/test/http';
import { fixtureProject, stubManagementApi, type ManagementRole } from '@/test/management-api';

vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ isUnlocked: false, publicKeySpki: null, privateKey: null }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: { user: { id: 'u1', name: 'Lead Dev', email: 'lead@canvhq.internal' } },
  }),
  signOut: vi.fn(),
  authClient: {
    organization: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      setActive: vi.fn().mockResolvedValue({}),
    },
  },
}));

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/w/:slug/management" element={<WorkspaceManagement />} />
      <Route path="/w/:slug" element={<div>Boards Page</div>} />
      <Route path="/create-workspace" element={<div>Create workspace</div>} />
    </Routes>,
    '/w/acme-eng/management',
  );
}

const pageInfo = {
  page: 1,
  limit: 20,
  total: 25,
  totalPages: 2,
  hasNextPage: true,
  hasPrevPage: false,
};

describe('WorkspaceManagement page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('composes workspace details, projects, real members and the way back', async () => {
    stubManagementApi();
    renderPage();

    expect(screen.getAllByText('Workspace Management').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Back to Projects').length).toBeGreaterThan(0);

    expect(await screen.findByDisplayValue('Acme Eng')).toBeInTheDocument();
    expect((await screen.findAllByText('Core Architecture')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Lead Dev')).toBeInTheDocument();
    expect(screen.getByText('(You)')).toBeInTheDocument();
    expect(screen.getByText('sam@canvhq.internal')).toBeInTheDocument();
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument();
    expect(screen.queryByText('Elena Rostova')).not.toBeInTheDocument();
  });

  it('renders clean Next / Previous pagination controls for projects and members', async () => {
    stubManagementApi([
      {
        method: 'GET',
        path: '/api/projects',
        respond: () => jsonResponse({ items: [fixtureProject], pagination: pageInfo }),
      },
      {
        method: 'GET',
        path: '/api/workspaces/org-1/members',
        respond: () =>
          jsonResponse({
            items: [
              { id: 'm1', userId: 'u1', name: 'Alice', email: 'alice@acme.dev', role: 'owner' },
            ],
            pagination: pageInfo,
          }),
      },
    ]);
    renderPage();

    expect(await screen.findByText(/SHOWING 1–20 OF 25 PROJECTS/i)).toBeInTheDocument();
    expect(await screen.findByText(/SHOWING 1–20 OF 25 MEMBERS/i)).toBeInTheDocument();

    const prevButtons = screen.getAllByRole('button', { name: /← PREVIOUS/i });
    const nextButtons = screen.getAllByRole('button', { name: /NEXT →/i });
    expect(prevButtons).toHaveLength(2);
    expect(nextButtons).toHaveLength(2);
    expect(prevButtons[0]).toBeDisabled();
    expect(nextButtons[0]).toBeEnabled();

    expect(screen.queryByRole('button', { name: /^1$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^2$/ })).not.toBeInTheDocument();
  });

  it('asks for the next page of projects when Next is pressed', async () => {
    const api = stubManagementApi([
      {
        method: 'GET',
        path: '/api/projects',
        respond: () => jsonResponse({ items: [fixtureProject], pagination: pageInfo }),
      },
    ]);
    renderPage();

    await screen.findByText(/SHOWING 1–20 OF 25 PROJECTS/i);
    const [projectsNext] = screen.getAllByRole('button', { name: /NEXT →/i });
    if (!projectsNext) throw new Error('Expected a Next button');
    fireEvent.click(projectsNext);

    await waitFor(() =>
      expect(api.requests('GET', '/api/projects').some((r) => r.url.includes('page=2'))).toBe(true),
    );
  });

  it.each<[ManagementRole, RegExp, string]>([
    ['owner', /owner/i, 'Admin · all projects'],
    ['admin', /admin/i, 'Admin · all projects'],
  ])('shows the role badge and project role for an %s', async (role, roleText, projectRole) => {
    stubManagementApi([], role);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('role-badge')).toHaveTextContent(roleText));
    await waitFor(() =>
      expect(screen.getByTestId('project-role-badge')).toHaveTextContent(projectRole),
    );
  });

  it('keeps the owner-only controls from an admin', async () => {
    stubManagementApi([], 'admin');
    renderPage();

    await screen.findByText('Core Architecture', { selector: 'span.text-xs.font-bold' });
    expect(screen.getByRole('button', { name: /New Project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invite member/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transfer ownership/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Workspace/i })).not.toBeInTheDocument();
  });

  it('offers a retry when the projects or members cannot be loaded', async () => {
    let failing = true;
    stubManagementApi([
      {
        method: 'GET',
        path: '/api/workspaces/org-1/members',
        respond: () =>
          failing ? errorResponse(500, 'INTERNAL', 'Members are down') : jsonResponse([]),
      },
    ]);
    renderPage();

    expect(await screen.findByText('Could not load this workspace')).toBeInTheDocument();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(screen.queryByText('Could not load this workspace')).not.toBeInTheDocument(),
    );
  });

  it('sends the user to create a workspace when the workspace cannot be found', async () => {
    stubManagementApi([
      {
        method: 'GET',
        path: '/api/workspaces/acme-eng',
        respond: () => errorResponse(404, 'NOT_FOUND', 'Workspace not found'),
      },
    ]);
    renderPage();

    expect(await screen.findByText('Create workspace')).toBeInTheDocument();
  });
});
