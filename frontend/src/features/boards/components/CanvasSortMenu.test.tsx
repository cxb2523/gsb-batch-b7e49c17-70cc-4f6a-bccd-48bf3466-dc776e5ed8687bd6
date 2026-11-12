import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasSortMenu } from './CanvasSortMenu';

describe('CanvasSortMenu', () => {
  it('shows the current sort and reports a choice from the popover, then closes it', () => {
    const onChange = vi.fn();
    render(<CanvasSortMenu value="updated-desc" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Recently updated/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Title (A–Z)' }));

    expect(onChange).toHaveBeenCalledWith('title-asc');
    expect(screen.queryByText('Sort canvases')).not.toBeInTheDocument();
  });

  it('reports a choice from the accessible select', () => {
    const onChange = vi.fn();
    render(<CanvasSortMenu value="updated-desc" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'created-asc' } });
    expect(onChange).toHaveBeenCalledWith('created-asc');
  });

  it('closes when the user clicks elsewhere', () => {
    render(<CanvasSortMenu value="updated-desc" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Recently updated/ }));
    expect(screen.getByText('Sort canvases')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Sort canvases')).not.toBeInTheDocument();
  });
});
