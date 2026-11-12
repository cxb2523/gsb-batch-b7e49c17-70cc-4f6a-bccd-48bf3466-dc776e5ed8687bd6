/**
 * The re-key worker: a thin shell that receives the unlocked key from the page and runs the queue
 * off the main thread. All requests go through `lib/http.ts`, like everywhere else.
 */

import { getRekeyQueue } from '@/features/workspaces/api';
import { errorMessage } from '@/lib/errors';
import type { RekeyWorkerRequest, RekeyWorkerResponse } from './messages';
import { rekeyBoard } from './rekey-board';
import { createRekeyRunner, type RekeyRunner } from './rekey-runner';

let runner: RekeyRunner | null = null;

const reply = (response: RekeyWorkerResponse) => self.postMessage(response);

async function start(request: Extract<RekeyWorkerRequest, { type: 'start' }>) {
  const { workspaceId, userId, privateKey } = request;
  const context = {
    workspaceRef: workspaceId,
    keyContext: { privateKey, userId, workspaceRef: workspaceId },
  };
  runner = createRekeyRunner({
    fetchQueue: () => getRekeyQueue(workspaceId),
    rekeyBoard: (boardId) => rekeyBoard(boardId, context),
    onProgress: (progress) => reply({ type: 'progress', progress }),
  });

  try {
    reply({ type: 'finished', progress: await runner.run() });
  } catch (error) {
    reply({ type: 'error', message: errorMessage(error) ?? 'Securing boards failed.' });
  } finally {
    runner = null;
  }
}

self.addEventListener('message', (event: MessageEvent<RekeyWorkerRequest>) => {
  const request = event.data;
  switch (request.type) {
    case 'start':
      if (!runner) void start(request);
      break;
    case 'pause':
      runner?.pause();
      break;
    case 'resume':
      runner?.resume();
      break;
  }
});
