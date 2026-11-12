import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { UserNavDropdown } from './UserNavDropdown';
import { useSession, signOut } from '@/lib/auth-client';

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('UserNavDropdown Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders single initial of user name', () => {
    (useSession as any).mockReturnValue({
      data: { user: { name: 'Qarib', email: 'q@local.com' } },
    });

    render(
      <BrowserRouter>
        <UserNavDropdown />
      </BrowserRouter>,
    );

    // Initial Q
    expect(screen.getByText('Q')).toBeInTheDocument();
  });

  it('toggles dropdown popover on click and shows Profile Settings and Log Out', () => {
    (useSession as any).mockReturnValue({
      data: { user: { name: 'Qarib', email: 'q@local.com' } },
    });

    render(
      <BrowserRouter>
        <UserNavDropdown />
      </BrowserRouter>,
    );

    expect(screen.queryByText('Profile Settings')).not.toBeInTheDocument();

    // Click avatar
    fireEvent.click(screen.getByLabelText('User profile and account settings'));

    expect(screen.getByText('Profile Settings')).toBeInTheDocument();
    expect(screen.getByText('Log Out')).toBeInTheDocument();
    expect(screen.getByText('q@local.com')).toBeInTheDocument();
  });

  it('calls signOut and navigates to /login when clicking Log Out', async () => {
    (useSession as any).mockReturnValue({
      data: { user: { name: 'Qarib', email: 'q@local.com' } },
    });
    (signOut as any).mockResolvedValueOnce({});

    render(
      <BrowserRouter>
        <UserNavDropdown />
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByLabelText('User profile and account settings'));
    fireEvent.click(screen.getByText('Log Out'));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  it('leaves no key-like entries in local or session storage after signing out', async () => {
    (useSession as any).mockReturnValue({
      data: { user: { name: 'Qarib', email: 'q@local.com' } },
    });
    (signOut as any).mockResolvedValueOnce({});
    localStorage.setItem('canvhq_key_board-1', 'plaintext-key-copy');
    sessionStorage.setItem('canvhq_key_board-2', 'plaintext-key-copy');

    render(
      <BrowserRouter>
        <UserNavDropdown />
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByLabelText('User profile and account settings'));
    fireEvent.click(screen.getByText('Log Out'));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
    });

    const keyLike = [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) =>
      key.startsWith('canvhq_key_'),
    );
    expect(keyLike).toEqual([]);
  });
});
