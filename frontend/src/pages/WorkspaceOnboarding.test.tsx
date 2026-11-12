import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import { WorkspaceOnboarding } from './WorkspaceOnboarding';
import { authClient } from '@/lib/auth-client';
import { provisionWorkspaceKeys, KeyServiceError } from '@/lib/keys';
import { useAccess } from '@/hooks/useAccess';
import { errorResponse, jsonResponse } from '@/test/http';

vi.mock('@/hooks/useAccess', () => ({
  useAccess: vi.fn(() => ({
    canCreateWorkspace: true,
    isLoading: false,
    role: null,
    isAdministrator: false,
    can: vi.fn(),
  })),
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: '2a6c7e8f-3b4d-4c5e-9f01-23456789abcd' } },
    isPending: false,
  })),
  authClient: {
    organization: {
      setActive: vi.fn(),
    },
  },
}));

vi.mock('@/lib/keys', async () => {
  const actual = await vi.importActual<typeof import('@/lib/keys')>('@/lib/keys');
  return {
    ...actual,
    provisionWorkspaceKeys: vi.fn(),
  };
});

let mockIsUnlocked = true;
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({
    publicKeySpki: 'public-key-spki',
    isUnlocked: mockIsUnlocked,
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const projectId = '0f9a2f4e-7f8b-4b4e-9a3c-c3f6f4f0a1b2';
const provisioned = {
  encryptedOrgKey: 'wrapped-org-key',
  project: {
    id: projectId,
    name: 'Core Mesh',
    encryptedProjectKey: 'wrapped-project-key',
    creatorEncryptedProjectKey: 'wrapped-creator-project-key',
    keyVersion: 1,
  },
};

describe('WorkspaceOnboarding Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          jsonResponse({ id: 'org-test', slug: 'acme-infra', name: 'Acme Infra' }),
        ),
    );
    vi.mocked(provisionWorkspaceKeys).mockResolvedValue(provisioned);
  });

  const renderOnboarding = () => renderWithProviders(<WorkspaceOnboarding />);

  const fillForm = () => {
    fireEvent.change(screen.getByLabelText(/Workspace Name/i), {
      target: { value: 'Acme Infra' },
    });
    fireEvent.change(screen.getByLabelText(/First Project Name/i), {
      target: { value: 'Core Mesh' },
    });
  };

  it('renders onboarding card with step badge and fields', () => {
    renderOnboarding();
    expect(screen.getAllByText(/A better space to think/i)[0]).toBeInTheDocument();
    expect(screen.getByText('Create your workspace')).toBeInTheDocument();
    expect(screen.getByLabelText(/Workspace Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/First Project Name/i)).toBeInTheDocument();
  });

  it('asks password managers not to offer to save the names', () => {
    renderOnboarding();

    for (const name of [/Workspace Name/i, /First Project Name/i]) {
      const field = screen.getByLabelText(name);
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('data-1p-ignore');
      expect(field).toHaveAttribute('data-lpignore', 'true');
      expect(field).toHaveAttribute('data-bwignore', 'true');
    }
  });

  it.each([
    ['workspace', 'Acme; Infra', 'Core Mesh', /^Workspace name can only use letters/],
    ['first project', 'Acme Infra', 'Core-Mesh', /^Project name can only use letters/],
  ])(
    'refuses a %s name with characters that are not allowed, says why, and makes no keys',
    async (_label, workspaceName, projectName, message) => {
      renderOnboarding();
      fireEvent.change(screen.getByLabelText(/Workspace Name/i), {
        target: { value: workspaceName },
      });
      fireEvent.change(screen.getByLabelText(/First Project Name/i), {
        target: { value: projectName },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create workspace/i }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(vi.mocked(provisionWorkspaceKeys)).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('creates the workspace with one request carrying all keys, then opens it', async () => {
    renderOnboarding();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: /Create workspace/i }));

    await waitFor(() => {
      expect(vi.mocked(provisionWorkspaceKeys)).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: expect.any(String),
          projectId: expect.any(String),
          userId: '2a6c7e8f-3b4d-4c5e-9f01-23456789abcd',
          publicKeySpki: 'public-key-spki',
          projectName: 'Core Mesh',
        }),
      );
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    });

    const call = vi.mocked(global.fetch).mock.calls[0];
    expect(call?.[1]?.method).toBe('POST');
    const rawBody = call?.[1]?.body;
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}');
    expect(body).toMatchObject({
      name: 'Acme Infra',
      encryptedOrgKey: 'wrapped-org-key',
      project: {
        id: projectId,
        name: 'Core Mesh',
        encryptedProjectKey: 'wrapped-project-key',
        creatorEncryptedProjectKey: 'wrapped-creator-project-key',
      },
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(authClient.organization.setActive).toHaveBeenCalledWith({
      organizationId: 'org-test',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/w/acme-infra');
  });

  it('creates nothing when wrapping fails', async () => {
    vi.mocked(provisionWorkspaceKeys).mockRejectedValue(
      new KeyServiceError('wrap-failed', 'The workspace key could not be wrapped.'),
    );

    renderOnboarding();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Create workspace/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Encryption is unavailable, nothing was created/i),
      ).toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('creates nothing when the account is locked', async () => {
    mockIsUnlocked = false;

    renderOnboarding();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Create workspace/i }));

    await waitFor(() => {
      expect(screen.getByText(/Unlock your encryption passphrase/i)).toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the server message when creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          errorResponse(
            403,
            'FORBIDDEN',
            'Only workspace owners and admins can create more workspaces',
          ),
        ),
    );

    renderOnboarding();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Create workspace/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Only workspace owners and admins can create more workspaces'),
      ).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders dead-end page when canCreateWorkspace is false (Editor/Viewer only)', () => {
    vi.mocked(useAccess).mockReturnValue({
      canCreateWorkspace: false,
      isLoading: false,
      role: 'editor',
      isAdministrator: false,
      can: vi.fn(),
    });

    renderOnboarding();

    expect(screen.getByText("You can't create another workspace")).toBeInTheDocument();
    expect(
      screen.getByText(/Your account permissions do not allow creating additional workspaces/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Return to Workspace/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Workspace name/i)).not.toBeInTheDocument();
  });

  it('renders creation form when canCreateWorkspace is true (Owner/Admin or new user)', () => {
    vi.mocked(useAccess).mockReturnValue({
      canCreateWorkspace: true,
      isLoading: false,
      role: 'owner',
      isAdministrator: true,
      can: vi.fn(),
    });

    renderOnboarding();

    expect(screen.queryByText("You can't create another workspace")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Workspace name/i)).toBeInTheDocument();
  });

  it('displays LIMIT_REACHED error message when workspace creation limit is reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          errorResponse(
            403,
            'LIMIT_REACHED',
            'This instance allows 3 workspaces per account. Ask the instance operator to raise the limit.',
          ),
        ),
    );

    renderOnboarding();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Create Workspace/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'This instance allows 3 workspaces per account. Ask the instance operator to raise the limit.',
        ),
      ).toBeInTheDocument();
    });
  });
});
