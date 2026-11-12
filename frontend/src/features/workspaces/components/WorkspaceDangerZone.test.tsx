import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { WorkspaceDangerZone } from './WorkspaceDangerZone';
import { renderWithProviders } from '@/test/render-with-providers';
import { errorResponse } from '@/test/http';
import { fixtureWorkspace, stubManagementApi } from '@/test/management-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderZone(canDelete = true) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/"
        element={
          <WorkspaceDangerZone
            workspace={fixtureWorkspace}
            canDelete={canDelete}
            projectCount={1}
            boardCount={3}
          />
        }
      />
      <Route path="/workspace" element={<div>Workspace home</div>} />
    </Routes>,
  );
}

function openDeleteModal() {
  fireEvent.click(screen.getByRole('button', { name: /Delete Workspace/i }));
  return screen.getByLabelText(/To confirm, please type/i);
}

describe('WorkspaceDangerZone', () => {
  it('has one title in the delete dialog, which also names the dialog', () => {
    renderZone();
    openDeleteModal();

    expect(screen.getAllByRole('heading', { name: 'Delete Workspace' })).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Delete Workspace' })).toBeInTheDocument();
  });

  it('counts what will be deleted', () => {
    renderZone();

    expect(screen.getByText(/including all 1 project, 3 canvases/)).toBeInTheDocument();
  });

  it('deletes the workspace only after its name is typed, then leaves for the home screen', async () => {
    const api = stubManagementApi();
    renderZone();

    const input = openDeleteModal();
    const confirm = screen.getByRole('button', { name: /Permanently Delete/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Wrong Name' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: 'Acme Eng' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    expect(api.requests('DELETE', '/api/workspaces/org-1')).toHaveLength(1);
  });

  it('keeps the dialog open and shows the server error when the delete fails', async () => {
    stubManagementApi([
      {
        method: 'DELETE',
        path: '/api/workspaces/org-1',
        respond: () => errorResponse(403, 'FORBIDDEN', 'Only the owner can delete this workspace'),
      },
    ]);
    renderZone();

    fireEvent.change(openDeleteModal(), { target: { value: 'Acme Eng' } });
    fireEvent.click(screen.getByRole('button', { name: /Permanently Delete/i }));

    expect(await screen.findByText('Only the owner can delete this workspace')).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Permanently Delete/i })).toBeEnabled(),
    );
  });

  it('explains that only the owner can delete, without a delete button', () => {
    renderZone(false);

    expect(
      screen.getByText(/Only the workspace owner can delete this workspace/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Workspace/i })).not.toBeInTheDocument();
  });
});
