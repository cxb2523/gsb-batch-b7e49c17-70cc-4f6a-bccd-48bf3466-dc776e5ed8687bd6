import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { ProfileSidebar } from './ProfileSidebar';
import { jsonResponse } from '@/test/http';
import { stubFetchRoutes } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { name: 'Qarib', email: 'q@local.com' } } }),
}));

describe('ProfileSidebar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the identity card and the linked account count', async () => {
    stubFetchRoutes({
      'GET /api/user/accounts': () =>
        jsonResponse([
          { id: 'a', providerId: 'google' },
          { id: 'b', providerId: 'github' },
        ]),
    });

    renderWithProviders(<ProfileSidebar />);

    expect(screen.getByText('Qarib')).toBeInTheDocument();
    expect(screen.getByText('q@local.com')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Danger Zone/i })).toHaveAttribute('href', '#danger');
  });
});
