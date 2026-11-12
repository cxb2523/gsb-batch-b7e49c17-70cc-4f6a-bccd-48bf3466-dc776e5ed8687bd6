import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { SetupPassphrase } from './SetupPassphrase';

const mockSetupEncryption = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({
    setupEncryption: mockSetupEncryption,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('SetupPassphrase Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  const renderSetup = () =>
    render(
      <BrowserRouter>
        <SetupPassphrase />
      </BrowserRouter>,
    );

  const fill = (passphrase: string, confirm = passphrase) => {
    fireEvent.change(screen.getByLabelText(/^Passphrase/i), {
      target: { value: passphrase },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Passphrase/i), {
      target: { value: confirm },
    });
  };

  const acknowledge = () => fireEvent.click(screen.getByLabelText(/cannot be recovered/i));

  it('renders heading, inputs, the no-recovery warning and the acknowledgement', () => {
    renderSetup();
    expect(screen.getByText(/A better space to think/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Set your canvas passphrase/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Passphrase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Passphrase/i)).toBeInTheDocument();
    expect(screen.getAllByText(/cannot be recovered/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/cannot be recovered/i)).not.toBeChecked();
  });

  it('keeps the submit disabled until the warning is acknowledged', () => {
    renderSetup();
    fill('correct-horse-battery');

    const submit = screen.getByRole('button', { name: /Complete setup/i });
    expect(submit).toBeDisabled();

    acknowledge();
    expect(submit).toBeEnabled();
  });

  it('displays error if passphrase is shorter than 8 characters', async () => {
    renderSetup();
    fill('short');
    acknowledge();

    fireEvent.click(screen.getByRole('button', { name: /Complete setup/i }));

    expect(screen.getByText(/Passphrase must be at least 8 characters long/i)).toBeInTheDocument();
    expect(mockSetupEncryption).not.toHaveBeenCalled();
  });

  it('displays error if passphrases do not match', async () => {
    renderSetup();
    fill('validpass123', 'mismatchpass456');
    acknowledge();

    fireEvent.click(screen.getByRole('button', { name: /Complete setup/i }));

    expect(screen.getByText(/Passphrases do not match/i)).toBeInTheDocument();
    expect(mockSetupEncryption).not.toHaveBeenCalled();
  });

  it('sets up encryption and continues to /workspace by default', async () => {
    mockSetupEncryption.mockResolvedValue(undefined);
    renderSetup();
    fill('correct-horse-battery');
    acknowledge();

    fireEvent.click(screen.getByRole('button', { name: /Complete setup/i }));

    await waitFor(() => {
      expect(mockSetupEncryption).toHaveBeenCalledWith('correct-horse-battery');
      expect(mockNavigate).toHaveBeenCalledWith('/workspace', { replace: true });
    });
  });

  it('continues to the requested internal route after set-up', async () => {
    mockSetupEncryption.mockResolvedValue(undefined);
    window.history.pushState({}, '', '/setup-passphrase?next=%2Fcreate-workspace');
    renderSetup();
    fill('correct-horse-battery');
    acknowledge();

    fireEvent.click(screen.getByRole('button', { name: /Complete setup/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/create-workspace', { replace: true });
    });
  });
});
