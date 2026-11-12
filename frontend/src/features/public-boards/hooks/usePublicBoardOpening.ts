import { useEffect, useState } from 'react';
import { openPublicBoard, type KeySource, type PublicBoardOpening } from '../open-public-board';
import type { PublicBoardMetadata } from '../schemas';

interface Opened {
  metadata: PublicBoardMetadata;
  keyText: string;
  payload: ArrayBuffer | undefined;
  opening: PublicBoardOpening;
}

/**
 * Decrypts a shared board in the browser once its metadata, its payload (when it has one) and a
 * key are all in hand. Returns null until then, and again whenever any of them changes, so a
 * result is never shown for a different key than the one that produced it.
 */
export function usePublicBoardOpening(
  metadata: PublicBoardMetadata | undefined,
  keyText: string | undefined,
  source: KeySource,
  payload: ArrayBuffer | undefined,
  token?: string,
): PublicBoardOpening | null {
  const [opened, setOpened] = useState<Opened | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A board with a stored payload can only be opened once that payload has arrived.
    if (metadata && keyText && (!metadata.hasPayload || payload)) {
      void openPublicBoard(metadata, keyText, source, payload, token).then((opening) => {
        if (!cancelled) setOpened({ metadata, keyText, payload, opening });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [metadata, keyText, source, payload, token]);

  if (
    opened &&
    opened.metadata === metadata &&
    opened.keyText === keyText &&
    opened.payload === payload
  ) {
    return opened.opening;
  }
  return null;
}
