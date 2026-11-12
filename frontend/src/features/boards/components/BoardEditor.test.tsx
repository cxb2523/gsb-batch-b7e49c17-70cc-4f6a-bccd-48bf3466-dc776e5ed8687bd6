import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { BoardEditor } from './BoardEditor';

interface MockExcalidrawProps {
  viewModeEnabled?: boolean;
  UIOptions?: { canvasActions?: Record<string, boolean> };
  onChange?: (elements: unknown[], appState: object) => void;
  onExcalidrawAPI?: (api: object) => void;
}

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: ({ viewModeEnabled, UIOptions, onChange, onExcalidrawAPI }: MockExcalidrawProps) => (
    <div>
      <span data-testid="view-mode">{String(viewModeEnabled)}</span>
      <span data-testid="clear-canvas">{String(UIOptions?.canvasActions?.clearCanvas)}</span>
      <button onClick={() => onChange?.([{ id: 'e1' }], {})}>draw</button>
      <button onClick={() => onExcalidrawAPI?.({ id: 'api' })}>attach</button>
    </div>
  ),
}));

describe('BoardEditor', () => {
  it('lets an editor change the canvas and forwards what they draw', () => {
    const onChange = vi.fn();
    render(
      <BoardEditor
        apiRef={{ current: null }}
        initialData={null}
        isViewer={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('view-mode')).toHaveTextContent('false');
    expect(screen.getByTestId('clear-canvas')).toHaveTextContent('true');

    fireEvent.click(screen.getByText('draw'));
    expect(onChange).toHaveBeenCalledWith([{ id: 'e1' }], {});
  });

  it('is view-only and cannot clear the canvas for a viewer', () => {
    render(
      <BoardEditor apiRef={{ current: null }} initialData={null} isViewer onChange={vi.fn()} />,
    );

    expect(screen.getByTestId('view-mode')).toHaveTextContent('true');
    expect(screen.getByTestId('clear-canvas')).toHaveTextContent('false');
  });

  it('hands the editor API to the caller', () => {
    const apiRef: { current: ExcalidrawImperativeAPI | null } = { current: null };
    render(<BoardEditor apiRef={apiRef} initialData={null} isViewer={false} onChange={vi.fn()} />);

    fireEvent.click(screen.getByText('attach'));

    expect(apiRef.current).not.toBeNull();
  });
});
