// Compact event-edge recording. Only the moments playerUp flips are stored.
// [t_ms_since_run_start, up]
export type RecordingEvent = [number, boolean];
export type Recording = RecordingEvent[];

export const MAX_RECORDING_EVENTS = 5000;

/** Append an event if it represents an actual change from the last recorded value. */
export function appendEvent(
  recording: Recording,
  t: number,
  up: boolean,
): Recording {
  if (recording.length >= MAX_RECORDING_EVENTS) return recording;
  const last = recording[recording.length - 1];
  if (last && last[1] === up) return recording;
  return [...recording, [Math.max(0, Math.round(t)), up]];
}

/**
 * Validate an untrusted recording payload and return a safe copy.
 *
 * Recordings arrive from storage/network and can be malformed. A recording is
 * valid when every event is a `[timestamp, up]` tuple with a finite number and
 * a boolean, and timestamps are non-decreasing. Any malformed event invalidates
 * the whole recording, which then replays as empty (no ghost). Events beyond
 * `MAX_RECORDING_EVENTS` are dropped rather than treated as an error.
 */
export function normalizeRecording(value: unknown): Recording {
  if (!Array.isArray(value)) return [];
  const events = value.slice(0, MAX_RECORDING_EVENTS);
  const result: Recording = [];
  let previous = -Infinity;
  for (const event of events) {
    if (!Array.isArray(event) || event.length !== 2) return [];
    const [t, up] = event as [unknown, unknown];
    if (typeof t !== "number" || !Number.isFinite(t)) return [];
    if (typeof up !== "boolean") return [];
    if (t < previous) return [];
    previous = t;
    result.push([t, up]);
  }
  return result;
}

/** Resolve which `up` value applies at time t. Returns false if before the first event. */
export function valueAt(recording: Recording, t: number): boolean {
  if (recording.length === 0) return false;
  // Binary search for the largest event with t_event <= t.
  let lo = 0;
  let hi = recording.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (recording[mid][0] <= t) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result === -1 ? false : recording[result][1];
}

export function recordingDurationMs(recording: Recording): number {
  if (recording.length === 0) return 0;
  return recording[recording.length - 1][0];
}
