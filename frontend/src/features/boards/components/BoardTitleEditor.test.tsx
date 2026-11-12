import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { UpdateBoardInputSchema } from '@/features/boards/schemas';
import { BoardTitleEditor } from './BoardTitleEditor';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function startEditing(title = 'Mesh') {
  fireEvent.click(screen.getByText(title));
  return screen.getByDisplayValue(title);
}

describe('BoardTitleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a placeholder for an untitled board', () => {
    render(<BoardTitleEditor title="" isViewer={false} onRename={vi.fn()} />);
    expect(screen.getByText('Untitled Canvas')).toBeInTheDocument();
  });

  it('renames on Enter with the trimmed text', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<BoardTitleEditor title="Mesh" isViewer={false} onRename={onRename} />);

    const input = startEditing();
    fireEvent.change(input, { target: { value: '  Mesh v2  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Mesh v2'));
    await waitFor(() => expect(screen.queryByDisplayValue('Mesh v2')).not.toBeInTheDocument());
  });

  it('does not send a rename for an empty or unchanged title', () => {
    const onRename = vi.fn();
    render(<BoardTitleEditor title="Mesh" isViewer={false} onRename={onRename} />);

    const input = startEditing();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Mesh')).toBeInTheDocument();
  });

  it('tells the user and keeps the old title when the rename is refused', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('refused'));
    render(<BoardTitleEditor title="Mesh" isViewer={false} onRename={onRename} />);

    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Refused' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('refused'));
    expect(screen.getByText('Mesh')).toBeInTheDocument();
    expect(screen.queryByText('Refused')).not.toBeInTheDocument();
  });

  it('keeps the old title and says why when the new one has characters that are not allowed', async () => {
    // The real call refuses before it sends: the same schema the server applies.
    const onRename = vi.fn().mockImplementation(async (title: string) => {
      UpdateBoardInputSchema.parse({ title });
    });
    render(<BoardTitleEditor title="Mesh" isViewer={false} onRename={onRename} />);

    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Mesh; v2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/^Canvas title can only use letters/),
      ),
    );
    expect(screen.getByText('Mesh')).toBeInTheDocument();
  });

  it('sends one rename when Enter is followed by a blur', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<BoardTitleEditor title="Mesh" isViewer={false} onRename={onRename} />);

    const input = startEditing();
    fireEvent.change(input, { target: { value: 'Mesh v2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
  });

  it('gives a viewer the title and a badge, and no way to edit', () => {
    render(<BoardTitleEditor title="Mesh" isViewer onRename={vi.fn()} />);

    fireEvent.click(screen.getByText('Mesh'));

    expect(screen.getByText('VIEWER')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Mesh')).not.toBeInTheDocument();
  });
});
