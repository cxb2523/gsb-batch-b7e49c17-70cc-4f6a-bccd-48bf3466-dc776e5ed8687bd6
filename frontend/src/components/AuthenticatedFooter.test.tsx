import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { AuthenticatedFooter } from './AuthenticatedFooter';
import { APP_VERSION } from '@/lib/constants';
import { jsonResponse } from '@/test/http';
import { stubFetchRoutes } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'usr_1' } } }),
}));

describe('AuthenticatedFooter Component', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders E2EE, workspaces count, projects count, and version correctly', async () => {
    stubFetchRoutes({
      'GET /api/user/metrics': () => jsonResponse({ workspacesCount: 3, projectsCount: 8 }),
    });

    renderWithProviders(<AuthenticatedFooter version="V0.1" />);

    expect(screen.getByText('E2EE')).toBeInTheDocument();
    expect(await screen.findByText('3 Workspaces')).toBeInTheDocument();
    expect(screen.getByText('8 Projects')).toBeInTheDocument();
    expect(screen.getByText('CANVHQ V0.1')).toBeInTheDocument();
  });

  it('handles default version and custom classes cleanly', async () => {
    stubFetchRoutes({
      'GET /api/user/metrics': () => jsonResponse({ workspacesCount: 1, projectsCount: 2 }),
    });

    const { container } = renderWithProviders(
      <AuthenticatedFooter className="custom-test-class" />,
    );

    expect(await screen.findByText('1 Workspaces')).toBeInTheDocument();
    expect(screen.getByText('2 Projects')).toBeInTheDocument();
    expect(screen.getByText(`CANVHQ ${APP_VERSION.toUpperCase()}`)).toBeInTheDocument();
    expect(container.querySelector('footer')).toHaveClass('custom-test-class');
  });

  it('shows zero counts while the metrics request fails', async () => {
    stubFetchRoutes({
      'GET /api/user/metrics': () => new Response(null, { status: 500 }),
    });

    renderWithProviders(<AuthenticatedFooter />);

    expect(await screen.findByText('0 Workspaces')).toBeInTheDocument();
    expect(screen.getByText('0 Projects')).toBeInTheDocument();
  });
});
