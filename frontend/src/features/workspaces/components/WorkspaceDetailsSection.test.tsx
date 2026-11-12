import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { WorkspaceDetailsSection } from './WorkspaceDetailsSection';
import { renderWithProviders } from '@/test/render-with-providers';
import { errorResponse } from '@/test/http';
import { fixtureWorkspace, stubManagementApi } from '@/test/management-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection(canUpdate = true) {
  return renderWithProviders(
    <WorkspaceDetailsSection workspace={fixtureWorkspace} canUpdate={canUpdate} />,
  );
}

describe('WorkspaceDetailsSection', () => {
  it('shows the workspace name and slug', () => {
    renderSection();

    expect(screen.getByText('SLUG: acme-eng')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Eng')).toBeInTheDocument();
  });

  it('saves a new name and confirms it', async () => {
    const api = stubManagementApi();
    renderSection();

    fireEvent.click(screen.getByTitle('Rename workspace'));
    fireEvent.change(screen.getByLabelText(/Workspace Name/i), {
      target: { value: 'Acme Cloud Platform' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    expect(await screen.findByText('Workspace updated successfully!')).toBeInTheDocument();
    expect(api.requests('PATCH', '/api/workspaces/org-1')[0]?.body).toEqual({
      name: 'Acme Cloud Platform',
    });
  });

  it('refuses a name with characters that are not allowed, says why, and sends nothing', async () => {
    const api = stubManagementApi();
    renderSection();

    fireEvent.click(screen.getByTitle('Rename workspace'));
    fireEvent.change(screen.getByLabelText(/Workspace Name/i), {
      target: { value: 'Acme; Cloud' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    expect(await screen.findByText(/^Workspace name can only use letters/)).toBeInTheDocument();
    expect(api.requests('PATCH', '/api/workspaces/org-1')).toHaveLength(0);
    expect(screen.getByLabelText(/Workspace Name/i)).toHaveValue('Acme; Cloud');
  });

  it('shows the server error and keeps the form open when the rename fails', async () => {
    stubManagementApi([
      {
        method: 'PATCH',
        path: '/api/workspaces/org-1',
        respond: () => errorResponse(409, 'CONFLICT', 'That name is taken'),
      },
    ]);
    renderSection();

    fireEvent.click(screen.getByTitle('Rename workspace'));
    fireEvent.change(screen.getByLabelText(/Workspace Name/i), { target: { value: 'Taken' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    expect(await screen.findByText('That name is taken')).toBeInTheDocument();
    expect(screen.queryByText('Workspace updated successfully!')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save Changes/i })).toBeEnabled(),
    );
    expect(screen.getByLabelText(/Workspace Name/i)).toBeVisible();
  });

  it('does not offer to rename without permission', () => {
    renderSection(false);

    expect(screen.queryByTitle('Rename workspace')).not.toBeInTheDocument();
  });
});
