import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Profile } from './Profile';
import { authClient } from '@/lib/auth-client';
import { clearAuthConfigCache } from '@/lib/auth-config';
import { jsonResponse, emptyResponse } from '@/test/http';
import { stubFetchRoutes, requestsTo, jsonBody } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'usr_1', name: 'Qarib', email: 'q@local.com' } } }),
  signOut: vi.fn(),
  authClient: {
    linkSocial: vi.fn(),
    organization: {
      list: () =>
        Promise.resolve({
          data: [{ id: 'org_1', slug: 'acme', createdAt: new Date('2026-01-01') }],
          error: null,
        }),
    },
  },
}));

function stubProfileApi(
  accounts: unknown[] = [],
  authConfig = { devLoginEnabled: false, providers: ['google'] },
) {
  return stubFetchRoutes({
    'GET /api/user/accounts': () => jsonResponse(accounts),
    'GET /api/auth/config': () => jsonResponse(authConfig),
    'GET /api/user/owned-workspaces': () => jsonResponse([]),
    'PATCH /api/user/profile': () => jsonResponse({ id: 'usr_1', email: 'q@local.com' }),
  });
}

describe('Profile Component', () => {
  beforeEach(() => {
    clearAuthConfigCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders profile fields and connected accounts', async () => {
    stubProfileApi([{ id: 'acc_1', providerId: 'google', createdAt: new Date().toISOString() }]);

    renderWithProviders(<Profile />);

    expect(screen.getByRole('heading', { name: /Account Settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Display Name/i)).toHaveValue('Qarib');
    expect(screen.getByLabelText(/Email Address/i)).toHaveValue('q@local.com');

    await waitFor(() => {
      expect(screen.getByText('Google')).toBeInTheDocument();
      // Since only 1 account is connected, Disconnect button should be disabled
      expect(screen.getByRole('button', { name: /Disconnect/i })).toBeDisabled();
    });
  });

  it('links the header to the oldest workspace', async () => {
    stubProfileApi();

    renderWithProviders(<Profile />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/w/acme');
    });
  });

  it('submits name update to /api/user/profile', async () => {
    const fetchMock = stubProfileApi([{ id: 'acc_1', providerId: 'google' }]);

    renderWithProviders(<Profile />);

    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: 'Updated Qarib' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    expect(await screen.findByText('Profile updated successfully')).toBeInTheDocument();
    const [, init] = requestsTo(fetchMock, 'PATCH /api/user/profile')[0] ?? [];
    expect(jsonBody(init)).toEqual({ name: 'Updated Qarib' });
  });

  it('opens account deletion modal and displays workspace transfer prompt', async () => {
    stubFetchRoutes({
      'GET /api/user/accounts': () => jsonResponse([]),
      'GET /api/auth/config': () => jsonResponse({ devLoginEnabled: false, providers: [] }),
      'GET /api/user/owned-workspaces': () =>
        jsonResponse([
          {
            id: 'org_1',
            name: 'Acme Corp',
            slug: 'acme-corp',
            otherMembers: [
              { id: 'mem_2', userId: 'usr_2', name: 'Alice', email: 'alice@local.com' },
            ],
          },
        ]),
    });

    renderWithProviders(<Profile />);

    fireEvent.click(screen.getByRole('button', { name: /Delete Personal Account/i }));

    expect(await screen.findByText('Delete Account & Transfer Workspaces')).toBeInTheDocument();
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByLabelText(/Transfer ownership to:/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice \(alice@local\.com\)/i)).toBeInTheDocument();
  });

  it('renders passphrase rotation form with password inputs', () => {
    stubProfileApi();

    renderWithProviders(<Profile />);

    expect(
      screen.getByRole('heading', { name: /Security & Encryption Passphrase/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Current Passphrase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^New Passphrase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm New Passphrase/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Change Encryption Passphrase/i }),
    ).toBeInTheDocument();
  });

  it('renders development test account when credential provider is present and triggers connect for social provider', async () => {
    stubProfileApi([{ id: 'acc_dev', providerId: 'credential' }], {
      devLoginEnabled: true,
      providers: ['github'],
    });

    renderWithProviders(<Profile />);

    expect(await screen.findByText(/Development Test Account/i)).toBeInTheDocument();
    expect(screen.getByText(/LOCAL DEV ONLY/i)).toBeInTheDocument();
    expect(await screen.findByText('GitHub')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Connect$/i }));
    expect(authClient.linkSocial).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }),
    );
  });

  it('downloads the personal data export on click', async () => {
    stubFetchRoutes({
      'GET /api/user/accounts': () => jsonResponse([]),
      'GET /api/auth/config': () => jsonResponse({ devLoginEnabled: false, providers: [] }),
      'GET /api/user/export-data': () => jsonResponse({ user: { id: 'usr_1' } }),
    });
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();

    renderWithProviders(<Profile />);

    fireEvent.click(screen.getByRole('button', { name: /Export Personal Data \(JSON\)/i }));

    expect(
      await screen.findByText(/Your personal data archive was downloaded successfully/i),
    ).toBeInTheDocument();
  });

  it('keeps the page usable when the linked accounts request fails', async () => {
    stubFetchRoutes({
      'GET /api/user/accounts': () => emptyResponse(500),
      'GET /api/auth/config': () => jsonResponse({ devLoginEnabled: false, providers: [] }),
    });

    renderWithProviders(<Profile />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(/Display Name/i)).toBeInTheDocument();
  });
});
