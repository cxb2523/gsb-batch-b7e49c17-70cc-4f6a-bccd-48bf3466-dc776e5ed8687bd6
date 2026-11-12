import { describe, it, expect } from 'vitest';
import { sceneFileIds } from './scene-files';

describe('sceneFileIds', () => {
  it('lists each image file once and ignores deleted images and other elements', () => {
    const ids = sceneFileIds([
      { type: 'image', fileId: 'a' },
      { type: 'image', fileId: 'b', isDeleted: true },
      { type: 'rectangle' },
      { type: 'image', fileId: 'a' },
      { type: 'image', fileId: 'c', isDeleted: false },
      { type: 'image' },
    ]);

    expect(ids).toEqual(['a', 'c']);
  });
});
