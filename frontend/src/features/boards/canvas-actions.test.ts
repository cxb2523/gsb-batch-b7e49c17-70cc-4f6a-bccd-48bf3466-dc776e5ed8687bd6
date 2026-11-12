import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportToBlob, getCommonBounds } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform';
import { toast } from 'sonner';
import { exportCanvasImage, placeMermaidDiagram } from './canvas-actions';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@excalidraw/excalidraw', () => ({
  exportToBlob: vi.fn(),
  getCommonBounds: vi.fn(),
  convertToExcalidrawElements: vi.fn((skeletons: Array<{ id: string; x: number; y: number }>) =>
    skeletons.map((skeleton) => ({ ...skeleton })),
  ),
}));

function fakeApi(appState: object = {}, sceneElements: object[] = []) {
  const api = {
    getSceneElements: vi.fn(() => sceneElements),
    getAppState: vi.fn(() => appState),
    getFiles: vi.fn(() => ({})),
    updateScene: vi.fn(),
  };
  return { api, typed: api as unknown as ExcalidrawImperativeAPI };
}

describe('exportCanvasImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:canvas');
    URL.revokeObjectURL = vi.fn();
  });

  it('downloads the scene as a PNG named after the board', async () => {
    vi.mocked(exportToBlob).mockResolvedValue(new Blob(['png']));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    await exportCanvasImage(fakeApi().typed, 'Mesh');

    expect(clicked).toEqual(['Mesh.png']);
    expect(toast.success).toHaveBeenCalledWith('Canvas image exported successfully');
  });

  it('falls back to a generic file name for an untitled board', async () => {
    vi.mocked(exportToBlob).mockResolvedValue(new Blob(['png']));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    await exportCanvasImage(fakeApi().typed, '');

    expect(clicked).toEqual(['canvas.png']);
  });

  it('tells the user when the export fails', async () => {
    vi.mocked(exportToBlob).mockRejectedValue(new Error('canvas too large'));

    await exportCanvasImage(fakeApi().typed, 'Mesh');

    expect(toast.error).toHaveBeenCalledWith('Failed to export canvas image.');
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('placeMermaidDiagram', () => {
  const skeletons = [
    { id: 'n1', type: 'rectangle', x: 10, y: 20 },
  ] as unknown as ExcalidrawElementSkeleton[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getCommonBounds).mockReturnValue([0, 0, 100, 100]);
  });

  it('centres the diagram on the viewport and adds it after the existing elements', () => {
    const { api, typed } = fakeApi(
      { scrollX: 0, scrollY: 0, width: 1000, height: 800, zoom: { value: 1 } },
      [{ id: 'existing', x: 0, y: 0 }],
    );

    const placed = placeMermaidDiagram(typed, skeletons);

    // The viewport centre is (500, 400) and the diagram centre (50, 50).
    expect(placed?.importedCount).toBe(1);
    expect(placed?.elements).toEqual([
      { id: 'existing', x: 0, y: 0 },
      { id: 'n1', type: 'rectangle', x: 460, y: 370 },
    ]);
    expect(api.updateScene).toHaveBeenCalledWith({ elements: placed?.elements });
  });

  it('places nothing for an empty import', () => {
    const { api, typed } = fakeApi();

    expect(placeMermaidDiagram(typed, [])).toBeNull();
    expect(api.updateScene).not.toHaveBeenCalled();
  });

  it('tells the user when the viewport has no usable size', () => {
    const { api, typed } = fakeApi({ scrollX: 0, scrollY: 0, width: Number.NaN, height: 800 });

    expect(placeMermaidDiagram(typed, skeletons)).toBeNull();

    expect(toast.error).toHaveBeenCalledWith('Failed to position diagram: invalid coordinates.');
    expect(api.updateScene).not.toHaveBeenCalled();
  });
});
