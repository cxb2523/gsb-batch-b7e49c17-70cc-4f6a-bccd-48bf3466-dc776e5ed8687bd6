import type { RekeyProgress } from './rekey-runner';

/** What the page tells the re-key worker. */
export type RekeyWorkerRequest =
  | {
      type: 'start';
      workspaceId: string;
      userId: string;
      /** The unlocked private key; a non-extractable CryptoKey survives structured cloning. */
      privateKey: CryptoKey;
    }
  | { type: 'pause' }
  | { type: 'resume' };

/** What the re-key worker tells the page. */
export type RekeyWorkerResponse =
  | { type: 'progress'; progress: RekeyProgress }
  | { type: 'finished'; progress: RekeyProgress }
  | { type: 'error'; message: string };
