import { describe, it, expect } from 'vitest';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { initialSceneData } from './initial-scene';

describe('initialSceneData', () => {
  it('starts an empty canvas with the technical defaults', () => {
    const data = initialSceneData();

    expect(data.elements).toEqual([]);
    expect(data.appState).toMatchObject({
      gridModeEnabled: true,
      objectsSnapModeEnabled: true,
      currentItemRoundness: 'round',
      currentItemRoughness: 0,
    });
    expect(data.libraryItems).toBeUndefined();
  });

  it('keeps what the saved scene stored, but always snaps to the grid', () => {
    const data = initialSceneData({
      elements: convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0 }]),
      appState: {
        viewBackgroundColor: '#eeeeee',
        objectsSnapModeEnabled: false,
        currentItemRoughness: 2,
      },
    });

    expect(data.elements?.map((element) => element.type)).toEqual(['rectangle']);
    expect(data.appState).toMatchObject({
      viewBackgroundColor: '#eeeeee',
      objectsSnapModeEnabled: true,
      currentItemRoughness: 2,
      currentItemRoundness: 'round',
    });
  });
});
