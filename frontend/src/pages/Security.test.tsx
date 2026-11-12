import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Security } from './Security';

describe('Security Component', () => {
  it('renders rewritten Security & threat model page with honest sections', () => {
    render(
      <BrowserRouter>
        <Security />
      </BrowserRouter>,
    );

    expect(
      screen.getByRole('heading', { name: /How CanvHQ protects your canvases/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /What is encrypted/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /What is not end-to-end encrypted/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /What you need to do/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Limits/i })).toBeInTheDocument();
    expect(screen.getByText(/Technical details/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Sign In/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
