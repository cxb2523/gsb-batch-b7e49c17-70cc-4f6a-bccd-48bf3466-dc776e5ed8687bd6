import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RekeyBanner } from './RekeyBanner';
import type { RekeyJob, RekeyStatus } from './useRekeyJob';

function jobWith(overrides: Partial<RekeyJob>): RekeyJob {
  return {
    status: 'idle',
    progress: null,
    skippedPublic: 0,
    pause: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

const progress = { done: 1, total: 3, failed: 0, skipped: 0 };

describe('RekeyBanner', () => {
  it('shows progress with a Pause button while running, and keeps clear of what follows', () => {
    const { container } = render(<RekeyBanner job={jobWith({ status: 'running', progress })} />);

    expect(screen.getByText('Securing boards: 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('mb-5');
  });

  it('offers Resume when paused and Retry when it failed', () => {
    const { rerender } = render(<RekeyBanner job={jobWith({ status: 'paused' })} />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    rerender(
      <RekeyBanner job={jobWith({ status: 'failed', progress: { ...progress, failed: 2 } })} />,
    );
    expect(screen.getByText(/2 boards could not be secured/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says how many boards with a public link were left alone', () => {
    render(<RekeyBanner job={jobWith({ skippedPublic: 2 })} />);

    expect(
      screen.getByText(/2 boards with public links keep their current key/),
    ).toBeInTheDocument();
  });

  it.each<RekeyStatus>(['idle', 'finished'])(
    'leaves nothing on the page, not even an empty gap, when %s',
    (status) => {
      const { container } = render(<RekeyBanner job={jobWith({ status, progress })} />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText('All boards secured.')).not.toBeInTheDocument();
    },
  );
});
