import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { MembersSection } from './MembersSection';
import { renderWithProviders } from '@/test/render-with-providers';
import { emptyResponse, errorResponse, jsonResponse } from '@/test/http';
import {
  fixtureInvitation,
  fixtureMembers,
  fixtureProject,
  fixtureWorkspace,
  stubManagementApi,
} from '@/test/management-api';

const keys = vi.hoisted(() => ({
  fetchColleaguePublicKey: vi.fn(),
  resolveOrgKey: vi.fn(),
  wrapWorkspaceKeyForMember: vi.fn(),
}));
const keyContext = vi.hoisted(() => ({ isUnlocked: true, privateKey: null }));

vi.mock('@/lib/keys', () => keys);
vi.mock('@/context/KeyContext', () => ({ useKeyContext: () => keyContext }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const workspace = { ...fixtureWorkspace, encryptedOrgKey: 'wrapped-workspace-key' };
const pagination = {
  page: 1,
  limit: 20,
  total: 3,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

function renderSection(overrides: Partial<React.ComponentProps<typeof MembersSection>> = {}) {
  const runRotation = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(
    <MembersSection
      workspace={workspace}
      members={fixtureMembers}
      pagination={pagination}
      onPrevPage={vi.fn()}
      onNextPage={vi.fn()}
      invitations={[fixtureInvitation]}
      projects={[fixtureProject]}
      currentUserId="u1"
      can={() => true}
      runRotation={runRotation}
      {...overrides}
    />,
  );
  return { runRotation };
}

const roleSelect = (name: string) => screen.getByLabelText(`Role for ${name}`);

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('.grid');
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${name}`);
  return row;
}

beforeEach(() => {
  keyContext.isUnlocked = true;
  keys.fetchColleaguePublicKey.mockReset().mockResolvedValue('target-public-key');
  keys.resolveOrgKey.mockReset().mockResolvedValue({});
  keys.wrapWorkspaceKeyForMember.mockReset().mockResolvedValue('wrapped-for-promoted-admin');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MembersSection', () => {
  it('lists members and open invitations with their status', () => {
    stubManagementApi();
    renderSection();

    expect(screen.getByText('Workspace Members & Access Control')).toBeInTheDocument();
    expect(screen.getByText('(You)')).toBeInTheDocument();
    expect(screen.getByText('sam@canvhq.internal')).toBeInTheDocument();
    expect(screen.getByText('invited-dev@canvhq.internal')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Copy Link')).toBeInTheDocument();
  });

  it('shows the empty state when there is nobody to list', () => {
    stubManagementApi();
    renderSection({ members: [], invitations: [] });

    expect(screen.getByText('No members or pending invitations found.')).toBeInTheDocument();
  });

  describe('changing a role', () => {
    it('shows your own role in the same pill as the Owner, so an Admin cannot step down from this page', () => {
      stubManagementApi();
      // Alex Admin is the signed-in person.
      renderSection({ currentUserId: 'u3' });

      expect(screen.queryByLabelText('Role for Alex Admin')).not.toBeInTheDocument();
      expect(screen.getByText('(You)')).toBeInTheDocument();
      const rolePill = within(rowOf('Alex Admin')).getByText('admin', {
        selector: 'span.uppercase',
      });
      const ownerPill = within(rowOf('Lead Dev')).getByText('owner', {
        selector: 'span.uppercase',
      });
      expect(rolePill.className).toBe(ownerPill.className);
      // Everybody else can still be changed.
      expect(roleSelect('Sam Engineer')).toBeInTheDocument();
    });

    it('sends the new role for a demotion', async () => {
      const api = stubManagementApi([
        {
          method: 'PATCH',
          path: '/api/workspaces/org-1/members/mem-2',
          respond: () => jsonResponse({ id: 'mem-2', role: 'viewer' }),
        },
      ]);
      renderSection();

      fireEvent.change(roleSelect('Sam Engineer'), { target: { value: 'viewer' } });

      await waitFor(() =>
        expect(api.requests('PATCH', '/api/workspaces/org-1/members/mem-2')).toHaveLength(1),
      );
      expect(api.requests('PATCH', '/api/workspaces/org-1/members/mem-2')[0]?.body).toEqual({
        role: 'viewer',
      });
    });

    it('reports the server error and leaves the role as it was', async () => {
      stubManagementApi([
        {
          method: 'PATCH',
          path: '/api/workspaces/org-1/members/mem-2',
          respond: () => errorResponse(500, 'INTERNAL', 'Could not update member role'),
        },
      ]);
      renderSection();

      fireEvent.change(roleSelect('Sam Engineer'), { target: { value: 'viewer' } });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update member role'));
      expect(roleSelect('Sam Engineer')).toHaveValue('editor');
    });

    it('re-keys the workspace when the server says a demotion made rotation due', async () => {
      stubManagementApi([
        {
          method: 'PATCH',
          path: '/api/workspaces/org-1/members/mem-3',
          respond: () => jsonResponse({ id: 'mem-3', role: 'editor', rotationDue: ['p1'] }),
        },
      ]);
      const { runRotation } = renderSection();

      fireEvent.change(roleSelect('Alex Admin'), { target: { value: 'editor' } });

      await waitFor(() => expect(runRotation).toHaveBeenCalledWith(['p1'], true));
    });
  });

  describe('promoting a member to admin carries the workspace key', () => {
    const patches = (api: ReturnType<typeof stubManagementApi>) =>
      api.requests('PATCH', '/api/workspaces/org-1/members/mem-2');

    it('refuses while the viewer is locked, and changes nothing', async () => {
      keyContext.isUnlocked = false;
      const api = stubManagementApi();
      renderSection();

      fireEvent.change(roleSelect('Sam Engineer'), { target: { value: 'admin' } });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Unlock encryption')),
      );
      expect(roleSelect('Sam Engineer')).toHaveValue('editor');
      expect(patches(api)).toHaveLength(0);
    });

    it('refuses a member who has not set up encryption', async () => {
      keys.fetchColleaguePublicKey.mockRejectedValue(new Error('not found'));
      const api = stubManagementApi();
      renderSection();

      fireEvent.change(roleSelect('Sam Engineer'), { target: { value: 'admin' } });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('has not set up encryption yet'),
        ),
      );
      expect(patches(api)).toHaveLength(0);
    });

    it('refuses when the workspace key cannot be wrapped for them', async () => {
      keys.wrapWorkspaceKeyForMember.mockRejectedValue(new Error('wrap failed'));
      const api = stubManagementApi();
      renderSection();

      fireEvent.change(roleSelect('Sam Engineer'), { target: { value: 'admin' } });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Could not prepare the workspace key for Sam Engineer.',
        ),
      );
      expect(patches(api)).toHaveLength(0);
    });

    it('leaves the role unchanged when the server refuses', async () => {
      stubManagementApi([
        {
          method: 'PATCH',
          path: '/api/workspaces/org-1/members/mem-2',
          respond: () => errorResponse(500, 'INTERNAL', 'Could not update member role'),
        },
      ]);
      renderSection();

      fireEvent.change(roleSelect('Sam Engineer'), { target: { value: 'admin' } });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update member role'));
      expect(roleSelect('Sam Engineer')).toHaveValue('editor');
    });

    it('sends the role and the wrapped key in one request, and never calls the self-key endpoint', async () => {
      const api = stubManagementApi([
        {
          method: 'PATCH',
          path: '/api/workspaces/org-1/members/mem-2',
          respond: () => jsonResponse({ id: 'mem-2', role: 'admin' }),
        },
      ]);
      renderSection();

      fireEvent.change(roleSelect('Sam Engineer'), { target: { value: 'admin' } });

      await waitFor(() => expect(patches(api)).toHaveLength(1));
      expect(patches(api)[0]?.body).toEqual({
        role: 'admin',
        encryptedOrgKey: 'wrapped-for-promoted-admin',
      });
      expect(api.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/key'))).toHaveLength(
        0,
      );
    });
  });

  describe('removing a member', () => {
    const confirmRemoval = async (name: string) => {
      const row = screen.getByText(name).closest('.grid');
      if (!(row instanceof HTMLElement)) throw new Error(`No row for ${name}`);
      fireEvent.click(within(row).getByTitle('Remove member'));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove Member' }),
      );
    };

    it('removes after confirmation and says so', async () => {
      const api = stubManagementApi([
        {
          method: 'DELETE',
          path: '/api/workspaces/org-1/members/mem-2',
          respond: () => emptyResponse(),
        },
      ]);
      const { runRotation } = renderSection();

      await confirmRemoval('Sam Engineer');

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Member removed from workspace'),
      );
      expect(api.requests('DELETE', '/api/workspaces/org-1/members/mem-2')).toHaveLength(1);
      expect(runRotation).not.toHaveBeenCalled();
    });

    it('re-keys the workspace first when the server lists projects due for rotation', async () => {
      stubManagementApi([
        {
          method: 'DELETE',
          path: '/api/workspaces/org-1/members/mem-3',
          respond: () => jsonResponse({ rotationDue: ['p1'] }),
        },
      ]);
      const { runRotation } = renderSection();

      await confirmRemoval('Alex Admin');

      await waitFor(() => expect(runRotation).toHaveBeenCalledWith(['p1'], true));
    });

    it('reports the server error and keeps the member when removal fails', async () => {
      stubManagementApi([
        {
          method: 'DELETE',
          path: '/api/workspaces/org-1/members/mem-2',
          respond: () => errorResponse(403, 'FORBIDDEN', 'You cannot remove this member'),
        },
      ]);
      const { runRotation } = renderSection();

      await confirmRemoval('Sam Engineer');

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('You cannot remove this member'),
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(runRotation).not.toHaveBeenCalled();
      expect(screen.getByText('Sam Engineer')).toBeInTheDocument();
    });

    it('offers no removal for the owner or for yourself', () => {
      stubManagementApi();
      renderSection();

      expect(screen.getAllByTitle('Remove member')).toHaveLength(2);
    });
  });

  describe('revoking an invitation', () => {
    const confirmRevoke = () => {
      fireEvent.click(screen.getByTitle('Revoke invitation'));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke Invitation' }),
      );
    };

    it('revokes after confirmation and says so', async () => {
      const api = stubManagementApi([
        {
          method: 'DELETE',
          path: '/api/workspaces/org-1/invitations/inv_1',
          respond: () => emptyResponse(),
        },
      ]);
      renderSection();

      confirmRevoke();

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation revoked'));
      expect(api.requests('DELETE', '/api/workspaces/org-1/invitations/inv_1')).toHaveLength(1);
    });

    it('reports the server error and keeps the invitation when revoking fails', async () => {
      stubManagementApi([
        {
          method: 'DELETE',
          path: '/api/workspaces/org-1/invitations/inv_1',
          respond: () => errorResponse(500, 'INTERNAL', 'Could not revoke the invitation'),
        },
      ]);
      renderSection();

      confirmRevoke();

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Could not revoke the invitation'),
      );
      expect(screen.getByText('invited-dev@canvhq.internal')).toBeInTheDocument();
    });
  });

  describe('inviting a colleague', () => {
    const sendInvite = (email: string) => {
      fireEvent.click(screen.getByRole('button', { name: /Invite member/i }));
      fireEvent.change(screen.getByPlaceholderText('colleague@company.com'), {
        target: { value: email },
      });
      fireEvent.click(screen.getByRole('button', { name: /Send Invite/i }));
    };

    it('shows the generated invitation link', async () => {
      const api = stubManagementApi();
      renderSection();

      sendInvite('architect@acme.dev');

      expect(
        await screen.findByText(/Invitation created for architect@acme\.dev!/i),
      ).toBeInTheDocument();
      expect(api.requests('POST', '/api/workspaces/org-1/members/invite')[0]?.body).toEqual({
        email: 'architect@acme.dev',
        role: 'editor',
      });
    });

    it('shows why the invitation failed', async () => {
      stubManagementApi([
        {
          method: 'POST',
          path: '/api/workspaces/org-1/members/invite',
          respond: () => errorResponse(409, 'CONFLICT', 'That person is already a member'),
        },
      ]);
      renderSection();

      sendInvite('sam@canvhq.internal');

      expect(await screen.findByRole('alert')).toHaveTextContent('That person is already a member');
      expect(screen.queryByText(/Invitation created for/)).not.toBeInTheDocument();
    });

    it('sends the address without the spaces around it (the server lower-cases it)', async () => {
      const api = stubManagementApi();
      renderSection();

      sendInvite('  Architect@Acme.DEV ');

      await waitFor(() =>
        expect(api.requests('POST', '/api/workspaces/org-1/members/invite')).toHaveLength(1),
      );
      expect(api.requests('POST', '/api/workspaces/org-1/members/invite')[0]?.body).toMatchObject({
        email: 'Architect@Acme.DEV',
      });
    });

    it('says why an address that is far too long is refused, and sends nothing', async () => {
      const api = stubManagementApi();
      renderSection();

      sendInvite(`${'a'.repeat(250)}@acme.dev`);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Email address cannot exceed 254 characters',
      );
      expect(api.requests('POST', '/api/workspaces/org-1/members/invite')).toHaveLength(0);
    });

    it('offers Editor and Viewer, not Admin', () => {
      stubManagementApi();
      renderSection();

      fireEvent.click(screen.getByRole('button', { name: /Invite member/i }));

      const roles = within(screen.getByLabelText('Workspace role')).getAllByRole('option');
      expect(roles.map((option) => option.textContent)).toEqual(['Editor', 'Viewer']);
    });

    it('is not offered without permission to invite', () => {
      stubManagementApi();
      renderSection({ can: () => false });

      expect(screen.queryByRole('button', { name: /Invite member/i })).not.toBeInTheDocument();
    });
  });

  describe('ownership transfer', () => {
    it('is offered only on admin rows, and opens the confirmation with the exact wording', () => {
      stubManagementApi();
      renderSection();

      const buttons = screen.getAllByRole('button', { name: /Transfer ownership/i });
      expect(buttons).toHaveLength(1);
      const [transfer] = buttons;
      if (!transfer) throw new Error('Expected a transfer button');
      fireEvent.click(transfer);

      expect(
        screen.getByText(
          'Alex Admin becomes the Owner. You become an Admin. Only the Owner can delete the workspace or transfer it again.',
        ),
      ).toBeInTheDocument();
    });

    it('is not offered without the transfer permission', () => {
      stubManagementApi();
      renderSection({ can: (action) => action !== 'transfer' });

      expect(screen.queryByRole('button', { name: /Transfer ownership/i })).not.toBeInTheDocument();
    });
  });
});
