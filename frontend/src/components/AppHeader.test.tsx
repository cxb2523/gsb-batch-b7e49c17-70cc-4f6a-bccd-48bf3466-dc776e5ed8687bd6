import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import * as accessHook from '@/hooks/useAccess';

vi.mock('@/components/UserNavDropdown', () => ({
  UserNavDropdown: () => <div data-testid="user-nav">UserNav</div>,
}));
vi.mock('@/features/notifications/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell">Bell</div>,
}));

describe('AppHeader Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['owner', 'admin', 'editor', 'viewer'] as const)(
    'renders role badge for %s role',
    (role) => {
      vi.spyOn(accessHook, 'useAccess').mockReturnValue({
        can: vi.fn(),
        role,
        isAdministrator: role === 'owner' || role === 'admin',
        canCreateWorkspace: true,
        isLoading: false,
      });

      render(
        <MemoryRouter>
          <AppHeader currentSlug="test-org" />
        </MemoryRouter>,
      );

      const badge = screen.getByTestId('role-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(new RegExp(`^${role}$`, 'i'));
    },
  );

  it.each([
    { role: 'owner', isAdministrator: true },
    { role: 'admin', isAdministrator: true },
    { role: 'editor', isAdministrator: false },
    { role: 'viewer', isAdministrator: false },
  ])('shows Management only to administrators ($role)', ({ role, isAdministrator }) => {
    vi.spyOn(accessHook, 'useAccess').mockReturnValue({
      can: vi.fn(),
      role,
      isAdministrator,
      canCreateWorkspace: false,
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <AppHeader currentSlug="test-org" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    if (isAdministrator) {
      expect(screen.getByRole('link', { name: 'Management' })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('link', { name: 'Management' })).not.toBeInTheDocument();
    }
  });

  it('renders without role badge when no slug or no role is available', () => {
    vi.spyOn(accessHook, 'useAccess').mockReturnValue({
      can: vi.fn(),
      role: null,
      isAdministrator: false,
      canCreateWorkspace: false,
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('role-badge')).not.toBeInTheDocument();
  });
});
