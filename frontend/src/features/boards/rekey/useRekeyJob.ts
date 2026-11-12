import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { useKeyContext } from '@/context/KeyContext';
import { workspaceKeys } from '@/features/workspaces/keys';
import { useRekeyQueue } from '@/features/workspaces/queries';
import type { RekeyWorkerRequest, RekeyWorkerResponse } from './messages';
import type { RekeyProgress } from './rekey-runner';

export type RekeyStatus = 'idle' | 'running' | 'paused' | 'finished' | 'failed';

export interface RekeyJob {
  status: RekeyStatus;
  /** Progress of the current or last run; null before the first run starts. */
  progress: RekeyProgress | null;
  /** Boards with a public link, which keep their key. */
  skippedPublic: number;
  pause: () => void;
  resume: () => void;
  /** Starts a new run, for a failed one. */
  retry: () => void;
}

/** What the hook needs from a worker, so a test can stand in for the real one. */
export interface RekeyWorkerHandle {
  postMessage: (request: RekeyWorkerRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<RekeyWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export function createRekeyWorker(): RekeyWorkerHandle {
  return new Worker(new URL('./rekey.worker.ts', import.meta.url), { type: 'module' });
}

const pausedKey = (workspaceId: string) => `canvhq:rekey-paused:${workspaceId}`;

function readPaused(workspaceId: string): boolean {
  try {
    return localStorage.getItem(pausedKey(workspaceId)) === '1';
  } catch {
    // Storage can be blocked; the job then simply is not remembered as paused.
    return false;
  }
}

function writePaused(workspaceId: string, paused: boolean): void {
  try {
    if (paused) localStorage.setItem(pausedKey(workspaceId), '1');
    else localStorage.removeItem(pausedKey(workspaceId));
  } catch {
    // Same as above: pausing still works for this page, it just is not remembered.
  }
}

/**
 * Moves every board of a workspace to its project's current key in a worker, once per visit and
 * only for administrators. The server derives the queue, so any administrator can pick it up; a
 * pause is remembered on this device. Failed boards stay in the queue for the next visit.
 */
export function useRekeyJob({
  workspaceId,
  isAdministrator,
  createWorker = createRekeyWorker,
}: {
  workspaceId: string | undefined;
  isAdministrator: boolean;
  createWorker?: () => RekeyWorkerHandle;
}): RekeyJob {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { privateKey } = useKeyContext();
  const userId = session?.user?.id;
  const queue = useRekeyQueue(workspaceId, isAdministrator).data;
  const queued = queue?.boards.length ?? 0;

  const [phase, setPhase] = useState<'idle' | 'running' | 'finished' | 'failed'>('idle');
  const [progress, setProgress] = useState<RekeyProgress | null>(null);
  const [pausedChoice, setPausedChoice] = useState<Record<string, boolean>>({});
  const paused = workspaceId ? (pausedChoice[workspaceId] ?? readPaused(workspaceId)) : false;

  const workerRef = useRef<RekeyWorkerHandle | null>(null);
  const attemptedFor = useRef<string | null>(null);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (!workspaceId || !userId || !privateKey || workerRef.current) return;
    const worker = createWorker();
    workerRef.current = worker;
    setPhase('running');
    setProgress(null);

    const finish = (next: 'finished' | 'failed') => {
      stopWorker();
      setPhase(next);
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.rekeyQueue(workspaceId) });
    };
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'progress') setProgress(message.progress);
      else if (message.type === 'finished') {
        setProgress(message.progress);
        finish(message.progress.failed > 0 ? 'failed' : 'finished');
        // Said once, to the person whose browser did the work; a run with nothing to do stays quiet.
        if (message.progress.failed === 0 && message.progress.total > 0) {
          toast.success('All boards secured.');
        }
      } else finish('failed');
    };
    worker.onerror = () => finish('failed');
    worker.postMessage({ type: 'start', workspaceId, userId, privateKey });
  }, [workspaceId, userId, privateKey, createWorker, stopWorker, queryClient]);

  useEffect(() => {
    if (!isAdministrator || queued === 0 || paused || !workspaceId) return;
    if (attemptedFor.current === workspaceId) return;
    attemptedFor.current = workspaceId;
    start();
  }, [isAdministrator, queued, paused, workspaceId, start]);

  useEffect(
    () => () => {
      stopWorker();
      attemptedFor.current = null;
    },
    [stopWorker],
  );

  const setPaused = (value: boolean) => {
    if (!workspaceId) return;
    writePaused(workspaceId, value);
    setPausedChoice((choices) => ({ ...choices, [workspaceId]: value }));
  };

  const pause = () => {
    setPaused(true);
    workerRef.current?.postMessage({ type: 'pause' });
  };

  const resume = () => {
    setPaused(false);
    if (workerRef.current) workerRef.current.postMessage({ type: 'resume' });
    else start();
  };

  const status: RekeyStatus = paused && (phase === 'running' || queued > 0) ? 'paused' : phase;

  return {
    status,
    progress,
    skippedPublic: queue?.skippedPublic ?? 0,
    pause,
    resume,
    retry: start,
  };
}
