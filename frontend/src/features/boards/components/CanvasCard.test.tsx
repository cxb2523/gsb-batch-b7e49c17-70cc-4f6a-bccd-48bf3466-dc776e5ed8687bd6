import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CanvasCard } from './CanvasCard';

const board = { id: 'b1', title: 'Topology', projectId: 'p1' };

function renderCard(props: Partial<React.ComponentProps<typeof CanvasCard>> = {}) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  render(
    <CanvasCard
      board={board}
      projectName="Core"
      canvasUrl="https://app.test/w/acme/canvas/b1"
      canDelete
      onOpen={onOpen}
      onDelete={onDelete}
      {...props}
    />,
  );
  return { onOpen, onDelete };
}

describe('CanvasCard', () => {
  it('opens the canvas when the card is clicked but not when the menu is', () => {
    const { onOpen } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas options' }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('heading', { name: 'Topology' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('copies the canvas link and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas options' }));
    fireEvent.click(screen.getByText('Copy Canvas Link'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://app.test/w/acme/canvas/b1');
    });
    expect(screen.queryByText('Copy Canvas Link')).not.toBeInTheDocument();
  });

  it('offers delete only with permission and closes the menu when chosen', () => {
    const { onDelete } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas options' }));
    fireEvent.click(screen.getByText('Delete Canvas'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Copy Canvas Link')).not.toBeInTheDocument();
  });

  it('hides delete without permission', () => {
    renderCard({ canDelete: false });
    fireEvent.click(screen.getByRole('button', { name: 'Canvas options' }));
    expect(screen.getByText('Copy Canvas Link')).toBeInTheDocument();
    expect(screen.queryByText('Delete Canvas')).not.toBeInTheDocument();
  });

  it('closes the menu on Escape', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas options' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Copy Canvas Link')).not.toBeInTheDocument();
  });
});
