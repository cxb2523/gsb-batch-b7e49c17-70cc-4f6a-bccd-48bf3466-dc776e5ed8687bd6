import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingProjectAccess } from './PendingProjectAccess';

describe('PendingProjectAccess', () => {
  it('tells the member an administrator has to grant access', () => {
    render(<PendingProjectAccess />);
    expect(screen.getByText('Waiting for access')).toBeInTheDocument();
    expect(screen.getByText(/An administrator needs to grant you access/)).toBeInTheDocument();
  });
});
