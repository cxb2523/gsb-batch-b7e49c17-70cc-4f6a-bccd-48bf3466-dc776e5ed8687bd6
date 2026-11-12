/**
 * Works through the re-key queue: two boards at a time, redoing a board that changed underneath
 * (at most three attempts), carrying on past a board that cannot be secured, and honouring pause
 * between boards. The queue is read once; `total` is its length at that moment.
 */

import type { RekeyQueue } from '@/features/workspaces/schemas';
import type { BoardOutcome } from './rekey-board';
import { runPool } from './pool';

const BOARD_CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;

export interface RekeyProgress {
  /** Boards dealt with so far, whether secured, skipped or failed. */
  done: number;
  total: number;
  failed: number;
  /** Boards with a public link, which keep their key. */
  skipped: number;
}

export interface RekeyRunnerDeps {
  fetchQueue: () => Promise<RekeyQueue>;
  rekeyBoard: (boardId: string) => Promise<BoardOutcome>;
  onProgress: (progress: RekeyProgress) => void;
}

export interface RekeyRunner {
  run: () => Promise<RekeyProgress>;
  pause: () => void;
  resume: () => void;
}

export function createRekeyRunner(deps: RekeyRunnerDeps): RekeyRunner {
  let paused = false;
  /** Every lane waiting for a resume; each one needs waking. */
  const waiting: Array<() => void> = [];

  const waitWhilePaused = async (): Promise<void> => {
    if (!paused) return;
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
    return waitWhilePaused();
  };

  /** How the board ended; `failed` after an error or when it kept changing through every attempt. */
  const secure = async (boardId: string, attempt = 1): Promise<BoardOutcome | 'failed'> => {
    let outcome: BoardOutcome;
    try {
      outcome = await deps.rekeyBoard(boardId);
    } catch (error) {
      console.error(`Could not secure board ${boardId}:`, error);
      return 'failed';
    }
    if (outcome !== 'retry') return outcome;
    if (attempt < MAX_ATTEMPTS) return secure(boardId, attempt + 1);
    console.error(`Board ${boardId} kept changing; it stays for the next pass.`);
    return 'failed';
  };

  return {
    async run() {
      const queue = await deps.fetchQueue();
      const progress: RekeyProgress = {
        done: 0,
        total: queue.boards.length,
        failed: 0,
        skipped: queue.skippedPublic,
      };
      deps.onProgress({ ...progress });

      await runPool(queue.boards, BOARD_CONCURRENCY, async (item) => {
        await waitWhilePaused();
        const outcome = await secure(item.boardId);
        progress.done += 1;
        if (outcome === 'failed') progress.failed += 1;
        if (outcome === 'skipped-public') progress.skipped += 1;
        deps.onProgress({ ...progress });
      });

      return progress;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      for (const wake of waiting.splice(0)) wake();
    },
  };
}
