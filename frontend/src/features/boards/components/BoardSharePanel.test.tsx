import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { generateSymmetricKey } from '@/lib/crypto';
import { emptyResponse, errorResponse, jsonResponse, networkFailure } from '@/test/http';
import { boardKeys } from '../keys';
import type { Board } from '../schemas';
import { BoardSharePanel } from './BoardSharePanel';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const board: Board = { id: 'b1', title: 'Mesh', projectId: 'p1', publicShareToken: null };

describe('BoardSharePanel', () => {
  let key: CryptoKey;
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    key = await generateSymmetricKey();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(boardKeys.detail('acme', 'b1'), board);
  });

  function renderPanel(
    props: {
      publicShareToken?: string | null;
      cryptoKey?: CryptoKey | null;
      canManageMembers?: boolean;
    } = {},
  ) {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BoardSharePanel
            workspaceRef="acme"
            boardId="b1"
            publicShareToken={props.publicShareToken ?? null}
            cryptoKey={props.cryptoKey === undefined ? key : props.cryptoKey}
            canManageMembers={props.canManageMembers ?? false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
  }

  it('points to member management only for someone who can manage members', () => {
    renderPanel({ canManageMembers: true });
    expect(screen.getByRole('link', { name: 'Manage Project Members' })).toHaveAttribute(
      'href',
      '/w/acme/management',
    );
  });

  it('does not point an editor at member management', () => {
    renderPanel({ canManageMembers: false });

    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.queryByText('Project Collaborators')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage Project Members' })).not.toBeInTheDocument();
  });

  it('enables the link and records the token on the cached board', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ isPublic: true, publicShareToken: 'tok-1' }));
    renderPanel();

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Board>(boardKeys.detail('acme', 'b1'))?.publicShareToken,
      ).toBe('tok-1');
    });
  });

  it('removes the token from the cached board when the link is disabled', async () => {
    global.fetch = vi.fn(async () => emptyResponse());
    queryClient.setQueryData(boardKeys.detail('acme', 'b1'), {
      ...board,
      publicShareToken: 'tok-1',
    });
    renderPanel({ publicShareToken: 'tok-1' });

    fireEvent.click(screen.getByRole('switch', { name: /Disable public link/i }));

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Board>(boardKeys.detail('acme', 'b1'))?.publicShareToken,
      ).toBeNull();
    });
  });

  it.each([
    ['a server error', () => errorResponse(500, 'INTERNAL', 'Nope')],
    ['a network failure', () => networkFailure()],
  ])('leaves the cached board alone and says so after %s', async (_name, respond) => {
    global.fetch = vi.fn(async () => respond());
    renderPanel();

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to enable public sharing');
    });
    expect(
      queryClient.getQueryData<Board>(boardKeys.detail('acme', 'b1'))?.publicShareToken,
    ).toBeNull();
  });

  it('puts the key in the link fragment only', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel({ publicShareToken: 'tok-1' });

    fireEvent.click(screen.getByRole('button', { name: /Copy Public Link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const link = new URL(writeText.mock.calls[0]?.[0]);
    expect(link.pathname).toBe('/share/tok-1');
    expect(link.search).toBe('');
    expect(link.hash).toMatch(/^#key=.+/);
  });

  it('falls back to a prompt when the clipboard is denied', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    renderPanel({ publicShareToken: 'tok-1' });

    fireEvent.click(screen.getByRole('button', { name: /Copy Public Link/i }));

    await waitFor(() => {
      expect(promptSpy).toHaveBeenCalledWith(
        'Copy public read-only link:',
        expect.stringContaining('/share/tok-1#key='),
      );
    });
    expect(screen.queryByText('Link Copied!')).not.toBeInTheDocument();
  });

  it('refuses to build a link when the board key is not available', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel({ publicShareToken: 'tok-1', cryptoKey: null });

    fireEvent.click(screen.getByRole('button', { name: /Copy Public Link/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to export encryption key. Cannot generate public share link.',
      );
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('closes when the user clicks elsewhere', () => {
    renderPanel();
    expect(screen.getByText('SHARE CANVAS')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText('SHARE CANVAS')).not.toBeInTheDocument();
  });
});
