import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from './date';

describe('formatRelativeTime utility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles empty or invalid dates gracefully', () => {
    expect(formatRelativeTime('')).toBe('Recently');
    expect(formatRelativeTime('not-a-valid-date')).toBe('Recently');
  });

  it("formats recent seconds as 'Just now'", () => {
    const recent = new Date('2026-10-17T11:59:40Z');
    expect(formatRelativeTime(recent)).toBe('Just now');
  });

  it('formats minutes ago', () => {
    const fiveMinutesAgo = new Date('2026-10-17T11:55:00Z');
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    const threeHoursAgo = new Date('2026-10-17T09:00:00Z');
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
  });

  it('formats days ago', () => {
    const twoDaysAgo = new Date('2026-10-15T12:00:00Z');
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago');
  });

  it('formats dates over 30 days ago with month and day', () => {
    const twoMonthsAgo = new Date('2026-08-17T12:00:00Z');
    expect(formatRelativeTime(twoMonthsAgo)).toBe('Aug 17');
  });
});
