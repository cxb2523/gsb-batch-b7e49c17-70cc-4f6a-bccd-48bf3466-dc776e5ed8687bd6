import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { InvitationRow } from './InvitationRow';
import { fixtureInvitation } from '@/test/management-api';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { clipboard: { writeText } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('InvitationRow', () => {
  it('marks an expired invitation', () => {
    render(
      <InvitationRow
        invitation={{ ...fixtureInvitation, status: 'expired' }}
        canRevoke
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('copies the invitation link and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<InvitationRow invitation={fixtureInvitation} canRevoke onRevoke={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Copy invitation link'));

    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('https://canvhq.com/invite/inv_1');
    expect(toast.success).toHaveBeenCalledWith(
      'Copied invite link for invited-dev@canvhq.internal',
    );
  });

  it('falls back to this app’s invite address when the server sent no full URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(
      <InvitationRow
        invitation={{ ...fixtureInvitation, inviteUrl: '/invite/inv_1' }}
        canRevoke
        onRevoke={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Copy invitation link'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/inv_1`),
    );
  });

  it('tells the user when the browser refuses to copy', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<InvitationRow invitation={fixtureInvitation} canRevoke onRevoke={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Copy invitation link'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('could not be copied')),
    );
    expect(screen.getByText('Copy Link')).toBeInTheDocument();
  });

  it('hides revoke without permission', () => {
    render(<InvitationRow invitation={fixtureInvitation} canRevoke={false} onRevoke={vi.fn()} />);

    expect(screen.queryByTitle('Revoke invitation')).not.toBeInTheDocument();
  });
});
