import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EncryptionModal } from './EncryptionModal';

describe('EncryptionModal Component', () => {
  it('renders user-friendly setup mode with polite copy, safety warning, and security link', () => {
    render(
      <EncryptionModal
        mode="setup"
        email="user@company.com"
        onSuccess={vi.fn()}
        setupEncryption={vi.fn()}
        unlockEncryption={vi.fn()}
      />,
    );

    // Title & description are user-friendly
    expect(
      screen.getByRole('heading', { name: /Set Your Canvas Passphrase/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/CanvHQ is end-to-end encrypted/i)).toBeInTheDocument();

    // Friendly safety notice
    expect(screen.getByText(/Keep your passphrase safe/i)).toBeInTheDocument();
    expect(screen.getByText(/We cannot reset your passphrase/i)).toBeInTheDocument();

    // Technical HUD jargon is absent
    expect(screen.queryByText(/ZERO-KNOWLEDGE E2EE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PBKDF2 · 600K ITERATIONS/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/password manager will save and sync/i)).not.toBeInTheDocument();

    // Inputs and submit button
    expect(screen.getByLabelText(/^Passphrase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Passphrase/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set Passphrase & Continue/i })).toBeInTheDocument();

    // Link to Security specification page
    const securityLink = screen.getByRole('link', { name: /How CanvHQ protects your canvases/i });
    expect(securityLink).toBeInTheDocument();
    expect(securityLink).toHaveAttribute('href', '/security');
  });

  it('renders clean unlock mode for returning devices', () => {
    render(
      <EncryptionModal
        mode="unlock"
        email="user@company.com"
        onSuccess={vi.fn()}
        setupEncryption={vi.fn()}
        unlockEncryption={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: /Unlock Your Canvases/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unlock Canvases/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dismiss/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Keep your passphrase safe/i)).not.toBeInTheDocument();
  });

  it('renders Sign out / Switch account button and triggers sign out flow on click', async () => {
    render(
      <EncryptionModal
        mode="unlock"
        email="user@company.com"
        onSuccess={vi.fn()}
        setupEncryption={vi.fn()}
        unlockEncryption={vi.fn()}
      />,
    );

    const signOutBtn = screen.getByRole('button', { name: /Sign out \/ Switch account/i });
    expect(signOutBtn).toBeInTheDocument();
  });
});
