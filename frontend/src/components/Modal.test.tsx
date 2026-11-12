import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';

describe('Modal & ConfirmDialog Primitives', () => {
  it('renders modal with role="dialog", aria-modal="true", and accessible title', () => {
    const handleClose = vi.fn();
    render(
      <Modal
        open={true}
        onOpenChange={handleClose}
        title="Test Title"
        description="Test Description"
      >
        <p>Modal body content</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('keeps focus where the user is typing when the parent re-renders with a new handler', () => {
    function Host() {
      const [text, setText] = useState('');
      return (
        <Modal open onOpenChange={() => setText('')} title="Search">
          <input aria-label="query" value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('query');
    input.focus();

    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });

    expect(input).toHaveFocus();
  });

  it('closes when Escape is pressed', () => {
    const handleClose = vi.fn();
    render(
      <Modal open={true} onOpenChange={handleClose} title="Escape Test">
        <p>Body</p>
      </Modal>,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledWith(false);
  });

  it('renders ConfirmDialog with buttons and triggers onConfirm', () => {
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={handleClose}
        title="Delete Item"
        description="Are you sure you want to delete this?"
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleConfirm}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Item')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtn);
    expect(handleConfirm).toHaveBeenCalled();

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(handleClose).toHaveBeenCalledWith(false);
  });
});
