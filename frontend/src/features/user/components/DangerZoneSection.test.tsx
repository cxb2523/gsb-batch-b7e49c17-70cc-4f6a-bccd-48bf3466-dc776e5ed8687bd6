import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { DangerZoneSection } from './DangerZoneSection';
import { signOut } from '@/lib/auth-client';
import { clearLocalKeyMaterial } from '@/lib/key-store';
import { jsonResponse, emptyResponse, errorResponse } from '@/test/http';
import { stubFetchRoutes, requestsTo, jsonBody } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/key-store', () => ({ clearLocalKeyMaterial: vi.fn() }));

const sharedWorkspace = {
  id: 'org_1',
  name: 'Acme Corp',
  slug: 'acme-corp',
  otherMembers: [
    { id: 'mem_2', userId: 'usr_2', name: 'Alice', email: 'alice@local.com', role: 'admin' },
    { id: 'mem_3', userId: 'usr_3', name: 'Bob', email: 'bob@local.com', role: 'editor' },
  ],
};
const soloWorkspace = { id: 'org_2', name: 'Side Project', slug: 'side', otherMembers: [] };

async function openModal() {
  fireEvent.click(screen.getByRole('button', { name: /Delete Personal Account/i }));
  await screen.findByText('Delete Account & Transfer Workspaces');
}

function confirmDeletion() {
  fireEvent.change(screen.getByLabelText(/Type/i), { target: { value: 'DELETE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently Delete Account' }));
}

describe('DangerZoneSection account deletion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows an error with retry, and no delete form, when owned workspaces cannot be checked', async () => {
    stubFetchRoutes({
      'GET /api/user/owned-workspaces': () => errorResponse(500, 'INTERNAL', 'Lookup failed'),
    });

    renderWithProviders(<DangerZoneSection />);
    await openModal();

    expect(await screen.findByText('Lookup failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Permanently Delete Account' })).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('sends the default and the chosen successor, then clears keys and signs out', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/user/owned-workspaces': () => jsonResponse([sharedWorkspace]),
      'POST /api/user/delete-account': () => emptyResponse(),
    });

    renderWithProviders(<DangerZoneSection />);
    await openModal();
    fireEvent.change(await screen.findByLabelText(/Transfer ownership to:/i), {
      target: { value: 'mem_3' },
    });
    confirmDeletion();

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(clearLocalKeyMaterial).toHaveBeenCalled();
    const [, init] = requestsTo(fetchMock, 'POST /api/user/delete-account')[0] ?? [];
    expect(jsonBody(init)).toEqual({
      transfers: { org_1: 'mem_3' },
      confirmSoleDeletion: false,
    });
  });

  it('keeps the modal open with the server error when deletion fails, and does not sign out', async () => {
    stubFetchRoutes({
      'GET /api/user/owned-workspaces': () => jsonResponse([sharedWorkspace]),
      'POST /api/user/delete-account': () =>
        errorResponse(409, 'OWNERSHIP', 'Ownership could not be transferred'),
    });

    renderWithProviders(<DangerZoneSection />);
    await openModal();
    await screen.findByLabelText(/Transfer ownership to:/i);
    confirmDeletion();

    expect(await screen.findByText('Ownership could not be transferred')).toBeInTheDocument();
    expect(screen.getByText('Delete Account & Transfer Workspaces')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Permanently Delete Account' })).toBeEnabled();
    expect(signOut).not.toHaveBeenCalled();
    expect(clearLocalKeyMaterial).not.toHaveBeenCalled();
  });

  it('requires confirming the deletion of sole-member workspaces', async () => {
    const fetchMock = stubFetchRoutes({
      'GET /api/user/owned-workspaces': () => jsonResponse([soloWorkspace]),
    });

    renderWithProviders(<DangerZoneSection />);
    await openModal();
    await screen.findByText('Side Project');
    confirmDeletion();

    expect(
      await screen.findByText('Please confirm deletion of your sole-member workspace(s).'),
    ).toBeInTheDocument();
    expect(requestsTo(fetchMock, 'POST /api/user/delete-account')).toHaveLength(0);
  });
});
