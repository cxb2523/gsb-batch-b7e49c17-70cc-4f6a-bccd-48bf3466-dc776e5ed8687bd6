import { describe, it, expect } from 'vitest';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { mergeRestoredElements } from './merge-restored-elements';

const [template] = convertToExcalidrawElements([{ type: 'rectangle', x: 0, y: 0 }]);

const rectangle = (id: string, version: number): ExcalidrawElement => {
  if (!template) throw new Error('The test rectangle was not created.');
  return { ...template, id, version };
};

describe('mergeRestoredElements', () => {
  it('adds what only the unsaved copy has and keeps what was saved in between', () => {
    const saved = [rectangle('from-the-other-session', 3)];
    const copy = [rectangle('made-offline', 2)];

    expect(mergeRestoredElements(saved, copy).map((element) => element.id)).toEqual([
      'from-the-other-session',
      'made-offline',
    ]);
  });

  it('keeps the later version of an element both hold, and the open one on a tie', () => {
    const open = [rectangle('a', 4), rectangle('b', 2), rectangle('c', 3)];
    const copy = [rectangle('a', 3), rectangle('b', 5), rectangle('c', 3)];

    const merged = mergeRestoredElements(open, copy);

    expect(merged.map((element) => [element.id, element.version])).toEqual([
      ['a', 4],
      ['b', 5],
      ['c', 3],
    ]);
    expect(merged[2]).toBe(open[2]);
  });

  it('leaves the open scene as it is when the copy has nothing to add', () => {
    const open = [rectangle('a', 1)];

    expect(mergeRestoredElements(open, [])).toEqual(open);
  });
});
