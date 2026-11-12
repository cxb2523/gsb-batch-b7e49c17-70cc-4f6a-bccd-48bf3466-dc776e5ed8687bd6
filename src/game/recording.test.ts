import { describe, expect, it } from "vitest";
import {
  appendEvent,
  MAX_RECORDING_EVENTS,
  normalizeRecording,
  recordingDurationMs,
  valueAt,
  type Recording,
} from "./recording";

describe("recording", () => {
  it("appends edges only when the value actually changes", () => {
    let r: Recording = [];
    r = appendEvent(r, 0, false);
    r = appendEvent(r, 100, false);
    r = appendEvent(r, 200, true);
    r = appendEvent(r, 300, true);
    r = appendEvent(r, 400, false);
    expect(r).toEqual([
      [0, false],
      [200, true],
      [400, false],
    ]);
  });

  it("rounds and clamps timestamps", () => {
    let r: Recording = [];
    r = appendEvent(r, -5, false);
    r = appendEvent(r, 12.7, true);
    expect(r).toEqual([
      [0, false],
      [13, true],
    ]);
  });

  it("resolves the right value at a given time", () => {
    const r: Recording = [
      [0, false],
      [100, true],
      [250, false],
      [400, true],
    ];
    expect(valueAt(r, 0)).toBe(false);
    expect(valueAt(r, 50)).toBe(false);
    expect(valueAt(r, 100)).toBe(true);
    expect(valueAt(r, 200)).toBe(true);
    expect(valueAt(r, 250)).toBe(false);
    expect(valueAt(r, 999)).toBe(true);
  });

  it("returns false before the first event", () => {
    const r: Recording = [
      [100, true],
      [200, false],
    ];
    expect(valueAt(r, 0)).toBe(false);
    expect(valueAt(r, 99)).toBe(false);
    expect(valueAt(r, 100)).toBe(true);
  });

  it("returns false on an empty recording", () => {
    expect(valueAt([], 0)).toBe(false);
    expect(valueAt([], 9999)).toBe(false);
    expect(recordingDurationMs([])).toBe(0);
  });

  it("reports the duration as the last event's timestamp", () => {
    expect(
      recordingDurationMs([
        [0, false],
        [500, true],
        [1234, false],
      ]),
    ).toBe(1234);
  });
});

describe("normalizeRecording", () => {
  it("keeps a valid recording as-is", () => {
    const recording: Recording = [
      [0, false],
      [120, true],
      [400, false],
      [900, true],
    ];
    expect(normalizeRecording(recording)).toEqual(recording);
  });

  it("treats an empty recording as valid but has nothing to replay", () => {
    expect(normalizeRecording([])).toEqual([]);
  });

  it("rejects out-of-order timestamps", () => {
    expect(
      normalizeRecording([
        [0, false],
        [200, true],
        [100, false],
      ]),
    ).toEqual([]);
  });

  it("rejects non-finite timestamps", () => {
    expect(normalizeRecording([[0, false], [NaN, true]])).toEqual([]);
    expect(normalizeRecording([[0, false], [Infinity, true]])).toEqual([]);
    expect(normalizeRecording([[0, false], [-Infinity, true]])).toEqual([]);
  });

  it("rejects values that are not boolean states", () => {
    expect(normalizeRecording([[0, false], [100, 1]])).toEqual([]);
    expect(normalizeRecording([[0, false], [100, "true"]])).toEqual([]);
    expect(normalizeRecording([[0, false], [100, null]])).toEqual([]);
  });

  it("rejects malformed events and non-array payloads", () => {
    expect(normalizeRecording([[0]])).toEqual([]);
    expect(normalizeRecording([[0, false, true]])).toEqual([]);
    expect(normalizeRecording([0, false])).toEqual([]);
    expect(normalizeRecording([[0, false], null])).toEqual([]);
    expect(normalizeRecording(null)).toEqual([]);
    expect(normalizeRecording({ events: [] })).toEqual([]);
    expect(normalizeRecording("recording")).toEqual([]);
  });

  it("drops events beyond the cap instead of erroring", () => {
    const tooLong = Array.from(
      { length: MAX_RECORDING_EVENTS + 10 },
      (_, i) => [i, i % 2 === 0] as [number, boolean],
    );
    const normalized = normalizeRecording(tooLong);
    expect(normalized).toHaveLength(MAX_RECORDING_EVENTS);
    expect(normalized[0]).toEqual([0, true]);
    expect(normalized[normalized.length - 1]).toEqual([
      MAX_RECORDING_EVENTS - 1,
      (MAX_RECORDING_EVENTS - 1) % 2 === 0,
    ]);
  });

  it("accepts repeated timestamps produced by rounding", () => {
    const recording: Recording = [
      [0, false],
      [10, true],
      [10, false],
    ];
    expect(normalizeRecording(recording)).toEqual(recording);
  });
});
