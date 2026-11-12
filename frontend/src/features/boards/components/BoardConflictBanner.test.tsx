import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoardConflictBanner } from './BoardConflictBanner';

describe('BoardConflictBanner', () => {
  it('renders conflict message and buttons', () => {
    const onReload = vi.fn();
    const onOverwrite = vi.fn();

    render(<BoardConflictBanner onReload={onReload} onOverwrite={onOverwrite} />);

    expect(screen.getByText('This canvas was changed elsewhere.')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /overwrite/i }));
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });
});
