import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import * as accessHook from '@/hooks/useAccess';
import { WorkspaceAdminRoute } from './WorkspaceAdminRoute';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function mockAccess(access: { isAdministrator: boolean; isLoading: boolean }) {
  vi.spyOn(accessHook, 'useAccess').mockReturnValue({
    can: vi.fn(),
    role: null,
    canCreateWorkspace: false,
    ...access,
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/w/:slug/management"
          element={
            <WorkspaceAdminRoute>
              <div>Management page</div>
            </WorkspaceAdminRoute>
          }
        />
        <Route path="/w/:slug" element={<div>Workspace home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WorkspaceAdminRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the page to an owner or admin', () => {
    mockAccess({ isAdministrator: true, isLoading: false });

    renderAt('/w/acme/management');

    expect(screen.getByText('Management page')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('sends anyone else to the workspace home and says why', () => {
    mockAccess({ isAdministrator: false, isLoading: false });

    renderAt('/w/acme/management');

    expect(screen.getByText('Workspace home')).toBeInTheDocument();
    expect(screen.queryByText('Management page')).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      'Only workspace owners and admins can open management.',
    );
  });

  it('shows neither the page nor a redirect while the person’s role is still loading', () => {
    mockAccess({ isAdministrator: false, isLoading: true });

    renderAt('/w/acme/management');

    expect(screen.queryByText('Management page')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
