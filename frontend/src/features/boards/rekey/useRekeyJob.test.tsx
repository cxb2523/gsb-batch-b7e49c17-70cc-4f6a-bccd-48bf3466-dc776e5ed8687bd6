import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { generateSymmetricKey } from '@/lib/crypto';
import { jsonResponse } from '@/test/http';
import type { RekeyWorkerRequest, RekeyWorkerResponse } from './messages';
import { useRekeyJob, type RekeyWorkerHandle } from './useRekeyJob';

const mocks = vi.hoisted(
  (): { session: { data: { user: { id: string } } | null }; privateKey: CryptoKey | null } => ({
    session: { data: { user: { id: 'u1' } } },
    privateKey: null,
  }),
);

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => mocks.session }));
vi.mock('@/context/KeyContext', () => ({
  useKeyContext: () => ({ privateKey: mocks.privateKey }),
}));

const queueWith = (count: number, skippedPublic = 0) => ({
  boards: Array.from({ length: count }, (_, index) => ({
    boardId: `b${index}`,
    projectId: 'p1',
    keyVersion: 1,
    projectKeyVersion: 2,
    revision: 0,
  })),
  skippedPublic,
});

class FakeWorker implements RekeyWorkerHandle {
  readonly sent: RekeyWorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<RekeyWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: RekeyWorkerRequest) {
    this.sent.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  say(response: RekeyWorkerResponse) {
    act(() => this.onmessage?.(new MessageEvent('message', { data: response })));
  }
}

function setup(options: { isAdministrator?: boolean; queue?: ReturnType<typeof queueWith> } = {}) {
  const fetchMock = vi.fn(async () => jsonResponse(options.queue ?? queueWith(2)));
  vi.stubGlobal('fetch', fetchMock);
  const workers: FakeWorker[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = renderHook(
    () =>
      useRekeyJob({
        workspaceId: 'w1',
        isAdministrator: options.isAdministrator ?? true,
        createWorker: () => {
          const worker = new FakeWorker();
          workers.push(worker);
          return worker;
        },
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  return { ...rendered, workers, fetchMock };
}

beforeEach(async () => {
  localStorage.clear();
  mocks.session.data = { user: { id: 'u1' } };
  mocks.privateKey = await generateSymmetricKey();
});

describe('useRekeyJob', () => {
  it('starts the worker with the key once the queue has boards, and shows its progress', async () => {
    const { result, workers } = setup();

    await waitFor(() => expect(workers).toHaveLength(1));
    expect(workers[0]?.sent[0]).toMatchObject({ type: 'start', workspaceId: 'w1', userId: 'u1' });
    expect(result.current.status).toBe('running');

    workers[0]?.say({ type: 'progress', progress: { done: 1, total: 2, failed: 0, skipped: 0 } });
    expect(result.current.progress).toEqual({ done: 1, total: 2, failed: 0, skipped: 0 });

    workers[0]?.say({
      type: 'finished',
      progress: { done: 2, total: 2, failed: 0, skipped: 0 },
    });
    expect(result.current.status).toBe('finished');
    expect(workers[0]?.terminated).toBe(true);
  });

  it('says "All boards secured." once in a toast when a run finishes cleanly', async () => {
    const { workers } = setup();
    await waitFor(() => expect(workers).toHaveLength(1));

    workers[0]?.say({
      type: 'finished',
      progress: { done: 2, total: 2, failed: 0, skipped: 0 },
    });

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('All boards secured.');
  });

  it('does not say it when a board failed, or when there was nothing to secure', async () => {
    const { workers } = setup();
    await waitFor(() => expect(workers).toHaveLength(1));

    workers[0]?.say({
      type: 'finished',
      progress: { done: 2, total: 2, failed: 1, skipped: 0 },
    });
    expect(toast.success).not.toHaveBeenCalled();

    act(() => workers[0]?.onerror?.(new ErrorEvent('error')));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('never asks the server for the queue, or starts, for a non-administrator', async () => {
    const { workers, fetchMock } = setup({ isAdministrator: false });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
  });

  it('does not start for an empty queue and reports public-link boards', async () => {
    const { result, workers } = setup({ queue: queueWith(0, 3) });

    await waitFor(() => expect(result.current.skippedPublic).toBe(3));
    expect(workers).toHaveLength(0);
    expect(result.current.status).toBe('idle');
  });

  it('pauses and resumes the running worker, and remembers a pause on this device', async () => {
    const { result, workers } = setup();
    await waitFor(() => expect(workers).toHaveLength(1));

    act(() => result.current.pause());
    expect(workers[0]?.sent.at(-1)).toEqual({ type: 'pause' });
    expect(result.current.status).toBe('paused');
    expect(localStorage.getItem('canvhq:rekey-paused:w1')).toBe('1');

    act(() => result.current.resume());
    expect(workers[0]?.sent.at(-1)).toEqual({ type: 'resume' });
    expect(result.current.status).toBe('running');
    expect(localStorage.getItem('canvhq:rekey-paused:w1')).toBeNull();
  });

  it('stays paused on a later visit until the administrator resumes', async () => {
    localStorage.setItem('canvhq:rekey-paused:w1', '1');
    const { result, workers } = setup();

    await waitFor(() => expect(result.current.status).toBe('paused'));
    expect(workers).toHaveLength(0);

    act(() => result.current.resume());
    expect(workers).toHaveLength(1);
    expect(result.current.status).toBe('running');
  });

  it('shows a failure with Retry, and retry starts a fresh worker', async () => {
    const { result, workers } = setup();
    await waitFor(() => expect(workers).toHaveLength(1));

    workers[0]?.say({
      type: 'finished',
      progress: { done: 2, total: 2, failed: 1, skipped: 0 },
    });
    expect(result.current.status).toBe('failed');

    act(() => result.current.retry());
    expect(workers).toHaveLength(2);
    expect(result.current.status).toBe('running');
  });

  it('treats a worker error as a failed run', async () => {
    const { result, workers } = setup();
    await waitFor(() => expect(workers).toHaveLength(1));

    workers[0]?.say({ type: 'error', message: 'boom' });

    expect(result.current.status).toBe('failed');
    expect(workers[0]?.terminated).toBe(true);
  });

  it('stops the worker when the page goes away', async () => {
    const { workers, unmount } = setup();
    await waitFor(() => expect(workers).toHaveLength(1));

    unmount();

    expect(workers[0]?.terminated).toBe(true);
  });
});
