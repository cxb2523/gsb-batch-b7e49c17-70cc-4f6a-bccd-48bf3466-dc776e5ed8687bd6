import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

/**
 * Puts the elements of an unsaved copy onto the scene that is open now. The copy was made from an
 * older state of the canvas, so replacing the scene with it would remove whatever was saved in
 * between. Elements only the copy has are added; where both have the same element the one with the
 * later version stays, so the open scene wins a tie.
 */
export function mergeRestoredElements(
  current: readonly ExcalidrawElement[],
  restored: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const restoredById = new Map(restored.map((element) => [element.id, element]));
  const currentIds = new Set(current.map((element) => element.id));

  const kept = current.map((element) => {
    const copy = restoredById.get(element.id);
    return copy && copy.version > element.version ? copy : element;
  });
  const added = restored.filter((element) => !currentIds.has(element.id));

  return [...kept, ...added];
}
