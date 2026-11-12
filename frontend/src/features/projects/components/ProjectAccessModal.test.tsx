import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { ProjectAccessModal } from './ProjectAccessModal';
import { renderWithProviders } from '@/test/render-with-providers';
import { emptyResponse, errorResponse, jsonResponse } from '@/test/http';
import { fixtureProject, fixtureWorkspace, stubManagementApi } from '@/test/management-api';
import type { ProjectMemberItem } from '@/features/projects/schemas';

const keys = vi.hoisted(() => ({
  prepareProjectGrant: vi.fn(),
}));

vi.mock('@/lib/keys', () => keys);
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ privateKey: null, publicKeySpki: null, isUnlocked: true }),
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const workspaceAdmin: ProjectMemberItem = {
  id: 'mem-owner',
  userId: 'u1',
  name: 'Lead Dev',
  email: 'lead@canvhq.internal',
  role: 'admin',
  source: 'workspace',
  keyStatus: 'granted',
};
const pendingSam: ProjectMemberItem = {
  id: 'pm-2',
  userId: 'u2',
  name: 'Sam Engineer',
  email: 'sam@canvhq.internal',
  role: 'editor',
  source: 'project',
  keyStatus: 'pending',
};
const grantedAlex: ProjectMemberItem = {
  id: 'pm-3',
  userId: 'u3',
  name: 'Alex Admin',
  email: 'alex@canvhq.internal',
  role: 'viewer',
  source: 'project',
  keyStatus: 'granted',
};

