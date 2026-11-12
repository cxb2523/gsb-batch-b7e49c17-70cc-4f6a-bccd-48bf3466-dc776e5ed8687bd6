import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toaster } from 'sonner';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';

const BombComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Explosive canvas rendering error');
  }
  return <div>Canvas Normal Rendering</div>;
};

describe('CanvasErrorBoundary Component', () => {
  it('renders children normally when no error occurs', () => {
    render(
      <CanvasErrorBoundary>
        <div>Normal Canvas Content</div>
      </CanvasErrorBoundary>,
    );

    expect(screen.getByText('Normal Canvas Content')).toBeInTheDocument();
  });

  it('catches canvas crash and renders recovery UI with Reload and Export buttons', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (!global.URL.createObjectURL) {
      global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    }
    if (!global.URL.revokeObjectURL) {
      global.URL.revokeObjectURL = vi.fn();
    }

    const onReset = vi.fn();
    const getBackupData = vi.fn().mockReturnValue([{ id: 'elem-1', type: 'rectangle' }]);

    const { rerender } = render(
      <CanvasErrorBoundary onReset={onReset} getBackupData={getBackupData}>
        <BombComponent shouldThrow={false} />
      </CanvasErrorBoundary>,
    );

    expect(screen.getByText('Canvas Normal Rendering')).toBeInTheDocument();

    // Trigger crash
    rerender(
      <CanvasErrorBoundary onReset={onReset} getBackupData={getBackupData}>
        <BombComponent shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    expect(screen.getByText('Canvas Rendering Error')).toBeInTheDocument();
    expect(
      screen.getByText(/The diagram engine encountered an unexpected runtime failure/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Explosive canvas rendering error')).toBeInTheDocument();

    const reloadBtn = screen.getByRole('button', { name: /Reload Canvas/i });
    const backupBtn = screen.getByRole('button', { name: /Export Emergency Backup/i });

    expect(reloadBtn).toBeInTheDocument();
    expect(backupBtn).toBeInTheDocument();

    // Test Export Emergency Backup first while in error state
    fireEvent.click(backupBtn);
    expect(getBackupData).toHaveBeenCalled();

    // Test Reload Canvas
    fireEvent.click(reloadBtn);
    expect(onReset).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('triggers anchor click and file download with valid JSON backup blob and timestamped filename', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const captured: { blob: Blob | null } = { blob: null };
    const createObjectURLSpy = vi.fn().mockImplementation((blob: Blob) => {
      captured.blob = blob;
      return 'blob:mock-emergency-url';
    });
    const revokeObjectURLSpy = vi.fn();
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = revokeObjectURLSpy;

    const mockSceneElements = [
      { id: 'el-1', type: 'rectangle', x: 100, y: 100 },
      { id: 'el-2', type: 'diamond', x: 200, y: 200 },
    ];
    const getBackupData = vi.fn().mockReturnValue(mockSceneElements);

    render(
      <CanvasErrorBoundary getBackupData={getBackupData}>
        <BombComponent shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    const exportBtn = screen.getByRole('button', { name: /Export Emergency Backup/i });
    fireEvent.click(exportBtn);

    expect(getBackupData).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-emergency-url');

    expect(captured.blob).toBeInstanceOf(Blob);
    expect(captured.blob?.type).toBe('application/json');

    clickSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('exports fallback error JSON when getBackupData returns null or is not provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    let createdBlob: Blob | null = null;
    global.URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
      createdBlob = blob;
      return 'blob:mock-url';
    });
    global.URL.revokeObjectURL = vi.fn();

    render(
      <CanvasErrorBoundary>
        <BombComponent shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    const exportBtn = screen.getByRole('button', { name: /Export Emergency Backup/i });
    fireEvent.click(exportBtn);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createdBlob).toBeInstanceOf(Blob);

    clickSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('gracefully handles exceptions inside getBackupData without crashing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const faultyBackupData = vi.fn().mockImplementation(() => {
      throw new Error('Canvas internal buffer detached');
    });

    render(
      <CanvasErrorBoundary getBackupData={faultyBackupData}>
        <BombComponent shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    const exportBtn = screen.getByRole('button', { name: /Export Emergency Backup/i });
    expect(() => fireEvent.click(exportBtn)).not.toThrow();
    expect(faultyBackupData).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it('calls window.location.reload when onReset is not provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: reloadMock },
    });

    render(
      <CanvasErrorBoundary>
        <BombComponent shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    const reloadBtn = screen.getByRole('button', { name: /Reload Canvas/i });
    fireEvent.click(reloadBtn);

    expect(reloadMock).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it('tells the user when the emergency backup cannot be exported', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getBackupData = vi.fn().mockImplementation(() => {
      throw new Error('scene is unreadable');
    });

    render(
      <>
        <CanvasErrorBoundary getBackupData={getBackupData}>
          <BombComponent shouldThrow={true} />
        </CanvasErrorBoundary>
        <Toaster />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Export Emergency Backup/i }));

    expect(await screen.findByText('Could not export the emergency backup.')).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
