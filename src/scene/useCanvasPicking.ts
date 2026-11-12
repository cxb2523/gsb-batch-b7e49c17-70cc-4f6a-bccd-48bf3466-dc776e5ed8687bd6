import { useEffect, useRef } from "react";
import {
  createCameraInteraction,
  resolveMiss,
  type CameraInteraction,
} from "../lib/picking";

export interface CanvasPicking {
  /** shared with <Buildings> and the camera rig */
  interaction: React.MutableRefObject<CameraInteraction>;
  /** spread onto <Canvas>; the props land on its root div */
  canvasProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onWheel: () => void;
    onPointerMissed: (e: MouseEvent) => void;
  };
}

/**
 * Tracks the press/drag/wheel state of the canvas so both the instanced
 * buildings (did this release tap a tower?) and the blank-space handler
 * (did this release mean "deselect"?) apply the same rules.
 */
export function useCanvasPicking(onBlankClick: () => void): CanvasPicking {
  const interaction = useRef<CameraInteraction>(createCameraInteraction());
  const missPress = useRef<{ x: number; y: number; at: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const blankClick = useRef(onBlankClick);
  blankClick.current = onBlankClick;

  // a press that ends outside the canvas still ends — otherwise the camera
  // would stay frozen for the next visitor holding no button at all
  useEffect(() => {
    const release = () => {
      interaction.current.pressing = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  return {
    interaction,
    canvasProps: {
      onPointerDown: (e) => {
        const ix = interaction.current;
        ix.pressing = true;
        ix.travel = 0;
        last.current = { x: e.clientX, y: e.clientY };
        missPress.current = { x: e.clientX, y: e.clientY, at: performance.now() };
      },
      onPointerMove: (e) => {
        const ix = interaction.current;
        const prev = last.current;
        if (!ix.pressing || !prev) return;
        ix.travel += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
        last.current = { x: e.clientX, y: e.clientY };
      },
      onWheel: () => {
        interaction.current.wheelAt = performance.now();
      },
      onPointerMissed: (e) => {
        const p = missPress.current;
        missPress.current = null;
        if (resolveMiss(p, { x: e.clientX, y: e.clientY }, interaction.current)) {
          blankClick.current();
        }
      },
    },
  };
}
