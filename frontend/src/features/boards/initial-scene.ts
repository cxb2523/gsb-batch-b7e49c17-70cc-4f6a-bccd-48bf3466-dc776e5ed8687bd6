import type { BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import type { BoardScene } from './board-load';

/** Soft rounded corners, clean lines, snapped to the grid. */
const technicalDefaultAppState = {
  viewBackgroundColor: '#ffffff',
  gridModeEnabled: true,
  objectsSnapModeEnabled: true,
  currentItemRoundness: 'round' as const,
  currentItemRoughness: 0,
  currentItemFontFamily: 3, // Cascadia / Code font
};

/** The editor's initial data for a decrypted scene, or for an empty canvas when there is none. */
export function initialSceneData(
  scene?: BoardScene,
  files?: BinaryFiles,
): ExcalidrawInitialDataState {
  const result: ExcalidrawInitialDataState = {
    elements: scene?.elements ?? [],
    appState: {
      ...technicalDefaultAppState,
      ...(scene?.appState ?? {}),
      objectsSnapModeEnabled: true,
      currentItemRoundness: scene?.appState?.currentItemRoundness || 'round',
      currentItemRoughness: scene?.appState?.currentItemRoughness ?? 0,
    },
  };
  if (files !== undefined) {
    result.files = files;
  }
  return result;
}
