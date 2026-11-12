import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoardStashBanner } from './BoardStashBanner';

describe('BoardStashBanner', () => {
  it('says when the copy was written and offers restore and discard', () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    const savedAt = new Date('2026-03-01T10:30:00Z').getTime();
    render(<BoardStashBanner savedAt={savedAt} onRestore={onRestore} onDiscard={onDiscard} />);

    expect(
      screen.getByText(
        `Unsaved changes from ${new Date(savedAt).toLocaleString()} are stored on this device.`,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore unsaved changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
