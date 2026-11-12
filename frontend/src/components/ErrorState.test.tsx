import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

describe('ErrorState', () => {
  it('shows the message and calls onRetry when the user retries', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Could not load projects" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load projects');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry button without a handler', () => {
    render(<ErrorState message="Nope" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('LoadingState', () => {
  it('announces loading with the given message', () => {
    render(<LoadingState message="Loading projects…" />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getByText('Loading projects…')).toBeInTheDocument();
  });
});
