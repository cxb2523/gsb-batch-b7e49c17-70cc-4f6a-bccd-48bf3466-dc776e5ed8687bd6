import { describe, it, expect, beforeAll } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { exportKeyToHash, generateSymmetricKey } from '@/lib/crypto';
import { sealBoardPayload } from '@/lib/crypto-format';
import type { PublicBoardMetadata } from '../schemas';
import { usePublicBoardOpening } from './usePublicBoardOpening';

const emptyBoard: PublicBoardMetadata = { id: 'b1', title: 'Shared', hasPayload: false };
const storedBoard: PublicBoardMetadata = {
  id: 'b1',
  title: 'Shared',
  hasPayload: true,
  keyVersion: 1,
};

describe('usePublicBoardOpening', () => {
  let keyText: string;
  let payload: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    const key = await generateSymmetricKey();
    keyText = await exportKeyToHash(key);
    payload = await sealBoardPayload(
      key,
      { elements: [{ id: 'e1' }] },
      { boardId: 'b1', keyVersion: 1, revision: 1 },
    );
  });

  it('has nothing to show until it has a key', () => {
    const { result } = renderHook(() =>
      usePublicBoardOpening(emptyBoard, undefined, 'hash', undefined),
    );

    expect(result.current).toBeNull();
  });

  it('opens an empty board with a valid key', async () => {
    const { result } = renderHook(() =>
      usePublicBoardOpening(emptyBoard, keyText, 'hash', undefined),
    );

    await waitFor(() => expect(result.current).toMatchObject({ scene: { elements: [] } }));
  });

  it('waits for the payload of a board that has one, then decrypts it', async () => {
    const { result, rerender } = renderHook(
      ({ bytes }: { bytes: ArrayBuffer | undefined }) =>
        usePublicBoardOpening(storedBoard, keyText, 'hash', bytes),
      { initialProps: { bytes: undefined as ArrayBuffer | undefined } },
    );
    expect(result.current).toBeNull();

    rerender({ bytes: payload.buffer });

    await waitFor(() =>
      expect(result.current).toMatchObject({ scene: { elements: [{ id: 'e1' }] } }),
    );
  });

  it('never shows the result of an earlier key for a new one', async () => {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => usePublicBoardOpening(emptyBoard, text, 'manual', undefined),
      { initialProps: { text: keyText } },
    );
    await waitFor(() => expect(result.current).toMatchObject({ scene: expect.anything() }));

    rerender({ text: 'AAAA' });

    // Straight after the key changes there is no result, then the new key's error replaces it.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toMatchObject({ error: expect.any(String) }));
  });
});
