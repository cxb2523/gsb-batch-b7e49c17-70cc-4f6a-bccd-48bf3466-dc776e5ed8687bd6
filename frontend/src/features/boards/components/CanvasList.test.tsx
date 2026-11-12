import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasList } from './CanvasList';

const pagination = {
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

function renderList(props: Partial<React.ComponentProps<typeof CanvasList>> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onRequestDelete: vi.fn(),
    onPageChange: vi.fn(),
  };
  render(
    <CanvasList
      boards={[{ id: 'b1', title: 'Topology', projectId: 'p1' }]}
      pagination={pagination}
      projectName="Core"
      canvasLinkBase="https://app.test/w/acme"
      canCreate
      canDelete
      isCreating={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('CanvasList', () => {
  it('shows the canvas count and a card per canvas', () => {
    renderList();
    expect(screen.getByText('1 canvas')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Topology' })).toBeInTheDocument();
  });

  it('creates from the tile by click and by keyboard', () => {
    const { onCreate } = renderList();
    const tile = screen.getByRole('button', { name: /Create a canvas/ });
    fireEvent.click(tile);
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it('shows progress on the tile while creating', () => {
    renderList({ isCreating: true });
    expect(screen.getByText('Creating canvas...')).toBeInTheDocument();
  });

  it('has no create tile without permission', () => {
    renderList({ canCreate: false });
    expect(screen.queryByText(/Create a canvas/)).not.toBeInTheDocument();
  });

  it('asks to delete the canvas of the card whose menu was used', () => {
    const { onRequestDelete } = renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas options' }));
    fireEvent.click(screen.getByText('Delete Canvas'));
    expect(onRequestDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('reports the next page', () => {
    const { onPageChange } = renderList({
      pagination: { ...pagination, total: 21, totalPages: 2, hasNextPage: true },
    });
    fireEvent.click(screen.getByRole('button', { name: /NEXT/ }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
