import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { ProjectsSection } from './ProjectsSection';
import { renderWithProviders } from '@/test/render-with-providers';
import { errorResponse, jsonResponse } from '@/test/http';
import {
  fixtureMembers,
  fixtureProject,
  fixtureWorkspace,
  stubManagementApi,
} from '@/test/management-api';

vi.mock('@/lib/keys', () => ({ prepareProjectGrant: vi.fn() }));
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ privateKey: null, publicKeySpki: null, isUnlocked: true }),
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const pagination = {
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

function renderSection(overrides: Partial<React.ComponentProps<typeof ProjectsSection>> = {}) {
  const onToggleCreating = vi.fn();
  renderWithProviders(
    <ProjectsSection
      workspace={fixtureWorkspace}
      projects={[fixtureProject]}
      pagination={pagination}
      onPrevPage={vi.fn()}
      onNextPage={vi.fn()}
      workspaceMembers={fixtureMembers}
      can={() => true}
      isAdministrator
      projectRoles={{ p1: 'admin' }}
      isCreating={false}
      onToggleCreating={onToggleCreating}
      runRotation={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
  return { onToggleCreating };
}

beforeEach(() => {});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ProjectsSection', () => {
  it('lists each project with its canvas count and the caller role', () => {
    stubManagementApi();
    renderSection();

    expect(screen.getByText('Core Architecture')).toBeInTheDocument();
    expect(screen.getByText('3 canvases')).toBeInTheDocument();
    expect(screen.getByTestId('project-role-badge')).toHaveTextContent('Admin · all projects');
  });

  it('shows the empty state when there are no projects', () => {
    stubManagementApi();
    renderSection({ projects: [] });

    expect(screen.getByText(/No projects in this workspace yet/)).toBeInTheDocument();
  });

  it('opens the project access dialog with the members the server lists', async () => {
    stubManagementApi();
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /Manage Access/i }));

    expect(await screen.findByText('Project Members & Permissions')).toBeInTheDocument();
    expect(await screen.findByText('Select workspace member to assign...')).toBeInTheDocument();
  });

  it('toggles the new project form through its button', () => {
    stubManagementApi();
    const { onToggleCreating } = renderSection();

    fireEvent.click(screen.getByRole('button', { name: /New Project/i }));

    expect(onToggleCreating).toHaveBeenCalledOnce();
  });

  it('hides the project actions without permission', () => {
    stubManagementApi();
    renderSection({ can: () => false });

    expect(screen.queryByRole('button', { name: /New Project/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Rename project')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete Project')).not.toBeInTheDocument();
  });

  describe('deleting a project', () => {
    it('asks in the app, not with a browser dialog', () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      stubManagementApi();
      renderSection();

      fireEvent.click(screen.getByTitle('Delete Project'));

      expect(confirmSpy).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'Delete Project' })).toBeInTheDocument();
      expect(
        within(dialog).getByText(/This action is permanent and cannot be undone/i),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('deletes after confirmation and says so', async () => {
      const api = stubManagementApi([
        {
          method: 'DELETE',
          path: '/api/projects/p1',
          respond: () => jsonResponse({ success: true }),
        },
      ]);
      renderSection();

      fireEvent.click(screen.getByTitle('Delete Project'));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Project' }),
      );

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Project deleted'));
      expect(api.requests('DELETE', '/api/projects/p1')).toHaveLength(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('reports the server error and leaves the project in place when the delete fails', async () => {
      stubManagementApi([
        {
          method: 'DELETE',
          path: '/api/projects/p1',
          respond: () => errorResponse(403, 'FORBIDDEN', 'Only admins can delete projects'),
        },
      ]);
      renderSection();

      fireEvent.click(screen.getByTitle('Delete Project'));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Project' }),
      );

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Only admins can delete projects'),
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByText('Core Architecture')).toBeInTheDocument();
    });
  });

  describe('renaming a project', () => {
    const startRename = (name: string) => {
      fireEvent.click(screen.getByTitle('Rename project'));
      fireEvent.change(screen.getByDisplayValue('Core Architecture'), { target: { value: name } });
      fireEvent.click(screen.getByRole('button', { name: 'Save project name' }));
    };

    it('saves the new name and leaves edit mode', async () => {
      const api = stubManagementApi([
        {
          method: 'PATCH',
          path: '/api/projects/p1',
          respond: () => jsonResponse({ ...fixtureProject, name: 'Platform' }),
        },
      ]);
      renderSection();

      startRename('Platform');

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Save project name' })).not.toBeInTheDocument(),
      );
      expect(api.requests('PATCH', '/api/projects/p1')[0]?.body).toEqual({ name: 'Platform' });
    });

    it('refuses a name with characters that are not allowed, says why, and sends nothing', async () => {
      const api = stubManagementApi();
      renderSection();

      startRename('Platform; DROP');

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringMatching(/^Project name can only use letters/),
        ),
      );
      expect(api.requests('PATCH', '/api/projects/p1')).toHaveLength(0);
      expect(screen.getByDisplayValue('Platform; DROP')).toBeInTheDocument();
    });

    it('reports the server error and stays in edit mode when the rename fails', async () => {
      stubManagementApi([
        {
          method: 'PATCH',
          path: '/api/projects/p1',
          respond: () => errorResponse(409, 'CONFLICT', 'A project with that name exists'),
        },
      ]);
      renderSection();

      startRename('Platform');

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('A project with that name exists'),
      );
      expect(screen.getByDisplayValue('Platform')).toBeInTheDocument();
    });
  });
});
