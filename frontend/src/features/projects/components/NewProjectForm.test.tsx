import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { NewProjectForm } from './NewProjectForm';
import { renderWithProviders } from '@/test/render-with-providers';
import { errorResponse, jsonResponse } from '@/test/http';
import { fixtureProject, fixtureWorkspace, stubManagementApi } from '@/test/management-api';

const keys = vi.hoisted(() => ({
  resolveOrgKey: vi.fn(),
  provisionProjectKeys: vi.fn(),
}));

vi.mock('@/lib/keys', () => keys);
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ privateKey: null, publicKeySpki: 'spki', isUnlocked: true }),
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderForm(variant: 'sidebar' | 'section' = 'section') {
  const onDone = vi.fn();
  renderWithProviders(
    <NewProjectForm workspace={fixtureWorkspace} variant={variant} onDone={onDone} />,
  );
  return { onDone };
}

function submitName(name: string) {
  fireEvent.change(screen.getByPlaceholderText(/project name/i), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /^(Create|Add)$/ }));
}

beforeEach(() => {
  keys.resolveOrgKey.mockReset().mockResolvedValue({});
  keys.provisionProjectKeys.mockReset().mockResolvedValue({
    id: 'p-new',
    name: 'Platform',
    encryptedProjectKey: 'wrapped-project-key',
    creatorEncryptedProjectKey: 'wrapped-creator-key',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('NewProjectForm', () => {
  it.each(['section', 'sidebar'] as const)(
    'refuses a name with characters that are not allowed from the %s form, says why, and makes no keys',
    async (variant) => {
      const api = stubManagementApi();
      const { onDone } = renderForm(variant);

      submitName('Roadmap; DROP');

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringMatching(/^Project name can only use letters/),
        ),
      );
      expect(keys.provisionProjectKeys).not.toHaveBeenCalled();
      expect(api.requests('POST', '/api/projects')).toHaveLength(0);
      expect(onDone).not.toHaveBeenCalled();
    },
  );

  it.each(['section', 'sidebar'] as const)(
    'creates the project with its wrapped keys from the %s form, then closes',
    async (variant) => {
      const api = stubManagementApi([
        {
          method: 'POST',
          path: '/api/projects',
          respond: () => jsonResponse({ ...fixtureProject, id: 'p-new', name: 'Platform' }),
        },
      ]);
      const { onDone } = renderForm(variant);

      submitName('Platform');

      await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
      expect(api.requests('POST', '/api/projects')[0]?.body).toEqual({
        id: 'p-new',
        name: 'Platform',
        encryptedProjectKey: 'wrapped-project-key',
        creatorEncryptedProjectKey: 'wrapped-creator-key',
      });
    },
  );

  it('sends nothing and tells the user when the keys cannot be wrapped', async () => {
    keys.provisionProjectKeys.mockRejectedValue(new Error('Wrapping failed'));
    const api = stubManagementApi();
    const { onDone } = renderForm();

    submitName('Platform');

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Encryption is unavailable, nothing was created.'),
      ),
    );
    expect(api.requests('POST', '/api/projects')).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps the form open with the typed name and reports the error when the server refuses', async () => {
    stubManagementApi([
      {
        method: 'POST',
        path: '/api/projects',
        respond: () => errorResponse(403, 'FORBIDDEN', 'Projects cannot be created here'),
      },
    ]);
    const { onDone } = renderForm();

    submitName('Platform');

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Projects cannot be created here'),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/project name/i)).toHaveValue('Platform');
  });
});
