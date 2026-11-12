// Keyboard, mouse-look and gamepad. Keys are read by physical position
// (event.code), so the layout works the same on AZERTY and QWERTY.
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class Input {
  constructor(el) {
    this.keys = new Set();
    this.pressed = [];          // one-shot key presses since the last frame
    this.look = { yaw: 0, pitch: 0 };
    this.zoom = 0;
    this.dragging = false;
    this.yoke = { pitch: 0, roll: 0, yaw: 0 };
    this.autoRudder = true;
    this.bias = 0;              // stick the pilot is holding because the trim has run out of travel
    this.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.metaKey || e.ctrlKey) return;
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerdown', (e) => { this.dragging = true; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', () => { this.dragging = false; });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.look.yaw -= e.movementX * 0.0042;
      this.look.pitch = clamp(this.look.pitch - e.movementY * 0.0042, -1.35, 1.35);
    });
    el.addEventListener('dblclick', () => { this.look.yaw = 0; this.look.pitch = 0; this.zoom = 0; });
    el.addEventListener('wheel', (e) => { this.zoom = clamp(this.zoom + e.deltaY * 0.0012, -1, 1); e.preventDefault(); }, { passive: false });
  }
  take() { const p = this.pressed; this.pressed = []; return p; }

  // Fly the controls. Held keys move the yoke at a human rate and it springs
  // back; travel shrinks as dynamic pressure builds, the way stick force does.
  apply(dt, fm, apOn) {
    const k = this.keys, c = fm.ctl, o = fm.out;
    const pad = this.gamepad();
    const q = Math.max(0.2, Math.min(1, Math.pow(31 / Math.max(o.ias, 1), 1.6)));
    const move = (cur, target, up, down) => {
      const rate = (Math.abs(target) > Math.abs(cur) || target * cur < 0 ? up : down) * dt;
      return cur + clamp(target - cur, -rate, rate);
    };
    const pitchKey = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
    const rollKey = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    const yawKey = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const y = this.yoke;
    y.pitch = move(y.pitch, pitchKey * q, 1.5, 3.0);
    y.roll = move(y.roll, rollKey * Math.max(q, 0.45), 2.6, 4.0);
    y.yaw = move(y.yaw, yawKey, 2.2, 3.5);
    this.manual = pitchKey !== 0 || rollKey !== 0 || Math.abs(pad.pitch) > 0.08 || Math.abs(pad.roll) > 0.08;
    if (!apOn) {
      c.pitch = clamp(y.pitch + pad.pitch + this.bias, -1, 1);
      // Keys cannot hold the small steady pressure a hand does. With the roll keys released,
      // lean on the yoke just enough to stop the aircraft rolling: it stays at the bank you left it.
      if (this.autoRudder && !o.onGround && rollKey === 0 && Math.abs(pad.roll) < 0.05) this.ailI = clamp((this.ailI || 0) - 0.5 * fm.w[0] * dt, -0.3, 0.3);
      else if (o.onGround) this.ailI = 0;
      c.roll = clamp(y.roll + pad.roll + (this.autoRudder && !o.onGround ? this.ailI || 0 : 0), -1, 1);
      let yaw = y.yaw + pad.yaw;
      // feet on the pedals for you in the air: keep the ball centred
      if (this.autoRudder && !o.onGround && yawKey === 0 && Math.abs(pad.yaw) < 0.05) {
        // like real feet: keep adding pedal until the ball is centred, whatever the power setting
        this.rudI = clamp((this.rudI || 0) + 1.6 * o.beta * dt, -0.6, 0.6);
        yaw += clamp(2.2 * o.beta - 0.25 * fm.w[2] + this.rudI, -0.8, 0.8);
      } else if (o.onGround) this.rudI = 0;
      c.yaw = clamp(yaw, -1, 1);
    } else if (o.onGround) {
      c.yaw = clamp(y.yaw + pad.yaw, -1, 1);
    }
    if (pad.throttle !== null) c.throttle = pad.throttle;
    if (k.has('KeyW')) c.throttle = clamp(c.throttle + 0.45 * dt, 0, 1);
    if (k.has('KeyS')) c.throttle = clamp(c.throttle - 0.45 * dt, 0, 1);
    if (k.has('KeyM')) c.mixture = clamp(c.mixture + 0.35 * dt, 0, 1);
    if (k.has('KeyN')) c.mixture = clamp(c.mixture - 0.35 * dt, 0, 1);
    if (k.has('BracketRight') || k.has('KeyK')) c.trim = clamp(c.trim + 0.12 * dt, -1, 1);
    if (k.has('BracketLeft') || k.has('KeyI')) c.trim = clamp(c.trim - 0.12 * dt, -1, 1);
    const brake = k.has('Space') ? 1 : pad.brake;
    c.brakeL = brake; c.brakeR = brake;
  }
  gamepad() {
    const out = { pitch: 0, roll: 0, yaw: 0, throttle: null, brake: 0 };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of pads) {
      if (!g || !g.connected || g.axes.length < 2) continue;
      const dz = (v) => (Math.abs(v) < 0.06 ? 0 : v);
      out.roll = dz(g.axes[0]); out.pitch = dz(g.axes[1]);
      if (g.axes.length > 2) out.yaw = dz(g.axes[2]);
      if (g.mapping !== 'standard' && g.axes.length > 3) out.throttle = clamp((1 - g.axes[3]) / 2, 0, 1);
      if (g.buttons[0]) out.brake = g.buttons[0].value;
      break;
    }
    return out;
  }
}
