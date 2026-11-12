import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DemoBanner } from './DemoBanner';
import { clearAuthConfigCache } from '@/lib/auth-config';
import { jsonResponse } from '@/test/http';

describe('DemoBanner Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthConfigCache();
  });

  it('renders nothing when demoMode is off', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          devLoginEnabled: false,
          demoMode: false,
          providers: ['google'],
        }),
      ),
    );

    render(<DemoBanner />);

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('renders banner when demoMode is on', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          devLoginEnabled: false,
          demoMode: true,
          providers: [],
        }),
      ),
    );

    render(<DemoBanner />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText(/All data and accounts are wiped nightly/i)).toBeInTheDocument();
    });
  });
});
