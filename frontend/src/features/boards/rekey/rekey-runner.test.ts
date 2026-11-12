import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RekeyQueue } from '@/features/workspaces/schemas';
import type { BoardOutcome } from './rekey-board';
import { createRekeyRunner, type RekeyProgress } from './rekey-runner';

const queueOf = (ids: string[], skippedPublic = 0): RekeyQueue => ({
  boards: ids.map((boardId) => ({
    boardId,
    projectId: 'p1',
    keyVersion: 1,
    projectKeyVersion: 2,
    revision: 0,
  })),
  skippedPublic,
});

describe('createRekeyRunner', () => {
  let progress: RekeyProgress[];
  let outcomes: Record<string, (BoardOutcome | Error)[]>;
  let attempts: Record<string, number>;
  let fetchQueue: ReturnType<typeof vi.fn<() => Promise<RekeyQueue>>>;

  const runner = () =>
    createRekeyRunner({
      fetchQueue,
      rekeyBoard: async (boardId) => {
        attempts[boardId] = (attempts[boardId] ?? 0) + 1;
        const next = outcomes[boardId]?.shift() ?? 'secured';
        if (next instanceof Error) throw next;
        return next;
      },
      onProgress: (p) => progress.push(p),
    });

  beforeEach(() => {
    progress = [];
    outcomes = {};
    attempts = {};
    fetchQueue = vi.fn(async () => queueOf(['a', 'b', 'c']));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('secures every board and fixes the total when it starts', async () => {
    const result = await runner().run();

    expect(result).toEqual({ done: 3, total: 3, failed: 0, skipped: 0 });
    expect(progress[0]).toEqual({ done: 0, total: 3, failed: 0, skipped: 0 });
    expect(fetchQueue).toHaveBeenCalledTimes(1);
  });

  it('redoes a board that changed underneath', async () => {
    outcomes.a = ['retry', 'secured'];

    const result = await runner().run();

    expect(attempts.a).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('gives up on a board that keeps changing after three attempts', async () => {
    outcomes.a = ['retry', 'retry', 'retry', 'secured'];

    const result = await runner().run();

    expect(attempts.a).toBe(3);
    expect(result).toMatchObject({ done: 3, failed: 1 });
  });

  it('carries on past a board that fails', async () => {
    outcomes.b = [new Error('cannot decrypt')];

    const result = await runner().run();

    expect(result).toEqual({ done: 3, total: 3, failed: 1, skipped: 0 });
    expect(attempts.c).toBe(1);
  });

  it('counts public-link boards, from the queue and from the server turning one down', async () => {
    fetchQueue.mockResolvedValue(queueOf(['a', 'b'], 2));
    outcomes.a = ['skipped-public'];

    const result = await runner().run();

    expect(result).toMatchObject({ total: 2, skipped: 3, failed: 0 });
  });

  it('does not start another board while paused, and continues on resume', async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const firstDone = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paused = createRekeyRunner({
      fetchQueue: async () => queueOf(['a', 'b', 'c', 'd']),
      rekeyBoard: async (boardId) => {
        started.push(boardId);
        // Both lanes are busy until the test has paused the runner.
        if (boardId === 'a' || boardId === 'b') await firstDone;
        return 'secured';
      },
      onProgress: () => {},
    });

    const running = paused.run();
    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    paused.pause();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual(['a', 'b']);

    paused.resume();
    expect((await running).done).toBe(4);
  });
});
