import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import { importKeyFromHash } from '@/lib/crypto';
import { decryptBoardFile, openBoardPayload } from '@/lib/crypto-format';
import { errorMessage } from '@/lib/errors';
import { bytesToDataUrl } from '@/lib/image-resize';
import { parseBoardScene } from '@/features/boards/board-load';
import { initialSceneData } from '@/features/boards/initial-scene';
import { getPublicBoardFile } from '@/features/boards/api';
import type { PublicBoardMetadata } from './schemas';

export type PublicBoardOpening = { scene: ExcalidrawInitialDataState } | { error: string };

/** Where the key text came from: the link's fragment, or what the viewer typed in. */
export type KeySource = 'hash' | 'manual';

function isBinaryFileData(value: unknown): value is BinaryFileData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'dataURL' in value &&
    'mimeType' in value &&
    'created' in value
  );
}

/**
 * Opens a shared board with the key the viewer holds. A bad key is a message for the key dialog,
 * never a thrown error: the viewer can simply try another one.
 */
export async function openPublicBoard(
  metadata: PublicBoardMetadata,
  keyText: string,
  source: KeySource,
  payload: ArrayBuffer | undefined,
  token?: string,
): Promise<PublicBoardOpening> {
  let key: CryptoKey;
  try {
    key = await importKeyFromHash(keyText);
  } catch (err) {
    console.error('Failed to import the public share key', err);
    return {
      error:
        source === 'hash'
          ? 'Invalid encryption key in URL hash fragment.'
          : (errorMessage(err) ?? 'Invalid encryption key format'),
    };
  }

  if (!metadata.hasPayload) return { scene: initialSceneData() };

  try {
    const bytes = payload ? new Uint8Array(payload) : new Uint8Array(0);
    let payloadRevision = metadata.revision ?? 0;
    if (bytes.length >= 9 && bytes[0] === 0x01) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      payloadRevision = view.getUint32(5, false);
    }

    const scene = parseBoardScene(
      await openBoardPayload(key, bytes, {
        boardId: metadata.id,
        keyVersion: metadata.keyVersion ?? 1,
        revision: payloadRevision,
      }),
    );

    const activeFileIds: string[] = [];
    for (const el of scene.elements) {
      if (el.type === 'image' && el.fileId && !el.isDeleted) {
        if (!activeFileIds.includes(el.fileId)) {
          activeFileIds.push(el.fileId);
        }
      }
    }

    const loadedFiles: BinaryFiles = {};
    if (token && activeFileIds.length > 0) {
      await Promise.all(
        activeFileIds.map(async (fileId) => {
          try {
            const encryptedBytes = await getPublicBoardFile(token, fileId);
            const { mimeType, data } = await decryptBoardFile(key, encryptedBytes, {
              boardId: metadata.id,
              boardKeyVersion: metadata.keyVersion ?? 1,
              fileId,
            });
            const dataURL = bytesToDataUrl(data, mimeType);
            const entry = {
              id: fileId,
              dataURL,
              mimeType,
              created: Date.now(),
            };
            if (isBinaryFileData(entry)) {
              loadedFiles[fileId] = entry;
            }
          } catch (err) {
            console.warn(`Failed to decrypt public board file ${fileId}:`, err);
          }
        }),
      );
    }

    return { scene: initialSceneData(scene, loadedFiles) };
  } catch (err) {
    console.error('Public payload decryption failed', err);
    return {
      error: 'Decryption failed. The encryption key in the link may be invalid or corrupt.',
    };
  }
}