const pagination = {
  page: 1,
  limit: 20,
  total: 3,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ProjectAccessModal>> = {},
  members: ProjectMemberItem[] = [workspaceAdmin, pendingSam, grantedAlex],
) {
  const runRotation = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  renderWithProviders(
    <ProjectAccessModal
      workspace={fixtureWorkspace}
      project={fixtureProject}
      members={members}
      pagination={pagination}
      onPrevPage={vi.fn()}
      onNextPage={vi.fn()}
      canManage
      runRotation={runRotation}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { runRotation, onClose };
}

/** The people the server offers for assigning have arrived. */
const assignableLoaded = () => screen.findByRole('option', { name: /Sam Engineer/ });

/** The dialog knows the caller is an Owner or Admin: only then does it show the workspace-role note. */
const accessLoaded = () => screen.findByText(/workspace role is changed under Workspace Members/);

function unassignButtonFor(memberName: string): HTMLElement {
  const row = screen.getByText(memberName).closest('.grid');
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${memberName}`);
  return within(row).getByTitle('Unassign from project');
}

beforeEach(() => {
  keys.prepareProjectGrant.mockReset();
  keys.prepareProjectGrant.mockResolvedValue({
    encryptedProjectKey: 'wrapped-for-target',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ProjectAccessModal', () => {
  it('shows workspace admins once, marks a pending grant, and offers only the people the server lists', async () => {
    stubManagementApi();
    renderModal();

    expect(screen.getByText('Project Access · Core Architecture')).toBeInTheDocument();
    expect(screen.getByText('Admin (workspace)')).toBeInTheDocument();
    expect(screen.getByText('Pending access')).toBeInTheDocument();
    expect(await assignableLoaded()).toHaveTextContent('Sam Engineer (sam@canvhq.internal)');
    expect(
      screen.queryByRole('option', { name: /Lead Dev \(lead@canvhq\.internal\)/i }),
    ).not.toBeInTheDocument();
  });

  it('hides the assign form and member controls without permission, and never asks for the people to assign', async () => {
    const api = stubManagementApi();
    renderModal({ canManage: false });
    await screen.findByText(/These roles apply to this project only/);

    expect(screen.queryByText('Select workspace member to assign...')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant access' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Unassign from project')).not.toBeInTheDocument();
    expect(api.requests('GET', '/api/projects/p1/assignable-members')).toHaveLength(0);
  });

  it('calls the project role "Project admin" and says the roles apply to this project only', async () => {
    stubManagementApi();
    renderModal();

    expect(
      screen.getByText('These roles apply to this project only.', { exact: false }),
    ).toBeVisible();
    expect(screen.getAllByRole('option', { name: 'Project admin' })).not.toHaveLength(0);
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
    await accessLoaded();
  });

  it('points an Owner or Admin to Workspace Members for the workspace role, and nobody else', async () => {
    const api = stubManagementApi([], 'editor');
    renderModal();

    await assignableLoaded();
    await waitFor(() => expect(api.requests('GET', '/api/access/me')).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/apply to this project only/)).toBeVisible());
    expect(screen.queryByText(/Workspace Members/)).not.toBeInTheDocument();
  });

  it('shows your own row as plain text, with no way to change or remove yourself, and leaves the others editable', () => {
    stubManagementApi();
    const me: ProjectMemberItem = { ...grantedAlex, userId: 'u1', name: 'Me Myself' };
    renderModal({}, [me, pendingSam]);

    expect(screen.getByText('Me Myself')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role for Me Myself')).not.toBeInTheDocument();
    const myRow = screen.getByText('Me Myself').closest('.grid');
    if (!(myRow instanceof HTMLElement)) throw new Error('No row for Me Myself');
    expect(within(myRow).queryByTitle('Unassign from project')).not.toBeInTheDocument();
    // The role is still shown, once under the name and once where the control would be.
    expect(within(myRow).getAllByText('viewer')).toHaveLength(2);
    // Somebody else in the same list is still manageable.
    expect(unassignButtonFor('Sam Engineer')).toBeInTheDocument();
  });

  it('grants a pending member only after confirming, and sends nothing before', async () => {
    const api = stubManagementApi();
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));

    const dialog = await screen.findByRole('dialog', { name: /Grant access to Sam Engineer/i });
    expect(api.requests('POST', '/api/projects/p1/members')).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and grant' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Grant access/i })).not.toBeInTheDocument(),
    );
    expect(api.requests('POST', '/api/projects/p1/members').map((r) => r.body)).toEqual([
      { userId: 'u2', role: 'editor', encryptedProjectKey: 'wrapped-for-target' },
    ]);
  });

  it('keeps the grant dialog open and reports the error when the server refuses the grant', async () => {
    stubManagementApi([
      {
        method: 'POST',
        path: '/api/projects/p1/members',
        respond: () => errorResponse(409, 'CONFLICT', 'That key version is stale'),
      },
    ]);
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    const dialog = await screen.findByRole('dialog', { name: /Grant access to Sam Engineer/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and grant' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That key version is stale'));
    expect(screen.getByRole('dialog', { name: /Grant access to Sam Engineer/i })).toBeVisible();
  });

  it('does not open the grant dialog when the key cannot be prepared', async () => {
    keys.prepareProjectGrant.mockRejectedValue(new Error('no public key'));
    stubManagementApi();
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('No access was granted')),
    );
    expect(screen.queryByRole('dialog', { name: /Grant access/i })).not.toBeInTheDocument();
  });

  it('assigns a workspace member and clears the selection', async () => {
    const api = stubManagementApi();
    renderModal({}, [workspaceAdmin]);
    await assignableLoaded();

    const select = screen.getByLabelText('Workspace member to assign');
    fireEvent.change(select, { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Member' }));

    await waitFor(() => expect(select).toHaveValue(''));
    expect(api.requests('POST', '/api/projects/p1/members').map((r) => r.body)).toEqual([
      { userId: 'u2', role: 'editor', encryptedProjectKey: 'wrapped-for-target' },
    ]);
  });

  it('creates nothing when the key cannot be wrapped for the person being assigned', async () => {
    keys.prepareProjectGrant.mockRejectedValue(new Error('wrap failed'));
    const api = stubManagementApi();
    renderModal({}, [workspaceAdmin]);
    await assignableLoaded();

    fireEvent.change(screen.getByLabelText('Workspace member to assign'), {
      target: { value: 'u2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Member' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('No access was granted')),
    );
    expect(api.requests('POST', '/api/projects/p1/members')).toHaveLength(0);
    expect(screen.getByLabelText('Workspace member to assign')).toHaveValue('u2');
  });

  it('keeps the selection and reports the error when the server refuses the assignment', async () => {
    stubManagementApi([
      {
        method: 'POST',
        path: '/api/projects/p1/members',
        respond: () => errorResponse(403, 'FORBIDDEN', 'You cannot manage this project'),
      },
    ]);
    renderModal({}, [workspaceAdmin]);
    await assignableLoaded();

    fireEvent.change(screen.getByLabelText('Workspace member to assign'), {
      target: { value: 'u2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Member' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You cannot manage this project'));
    expect(screen.getByLabelText('Workspace member to assign')).toHaveValue('u2');
  });

  it('changes a member role, and reports the error when the server refuses', async () => {
    const api = stubManagementApi([
      {
        method: 'PATCH',
        path: '/api/projects/p1/members/u3',
        respond: () => errorResponse(403, 'FORBIDDEN', 'Cannot change this role'),
      },
    ]);
    renderModal();

    fireEvent.change(screen.getByLabelText('Role for Alex Admin'), {
      target: { value: 'editor' },
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot change this role'));
    expect(api.requests('PATCH', '/api/projects/p1/members/u3')[0]?.body).toEqual({
      role: 'editor',
    });
    expect(screen.getByLabelText('Role for Alex Admin')).toHaveValue('viewer');
  });

  it('removes a member, then re-keys the projects the server flagged', async () => {
    stubManagementApi([
      {
        method: 'DELETE',
        path: '/api/projects/p1/members/u3',
        respond: () => jsonResponse({ rotationDue: ['p1'] }),
      },
    ]);
    const { runRotation } = renderModal();
    await accessLoaded();

    fireEvent.click(unassignButtonFor('Alex Admin'));

    await waitFor(() => expect(runRotation).toHaveBeenCalledWith(['p1']));
  });

  it('removes a member for a Project Admin who holds no workspace key, and says when the key will change', async () => {
    const api = stubManagementApi(
      [
        {
          method: 'DELETE',
          path: '/api/projects/p1/members/u3',
          respond: () => jsonResponse({ rotationDue: ['p1'] }),
        },
      ],
      'editor',
    );
    const { runRotation } = renderModal();
    await waitFor(() => expect(api.requests('GET', '/api/access/me')).toHaveLength(1));
    await assignableLoaded();

    fireEvent.click(unassignButtonFor('Alex Admin'));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('the next time a workspace owner or admin opens this workspace'),
      ),
    );
    expect(api.requests('DELETE', '/api/projects/p1/members/u3')).toHaveLength(1);
    expect(runRotation).not.toHaveBeenCalled();
  });

  it('removes a member without re-keying when the server flags nothing', async () => {
    stubManagementApi([
      { method: 'DELETE', path: '/api/projects/p1/members/u3', respond: () => emptyResponse() },
    ]);
    const { runRotation } = renderModal();

    fireEvent.click(unassignButtonFor('Alex Admin'));

    await waitFor(() => expect(toast.error).not.toHaveBeenCalled());
    expect(runRotation).not.toHaveBeenCalled();
  });

  it('reports the error and keeps the member listed when removal fails', async () => {
    stubManagementApi([
      {
        method: 'DELETE',
        path: '/api/projects/p1/members/u3',
        respond: () => errorResponse(500, 'INTERNAL', 'Could not remove that member'),
      },
    ]);
    const { runRotation } = renderModal();

    fireEvent.click(unassignButtonFor('Alex Admin'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not remove that member'));
    expect(runRotation).not.toHaveBeenCalled();
    expect(screen.getByText('Alex Admin')).toBeInTheDocument();
  });
});
