import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileAsideNotes } from './ProfileAsideNotes';

describe('ProfileAsideNotes', () => {
  it('renders the security and portability notes', () => {
    render(<ProfileAsideNotes />);

    expect(screen.getByText('Security by default.')).toBeInTheDocument();
    expect(screen.getByText('Your data stays portable.')).toBeInTheDocument();
  });
});
