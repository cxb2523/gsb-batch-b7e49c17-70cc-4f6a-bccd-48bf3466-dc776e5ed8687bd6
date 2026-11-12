import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { OwnershipTransferDialog } from './OwnershipTransferDialog';
import { renderWithProviders } from '@/test/render-with-providers';
import { errorResponse } from '@/test/http';
import { fixtureMembers, stubManagementApi } from '@/test/management-api';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderDialog() {
  const alex = fixtureMembers[2];
  if (!alex) throw new Error('Fixture member missing');
  const onClose = vi.fn();
  renderWithProviders(
    <OwnershipTransferDialog workspaceId="org-1" target={alex} onClose={onClose} />,
  );
  return { onClose };
}

const confirm = () =>
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Transfer ownership' }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('OwnershipTransferDialog', () => {
  it('names the new owner', () => {
    stubManagementApi();
    renderDialog();

    expect(screen.getByText(/Alex Admin becomes the Owner/)).toBeInTheDocument();
  });

  it('transfers to the chosen member, announces it and closes', async () => {
    const api = stubManagementApi();
    const { onClose } = renderDialog();

    confirm();

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(toast.success).toHaveBeenCalledWith('Ownership transferred successfully');
    expect(api.requests('POST', '/api/workspaces/org-1/transfer-ownership')[0]?.body).toEqual({
      memberId: 'mem-3',
    });
  });

  it('stays open and shows the server message when the transfer fails', async () => {
    stubManagementApi([
      {
        method: 'POST',
        path: '/api/workspaces/org-1/transfer-ownership',
        respond: () =>
          errorResponse(400, 'BAD_REQUEST', 'The selected member does not hold the workspace key'),
      },
    ]);
    const { onClose } = renderDialog();

    confirm();

    expect(
      await screen.findByText('The selected member does not hold the workspace key'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText(/Alex Admin becomes the Owner/)).toBeInTheDocument();
  });
});
