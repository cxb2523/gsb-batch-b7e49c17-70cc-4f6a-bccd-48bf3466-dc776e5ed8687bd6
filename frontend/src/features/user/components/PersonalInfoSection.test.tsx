import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { PersonalInfoSection } from './PersonalInfoSection';
import { errorResponse, jsonResponse } from '@/test/http';
import { requestsTo, stubFetchRoutes } from '@/test/route-fetch';
import { renderWithProviders } from '@/test/render-with-providers';

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'usr_1', name: 'Qarib', email: 'q@local.com' } } }),
}));

describe('PersonalInfoSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts from the session name and saves an edited one', async () => {
    stubFetchRoutes({
      'PATCH /api/user/profile': () => jsonResponse({ id: 'usr_1', email: 'q@local.com' }),
    });
    renderWithProviders(<PersonalInfoSection />);
    expect(screen.getByLabelText('Display Name')).toHaveValue('Qarib');

    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Q' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Profile updated successfully')).toBeInTheDocument();
  });

  it('shows the server error and keeps the edit when saving fails', async () => {
    stubFetchRoutes({
      'PATCH /api/user/profile': () =>
        errorResponse(500, 'INTERNAL', 'The profile could not be saved'),
    });
    renderWithProviders(<PersonalInfoSection />);

    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Sam Engineer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('The profile could not be saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Display Name')).toHaveValue('Sam Engineer');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it.each([
    ['a name with a character that is not allowed', 'Sam; DROP', /can only use letters/],
    ['a name that is too long', 'Q'.repeat(300), /cannot exceed 100 characters/],
  ])('says what to change for %s, and sends nothing', async (_label, value, message) => {
    const fetchMock = stubFetchRoutes({});
    renderWithProviders(<PersonalInfoSection />);

    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(requestsTo(fetchMock, 'PATCH /api/user/profile')).toHaveLength(0);
    expect(screen.getByLabelText('Display Name')).toHaveValue(value);
  });
});
