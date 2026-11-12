import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Recording } from "../game/recording";
import { Ghost } from "./Ghost";

const WINDOW_HEIGHT = 800;

let now = 0;
let nextFrameId = 1;
let pendingFrames = new Map<number, FrameRequestCallback>();

const runNextFrame = (time: number) => {
  now = time;
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  act(() => {
    callbacks.forEach((callback) => callback(now));
  });
};

const ghostTransform = (container: HTMLElement): string | null => {
  const ghost = container.firstElementChild as HTMLElement | null;
  return ghost?.style.transform ?? null;
};

describe("Ghost", () => {
  beforeEach(() => {
    now = 0;
    nextFrameId = 1;
    pendingFrames = new Map();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      pendingFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("replays the recording as the clock advances", () => {
    const recording: Recording = [
      [0, false],
      [100, true],
      [250, false],
    ];
    const { container } = render(
      <Ghost
        recording={recording}
        runId="run-1"
        active
        windowHeight={WINDOW_HEIGHT}
      />,
    );

    // Before the first frame the ghost is in its resting (down) position.
    expect(ghostTransform(container)).toBe(
      `translateY(${WINDOW_HEIGHT * 2}px)`,
    );

    runNextFrame(50);
    expect(ghostTransform(container)).toBe(
      `translateY(${WINDOW_HEIGHT * 2}px)`,
    );

    runNextFrame(150);
    expect(ghostTransform(container)).toBe(
      `translateY(${WINDOW_HEIGHT * -1}px)`,
    );

    runNextFrame(300);
    expect(ghostTransform(container)).toBe(
      `translateY(${WINDOW_HEIGHT * 2}px)`,
    );
  });

  it("renders nothing for an empty recording", () => {
    const { container } = render(
      <Ghost recording={[]} runId="run-1" active windowHeight={WINDOW_HEIGHT} />,
    );
    expect(container.firstElementChild).toBeNull();
  });

  it("renders nothing and never throws for malformed recordings", () => {
    const malformed = [
      [
        [0, false],
        [100, true],
        [50, false],
      ],
      [
        [0, false],
        [NaN, true],
      ],
      [
        [0, false],
        [100, 1],
      ],
      [[0], [100, true]],
      [[0, false], null],
      null,
    ] as unknown as Recording[];
    for (const recording of malformed) {
      const { container } = render(
        <Ghost
          recording={recording}
          runId="run-1"
          active
          windowHeight={WINDOW_HEIGHT}
        />,
      );
      expect(container.firstElementChild).toBeNull();
      cleanup();
    }
  });

  it("restarts the replay when runId changes", () => {
    const recording: Recording = [
      [0, false],
      [300, true],
    ];
    const view = render(
      <Ghost
        recording={recording}
        runId="run-1"
        active
        windowHeight={WINDOW_HEIGHT}
      />,
    );

    runNextFrame(500);
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * -1}px)`,
    );

    // A fresh playthrough resets the clock even though the recording is old.
    view.rerender(
      <Ghost
        recording={recording}
        runId="run-2"
        active
        windowHeight={WINDOW_HEIGHT}
      />,
    );
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * 2}px)`,
    );

    runNextFrame(600);
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * 2}px)`,
    );

    runNextFrame(900);
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * -1}px)`,
    );
  });

  it("restarts the replay when play becomes active again", () => {
    const recording: Recording = [
      [0, false],
      [300, true],
    ];
    const props = { recording, runId: "run-1", windowHeight: WINDOW_HEIGHT };
    const view = render(<Ghost {...props} active />);

    runNextFrame(500);
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * -1}px)`,
    );

    view.rerender(<Ghost {...props} active={false} />);
    expect(ghostTransform(view.container)).toBeNull();

    view.rerender(<Ghost {...props} active />);
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * 2}px)`,
    );

    runNextFrame(600);
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * 2}px)`,
    );
    runNextFrame(900);
    expect(ghostTransform(view.container)).toBe(
      `translateY(${WINDOW_HEIGHT * -1}px)`,
    );
  });
});
