import type { MutableRefObject } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import { CanvasErrorBoundary } from '@/components/CanvasErrorBoundary';

interface BoardEditorProps {
  apiRef: MutableRefObject<ExcalidrawImperativeAPI | null>;
  initialData: ExcalidrawInitialDataState | null;
  isViewer: boolean;
  onChange: (elements: readonly ExcalidrawElement[], appState: AppState) => void;
}

/** The Excalidraw canvas. A render crash here offers the scene as a backup instead of losing it. */
export function BoardEditor({ apiRef, initialData, isViewer, onChange }: BoardEditorProps) {
  return (
    <CanvasErrorBoundary getBackupData={() => apiRef.current?.getSceneElements?.() || []}>
      <Excalidraw
        theme="light"
        viewModeEnabled={isViewer}
        onExcalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        {...(initialData ? { initialData } : {})}
        onChange={onChange}
        objectsSnapModeEnabled={true}
        UIOptions={{
          canvasActions: {
            export: false,
            saveAsImage: true,
            loadScene: false,
            saveToActiveFile: false,
            changeViewBackgroundColor: !isViewer,
            clearCanvas: !isViewer,
            toggleTheme: false,
          },
        }}
      />
    </CanvasErrorBoundary>
  );
}
