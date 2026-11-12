import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PassphraseSection } from './PassphraseSection';

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { email: 'q@local.com' } } }),
}));
const { rotatePassphrase } = vi.hoisted(() => ({ rotatePassphrase: vi.fn() }));
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ rotatePassphrase, isUnlocked: true }),
}));

function fillAndSubmit(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Current Passphrase'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New Passphrase'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm New Passphrase'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: /Change Encryption Passphrase/i }));
}

describe('PassphraseSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a mismatched confirmation without calling the key service', () => {
    render(<PassphraseSection />);

    fillAndSubmit('old-passphrase', 'new-passphrase-1', 'new-passphrase-2');

    expect(screen.getByText('New passphrases do not match.')).toBeInTheDocument();
    expect(rotatePassphrase).not.toHaveBeenCalled();
  });

  it('rejects a short new passphrase', () => {
    render(<PassphraseSection />);

    fillAndSubmit('old-passphrase', 'short', 'short');

    expect(
      screen.getByText('New passphrase must be at least 8 characters long.'),
    ).toBeInTheDocument();
    expect(rotatePassphrase).not.toHaveBeenCalled();
  });

  it('confirms the change and empties the form', async () => {
    rotatePassphrase.mockResolvedValue(undefined);
    render(<PassphraseSection />);

    fillAndSubmit('old-passphrase', 'new-passphrase', 'new-passphrase');

    expect(
      await screen.findByText('Encryption passphrase updated successfully.'),
    ).toBeInTheDocument();
    expect(rotatePassphrase).toHaveBeenCalledWith('old-passphrase', 'new-passphrase');
    expect(screen.getByLabelText('Current Passphrase')).toHaveValue('');
  });

  it('shows the failure and keeps what the user typed when the change is refused', async () => {
    rotatePassphrase.mockRejectedValue(new Error('Current passphrase is incorrect'));
    render(<PassphraseSection />);

    fillAndSubmit('wrong-passphrase', 'new-passphrase', 'new-passphrase');

    expect(await screen.findByText('Current passphrase is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText('Current Passphrase')).toHaveValue('wrong-passphrase');
    expect(screen.getByRole('button', { name: /Change Encryption Passphrase/i })).toBeEnabled();
  });
});
