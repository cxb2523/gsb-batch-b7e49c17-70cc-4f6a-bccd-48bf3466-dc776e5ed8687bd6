import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ProjectMembersButton } from './ProjectMembersButton';
import { renderWithProviders } from '@/test/render-with-providers';
import { fixtureProject, fixtureWorkspace, stubManagementApi } from '@/test/management-api';

vi.mock('@/lib/keys', () => ({ prepareProjectGrant: vi.fn() }));
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ privateKey: null, publicKeySpki: null, isUnlocked: true }),
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderButton() {
  renderWithProviders(
    <ProjectMembersButton
      workspace={fixtureWorkspace}
      project={fixtureProject}
      runRotation={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe('ProjectMembersButton', () => {
  it('asks nothing of the server until it is opened', () => {
    const api = stubManagementApi();
    renderButton();

    expect(screen.getByRole('button', { name: 'Add members' })).toBeVisible();
    expect(screen.queryByText(/Project Access/)).not.toBeInTheDocument();
    expect(api.requests('GET', '/api/projects/p1/members')).toHaveLength(0);
    expect(api.requests('GET', '/api/projects/p1/assignable-members')).toHaveLength(0);
  });

  it("opens the project's access dialog with the people who can still be added, and closes it again", async () => {
    const api = stubManagementApi();
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Add members' }));

    expect(await screen.findByText('Project Access · Core Architecture')).toBeVisible();
    expect(
      await screen.findByRole('option', { name: /Sam Engineer \(sam@canvhq\.internal\)/ }),
    ).toBeInTheDocument();
    expect(api.requests('GET', '/api/projects/p1/members')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.queryByText(/Project Access/)).not.toBeInTheDocument());
  });
});
