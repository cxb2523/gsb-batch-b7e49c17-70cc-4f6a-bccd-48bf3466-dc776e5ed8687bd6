import { useEffect, type RefObject } from "react";

// Closes a dropdown on any pointerdown outside `ref` while it is open.
// Takes the state setter itself (stable) so the listener isn't re-added every render.
export function useCloseOnOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ref, open, setOpen]);
}
