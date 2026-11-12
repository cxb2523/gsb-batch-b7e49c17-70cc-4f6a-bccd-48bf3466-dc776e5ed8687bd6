import { convertToExcalidrawElements, exportToBlob, getCommonBounds } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { toast } from 'sonner';

/** Downloads the current scene as a PNG, telling the user whether it worked. */
export async function exportCanvasImage(api: ExcalidrawImperativeAPI, title: string) {
  try {
    const blob = await exportToBlob({
      elements: api.getSceneElements?.() || [],
      appState: { ...(api.getAppState?.() || {}), exportWithDarkMode: false },
      files: api.getFiles?.() || {},
      mimeType: 'image/png',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title || 'canvas'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Canvas image exported successfully');
  } catch (err) {
    console.error('Failed to export canvas image', err);
    toast.error('Failed to export canvas image.');
  }
}

export interface PlacedDiagram {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  importedCount: number;
}

/**
 * Adds imported Mermaid elements to the scene, centred on what the user is looking at.
 * Returns the merged scene for the caller to save, or null when nothing could be placed.
 */
export function placeMermaidDiagram(
  api: ExcalidrawImperativeAPI,
  skeletons: ExcalidrawElementSkeleton[],
  files?: BinaryFiles,
): PlacedDiagram | null {
  if (skeletons.length === 0) return null;

  if (files && Object.keys(files).length > 0 && typeof api.addFiles === 'function') {
    api.addFiles(Object.values(files));
  }

  const imported = convertToExcalidrawElements(skeletons);
  if (imported.length === 0) return null;

  const [minX, minY, maxX, maxY] = getCommonBounds(imported);
  const appState = api.getAppState();
  const zoom = appState.zoom?.value || 1;
  const viewportCenterX = -appState.scrollX + appState.width / 2 / zoom;
  const viewportCenterY = -appState.scrollY + appState.height / 2 / zoom;
  const offsetX = Math.round(viewportCenterX - (minX + (maxX - minX) / 2));
  const offsetY = Math.round(viewportCenterY - (minY + (maxY - minY) / 2));

  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    console.error('Invalid Mermaid diagram placement bounds:', { offsetX, offsetY });
    toast.error('Failed to position diagram: invalid coordinates.');
    return null;
  }

  const positioned = imported.map((el) =>
    Object.assign({}, el, { x: el.x + offsetX, y: el.y + offsetY }),
  );
  const elements = [...(api.getSceneElements() || []), ...positioned];
  api.updateScene({ elements });

  return { elements, appState, importedCount: positioned.length };
}
