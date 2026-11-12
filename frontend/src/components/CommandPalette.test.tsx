import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette Component', () => {
  const mockBoards = [
    { id: 'b1', title: 'Topology Mesh Architecture', projectName: 'Core Infra' },
    { id: 'b2', title: 'Payment Gateway Flow', projectName: 'Billing' },
    { id: 'b3', title: 'OAuth2 Authentication Sequence', projectName: 'Auth System' },
  ];

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <CommandPalette
        isOpen={false}
        onClose={vi.fn()}
        boards={mockBoards}
        onSelectBoard={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders search input and all boards when open', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={vi.fn()}
        boards={mockBoards}
        onSelectBoard={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText(/Search by title or project/i)).toBeInTheDocument();
    expect(screen.getByText('Topology Mesh Architecture')).toBeInTheDocument();
    expect(screen.getByText('Payment Gateway Flow')).toBeInTheDocument();
    expect(screen.getByText('OAuth2 Authentication Sequence')).toBeInTheDocument();
  });

  it('filters boards by title search query', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={vi.fn()}
        boards={mockBoards}
        onSelectBoard={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/Search by title or project/i);
    fireEvent.change(input, { target: { value: 'Payment' } });

    expect(screen.getByText('Payment Gateway Flow')).toBeInTheDocument();
    expect(screen.queryByText('Topology Mesh Architecture')).not.toBeInTheDocument();
  });

  it('calls onSelectBoard and onClose when a result is clicked', () => {
    const onSelectMock = vi.fn();
    const onCloseMock = vi.fn();

    render(
      <CommandPalette
        isOpen={true}
        onClose={onCloseMock}
        boards={mockBoards}
        onSelectBoard={onSelectMock}
      />,
    );

    fireEvent.click(screen.getByText('Payment Gateway Flow'));

    expect(onSelectMock).toHaveBeenCalledWith('b2');
    expect(onCloseMock).toHaveBeenCalled();
  });

  it('calls onClose when clicking close button or pressing Escape', () => {
    const onCloseMock = vi.fn();

    render(
      <CommandPalette
        isOpen={true}
        onClose={onCloseMock}
        boards={mockBoards}
        onSelectBoard={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseMock).toHaveBeenCalled();
  });
});
