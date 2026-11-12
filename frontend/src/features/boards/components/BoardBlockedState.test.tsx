import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BoardBlockedState } from './BoardBlockedState';

describe('BoardBlockedState', () => {
  it('explains the reason, retries, and links back to the workspace', () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <BoardBlockedState reason="pending-access" workspaceRef="acme" onRetry={onRetry} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Waiting for access')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Workspace' })).toHaveAttribute(
      'href',
      '/w/acme',
    );

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
