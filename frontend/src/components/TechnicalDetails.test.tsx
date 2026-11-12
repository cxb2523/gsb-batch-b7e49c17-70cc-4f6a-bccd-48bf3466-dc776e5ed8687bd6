import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TechnicalDetails } from './TechnicalDetails';

describe('TechnicalDetails', () => {
  it('renders summary title and child content', () => {
    render(
      <TechnicalDetails title="Deep Dive">
        <p>Implementation specifications</p>
      </TechnicalDetails>,
    );

    expect(screen.getByText('Deep Dive')).toBeInTheDocument();
    expect(screen.getByText('Implementation specifications')).toBeInTheDocument();
  });
});
