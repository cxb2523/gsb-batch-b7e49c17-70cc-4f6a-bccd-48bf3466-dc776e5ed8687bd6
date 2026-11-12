import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { memberKeys } from '@/features/members/keys';
import { projectKeys } from '@/features/projects/keys';
import { workspaceKeys } from '@/features/workspaces/keys';
import { notificationKeys } from '../keys';
import { useNotificationStream } from './useNotificationStream';

/** Just enough of the browser's EventSource to open one, send it events and see it closed. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly init: EventSourceInit | undefined;
  readonly listeners = new Map<string, Array<() => void>>();
  closed = false;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe('useNotificationStream', () => {
  let queryClient: QueryClient;
  let invalidate: MockInstance<QueryClient['invalidateQueries']>;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens one stream to the notifications route with the session cookie', () => {
    renderHook(() => useNotificationStream(true), { wrapper });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toMatch(/\/api\/notifications\/stream$/);
    expect(FakeEventSource.instances[0]?.init).toEqual({ withCredentials: true });
  });

  it('opens nothing while nobody is signed in', () => {
    renderHook(() => useNotificationStream(false), { wrapper });

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('opens nothing in a browser without EventSource, and does not fail', () => {
    vi.stubGlobal('EventSource', undefined);

    expect(() => renderHook(() => useNotificationStream(true), { wrapper })).not.toThrow();
  });

  it('reads the inbox, and what the change may have touched, again when the server says something changed', () => {
    renderHook(() => useNotificationStream(true), { wrapper });

    FakeEventSource.instances[0]?.emit('changed');

    const refreshed = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(refreshed).toEqual([
      notificationKeys.all,
      workspaceKeys.all,
      workspaceKeys.accessAll,
      projectKeys.root,
      memberKeys.root,
    ]);
  });

  it('reads again after a reconnect, but not when it first connects', () => {
    renderHook(() => useNotificationStream(true), { wrapper });
    const source = FakeEventSource.instances[0];

    source?.emit('ready');
    expect(invalidate).not.toHaveBeenCalled();

    // The browser reconnected by itself; what happened in between was missed.
    source?.emit('ready');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectKeys.root });
  });

  it('closes the stream when the person signs out or the page goes away', () => {
    const { rerender, unmount } = renderHook(({ on }) => useNotificationStream(on), {
      wrapper,
      initialProps: { on: true },
    });
    const first = FakeEventSource.instances[0];

    rerender({ on: false });
    expect(first?.closed).toBe(true);

    rerender({ on: true });
    const second = FakeEventSource.instances[1];
    expect(second?.closed).toBe(false);
    unmount();
    expect(second?.closed).toBe(true);
  });
});
