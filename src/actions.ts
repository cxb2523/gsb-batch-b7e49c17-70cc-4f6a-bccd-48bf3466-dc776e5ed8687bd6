import type { ActionConfig } from './types';

export interface ActionsConfig {
  entity: string;
  tap_action: ActionConfig;
  hold_action: ActionConfig;
  double_tap_action: ActionConfig;
}

const HOLD_MS = 500;
const DOUBLE_TAP_MS = 250;
const MOVE_LIMIT_PX = 10;

const isSet = (a: ActionConfig | undefined): boolean => !!a && a.action !== 'none';

/** True when any of the three actions does something (card uses it for tabindex and cursor). */
export function isInteractive(cfg: Pick<ActionsConfig, 'tap_action' | 'hold_action' | 'double_tap_action'>): boolean {
  return isSet(cfg.tap_action) || isSet(cfg.hold_action) || isSet(cfg.double_tap_action);
}

/** Wire tap, hold and double-tap gestures on `el` to Home Assistant's `hass-action` event. Returns a detach function. */
export function attachActions(el: HTMLElement, getConfig: () => ActionsConfig): () => void {
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let startX = 0;
  let startY = 0;
  let active = false;
  let held = false;

  const fire = (action: 'tap' | 'hold' | 'double_tap'): void => {
    const config = getConfig();
    const cfg =
      action === 'tap' ? config.tap_action : action === 'hold' ? config.hold_action : config.double_tap_action;
    if (!isSet(cfg)) return;
    el.dispatchEvent(new CustomEvent('hass-action', { bubbles: true, composed: true, detail: { config, action } }));
  };

  const clearHold = (): void => {
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    holdTimer = undefined;
  };

  const onDown = (ev: Event): void => {
    const e = ev as MouseEvent;
    if (e.button > 0) return;
    active = true;
    held = false;
    startX = e.clientX;
    startY = e.clientY;
    clearHold();
    if (isSet(getConfig().hold_action)) {
      holdTimer = setTimeout(() => {
        holdTimer = undefined;
        held = true;
        fire('hold');
      }, HOLD_MS);
    }
  };

  const onMove = (ev: Event): void => {
    if (!active) return;
    const e = ev as MouseEvent;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_LIMIT_PX) {
      clearHold();
      active = false;
    }
  };

  const onCancel = (): void => {
    clearHold();
    active = false;
  };

  const tap = (): void => {
    if (isSet(getConfig().double_tap_action)) {
      if (tapTimer !== undefined) {
        clearTimeout(tapTimer);
        tapTimer = undefined;
        fire('double_tap');
      } else {
        tapTimer = setTimeout(() => {
          tapTimer = undefined;
          fire('tap');
        }, DOUBLE_TAP_MS);
      }
    } else {
      fire('tap');
    }
  };

  const onUp = (): void => {
    const wasActive = active;
    clearHold();
    active = false;
    if (!wasActive || held) {
      held = false;
      return;
    }
    tap();
  };

  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.key === ' ') e.preventDefault();
    fire('tap');
  };

  const onContextMenu = (ev: Event): void => {
    if (isSet(getConfig().hold_action)) ev.preventDefault();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('pointerleave', onCancel);
  el.addEventListener('keydown', onKey);
  el.addEventListener('contextmenu', onContextMenu);

  return () => {
    clearHold();
    if (tapTimer !== undefined) clearTimeout(tapTimer);
    tapTimer = undefined;
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('pointerleave', onCancel);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('contextmenu', onContextMenu);
  };
}
