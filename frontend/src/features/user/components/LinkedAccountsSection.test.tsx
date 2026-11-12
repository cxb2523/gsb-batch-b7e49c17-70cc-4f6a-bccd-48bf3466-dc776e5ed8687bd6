import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { LinkedAccountsSection } from './LinkedAccountsSection';
import { authClient } from '@/lib/auth-client';
import { clearAuthConfigCache } from '@/lib/auth-config';
import { jsonResponse, emptyResponse, errorResponse } from '@/test/http';
import { stubFetchRoutes } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

vi.mock('@/lib/auth-client', () => ({
  authClient: { linkSocial: vi.fn() },
}));

const google = { id: 'acc_1', providerId: 'google' };
const github = { id: 'acc_2', providerId: 'github' };
const authConfig = { devLoginEnabled: false, providers: ['google', 'github'] };

describe('LinkedAccountsSection', () => {
  beforeEach(() => {
    clearAuthConfigCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('disconnects a provider and shows the refreshed list', async () => {
    let accounts = [google, github];
    stubFetchRoutes({
      'GET /api/user/accounts': () => jsonResponse(accounts),
      'GET /api/auth/config': () => jsonResponse(authConfig),
      'DELETE /api/user/accounts/github': () => {
        accounts = [google];
        return emptyResponse();
      },
    });

    renderWithProviders(<LinkedAccountsSection />);

    fireEvent.click(await screen.findByTitle('Disconnect GitHub'));

    expect(await screen.findByText('Disconnected github successfully.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('shows the server error and keeps the account when disconnecting fails', async () => {
    stubFetchRoutes({
      'GET /api/user/accounts': () => jsonResponse([google, github]),
      'GET /api/auth/config': () => jsonResponse(authConfig),
      'DELETE /api/user/accounts/github': () =>
        errorResponse(400, 'LAST_ACCOUNT', 'Cannot remove your last sign-in method'),
    });

    renderWithProviders(<LinkedAccountsSection />);

    fireEvent.click(await screen.findByTitle('Disconnect GitHub'));

    expect(await screen.findByText('Cannot remove your last sign-in method')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2);
  });

  it('does not offer to disconnect the only login provider', async () => {
    stubFetchRoutes({
      'GET /api/user/accounts': () => jsonResponse([google]),
      'GET /api/auth/config': () => jsonResponse(authConfig),
    });

    renderWithProviders(<LinkedAccountsSection />);

    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeDisabled();
  });

  it('shows an error when starting the connection fails', async () => {
    vi.mocked(authClient.linkSocial).mockRejectedValue(new Error('Provider unavailable'));
    stubFetchRoutes({
      'GET /api/user/accounts': () => jsonResponse([google]),
      'GET /api/auth/config': () => jsonResponse(authConfig),
    });

    renderWithProviders(<LinkedAccountsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Provider unavailable')).toBeInTheDocument();
  });

  it('offers a retry when the accounts cannot be loaded', async () => {
    let failing = true;
    stubFetchRoutes({
      'GET /api/user/accounts': () =>
        failing
          ? errorResponse(500, 'INTERNAL', 'Accounts are unavailable')
          : jsonResponse([google]),
      'GET /api/auth/config': () => jsonResponse(authConfig),
    });

    renderWithProviders(<LinkedAccountsSection />);

    expect(await screen.findByText('Accounts are unavailable')).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByText('Google')).toBeInTheDocument());
  });
});
