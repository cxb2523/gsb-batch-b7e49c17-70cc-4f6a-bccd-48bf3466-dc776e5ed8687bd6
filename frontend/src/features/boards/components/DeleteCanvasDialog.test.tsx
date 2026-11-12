import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { DeleteCanvasDialog } from './DeleteCanvasDialog';
import { errorResponse, jsonResponse } from '@/test/http';

const board = { id: 'b1', title: 'Topology', projectId: 'p1' };

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DeleteCanvasDialog workspaceId="org-1" board={board} onClose={onClose} />
      <Toaster />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('DeleteCanvasDialog', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('has one title, which also names the dialog', () => {
    renderDialog();

    expect(screen.getAllByRole('heading', { name: 'Delete Canvas' })).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Delete Canvas' })).toBeInTheDocument();
  });

  it('names the canvas and closes after it is deleted', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ success: true }));
    const onClose = renderDialog();
    expect(screen.getByText(/"Topology"/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Canvas' })[0]!);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open and says why when the server refuses', async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(403, 'FORBIDDEN', 'Not allowed'));
    const onClose = renderDialog();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Canvas' })[0]!);

    expect(await screen.findByText('Not allowed')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on cancel without calling the server', () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
