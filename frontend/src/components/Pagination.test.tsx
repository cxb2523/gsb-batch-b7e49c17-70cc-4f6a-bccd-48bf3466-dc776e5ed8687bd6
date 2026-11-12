import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from './Pagination';

describe('Pagination Component', () => {
  it('renders range text and triggers page controls', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();

    render(
      <Pagination
        page={2}
        limit={20}
        total={45}
        hasPrevPage={true}
        hasNextPage={true}
        onPrev={onPrev}
        onNext={onNext}
        entityName="PROJECTS"
      />,
    );

    expect(screen.getByText('SHOWING 21–40 OF 45 PROJECTS')).toBeInTheDocument();

    const prevBtn = screen.getByRole('button', { name: /← PREVIOUS/i });
    const nextBtn = screen.getByRole('button', { name: /NEXT →/i });

    expect(prevBtn).not.toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    fireEvent.click(prevBtn);
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(nextBtn);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('handles 0 total items and disables boundary buttons', () => {
    render(
      <Pagination
        page={1}
        limit={20}
        total={0}
        hasPrevPage={false}
        hasNextPage={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        entityName="MEMBERS"
      />,
    );

    expect(screen.getByText('SHOWING 0 OF 0 MEMBERS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /← PREVIOUS/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /NEXT →/i })).toBeDisabled();
  });
});
