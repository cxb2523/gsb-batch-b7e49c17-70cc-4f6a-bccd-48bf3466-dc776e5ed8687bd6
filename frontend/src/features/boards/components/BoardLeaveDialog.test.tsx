import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoardLeaveDialog } from './BoardLeaveDialog';

describe('BoardLeaveDialog', () => {
  it('says the changes are not saved and lets the person stay or leave', () => {
    const onStay = vi.fn();
    const onLeave = vi.fn();
    render(<BoardLeaveDialog onStay={onStay} onLeave={onLeave} />);

    expect(screen.getByRole('dialog', { name: 'Leave this canvas?' })).toBeInTheDocument();
    expect(screen.getByText('Your latest changes are not saved yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stay on this canvas' }));
    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Leave anyway' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('treats Escape as staying, never as leaving', () => {
    const onStay = vi.fn();
    const onLeave = vi.fn();
    render(<BoardLeaveDialog onStay={onStay} onLeave={onLeave} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });
});
