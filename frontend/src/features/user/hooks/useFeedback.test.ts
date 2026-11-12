import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFeedback } from './useFeedback';

describe('useFeedback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fades a success message but keeps an error until cleared', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedback());

    act(() => result.current.showSuccess('Saved'));
    expect(result.current.feedback).toEqual({ tone: 'success', message: 'Saved' });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.feedback).toBeNull();

    act(() => result.current.showError('Nope'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.feedback).toEqual({ tone: 'error', message: 'Nope' });

    act(() => result.current.clear());
    expect(result.current.feedback).toBeNull();
  });

  it('does not let an earlier success timer wipe a later error', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFeedback());

    act(() => result.current.showSuccess('Saved'));
    act(() => result.current.showError('Then it failed'));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.feedback?.message).toBe('Then it failed');
  });
});
