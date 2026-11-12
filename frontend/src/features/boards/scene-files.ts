/** The elements of a scene that can reference an image file. */
interface SceneElement {
  type?: unknown;
  fileId?: unknown;
  isDeleted?: unknown;
}

/** The ids of the image files a scene still shows, each once, in the order they appear. */
export function sceneFileIds(elements: readonly SceneElement[]): string[] {
  const ids = new Set<string>();
  for (const element of elements) {
    if (element.type === 'image' && typeof element.fileId === 'string' && !element.isDeleted) {
      ids.add(element.fileId);
    }
  }
  return [...ids];
}
