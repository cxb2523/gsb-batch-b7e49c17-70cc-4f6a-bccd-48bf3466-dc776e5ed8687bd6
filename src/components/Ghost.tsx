import { useEffect, useMemo, useRef, useState } from "react";
import cx from "classnames";
import Alien from "../images/alien.png";
import { type Recording, normalizeRecording, valueAt } from "../game/recording";

type Props = {
  recording: Recording;
  /** Toggles to a new identity each time a fresh playthrough begins, restarting the replay clock. */
  runId: string | number;
  /** Only animate while the live game is active. */
  active: boolean;
  windowHeight: number;
};

export const Ghost = ({ recording, runId, active, windowHeight }: Props) => {
  const [up, setUp] = useState(false);
  const startRef = useRef<number | null>(null);
  // `recording` comes from persisted/remote data, so never trust its shape.
  const safeRecording = useMemo(
    () => normalizeRecording(recording),
    [recording],
  );

  useEffect(() => {
    setUp(false);
    startRef.current = null;
    if (!active || safeRecording.length === 0) return;

    let raf = 0;
    startRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - (startRef.current ?? 0);
      setUp(valueAt(safeRecording, elapsed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [safeRecording, runId, active]);

  if (!active || safeRecording.length === 0) return null;

  const transform = up
    ? `translateY(${windowHeight * -1}px)`
    : `translateY(${windowHeight * 2}px)`;

  return (
    <div
      aria-hidden
      className="fixed left-1/4 top-1/2 -mt-8 w-16 h-16 ease-in will-change-transform pointer-events-none opacity-40"
      style={{
        transform,
        transitionDuration: "2000ms",
        transitionProperty: "transform",
        filter: "hue-rotate(120deg) saturate(2)",
      }}
    >
      <div className={cx("duration-0 transition-transform")}>
        <img src={Alien} alt="" />
      </div>
    </div>
  );
};
