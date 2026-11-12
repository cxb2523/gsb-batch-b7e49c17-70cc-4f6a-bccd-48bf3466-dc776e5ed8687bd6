// Boot order, builds G, starts the loop. Every module is wired here via MODULES; a factory that
// throws is replaced by its stub (core/stubs.js) so one broken module never stops the rest.
import { Scene, PerspectiveCamera } from 'three';
import './ui/ui.css';
import { parseParams } from './core/params.js';
import { createRng } from './core/rng.js';
import { createEvents } from './core/events.js';
import { createLoop } from './core/loop.js';
import { installErrorCapture, installHarness, stageShotFromParams } from './core/harness.js';
import { stubs } from './core/stubs.js';
import { createQuality } from './render/quality.js';
import { createRenderer } from './render/renderer.js';
import { createLights } from './render/lights.js';
import { createSky } from './render/sky.js';
import { createPost } from './render/post/chain.js';
import { createMats } from './mats/surface.js';
import { createLevel } from './level/world.js';
import { createNav } from './nav/flowfield.js';
import { createInput } from './player/input.js';
import { createPlayer } from './player/controller.js';
import { createWeapon } from './weapon/firing.js';
import { createZombies } from './zombie/manager.js';
import { createFx } from './fx/particles.js';
import { createAudio } from './audio/engine.js';
import { createGame } from './game/state.js';
import { createUi } from './ui/hud.js';
import { createDevice } from './core/device.js';
import { createHints } from './ui/hints.js';
import { createLaunch } from './ui/launch.js';
import { createGore } from './zombie/gore.js';

// Build order (dependencies first). The runtime update order is LOOP_ORDER in core/loop.js.
const MODULES = [
  ['device', createDevice],
  ['quality', createQuality], ['renderer', createRenderer], ['lights', createLights], ['sky', createSky],
  ['mats', createMats], ['post', createPost], ['level', createLevel], ['nav', createNav],
  ['input', createInput], ['player', createPlayer], ['weapon', createWeapon], ['zombies', createZombies],
  ['fx', createFx], ['audio', createAudio], ['game', createGame], ['ui', createUi],
  // gore is wired here, once (createGore is idempotent on G.gore), rather than by the first
  // animator reaching for globalThis.__G; it has no update of its own (the animators drive it)
  ['gore', createGore],
  ['hints', createHints], ['launch', createLaunch],
];

const pushError = installErrorCapture();
const raf = () => new Promise((r) => requestAnimationFrame(r));

// No renderer or no post chain: nothing can be drawn. Say so instead of leaving a black page
// (the renderer shows its own message when WebGL2 is missing; this covers every other failure).
function showRenderFailure() {
  if (document.getElementById('gfx-unsupported') || document.getElementById('gfx-failed')) return;
  const el = document.createElement('div');
  el.id = 'gfx-failed';
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;'
    + 'gap:14px;padding:24px;text-align:center;background:#05070a;color:#ece6d6;font:16px/1.5 Overpass,"Helvetica Neue","Segoe UI",Roboto,Arial,sans-serif;';
  const h = document.createElement('div');
  h.textContent = 'The game could not start its graphics';
  h.style.cssText = 'font-size:22px;font-weight:600;color:#ff4a3d;';
  const d = document.createElement('div');
  d.textContent = 'Something went wrong while setting up rendering. Reloading the page usually fixes it; if not, try a current version of Chrome with hardware acceleration turned on.';
  d.style.cssText = 'max-width:520px;color:#a3a49b;';
  el.append(h, d);
  document.body.appendChild(el);
}

function setBoot(frac, label) {
  const bar = document.getElementById('boot-bar');
  if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
  const l = document.getElementById('boot-label');
  if (l && label) l.textContent = label;
}

async function boot() {
  const params = parseParams(window.location.search);
  const events = createEvents((e, name) => pushError(`[events] ${name} handler: ${e && e.message}`));
  const rng = createRng(params.seed ?? 1);
  const G = {
    params, events, rng,
    time: { t: 0, dt: 0, frame: 0, real: 0 },
    scene: new Scene(),
    camera: new PerspectiveCamera(params.fov ?? 70, window.innerWidth / window.innerHeight, 0.05, 400),
  };

  const list = MODULES.slice();
  if (params.crash) list.push(['crashTest', () => { throw new Error('deliberate crash (?crash=1)'); }]);

  for (let i = 0; i < list.length; i++) {
    const [name, make] = list[i];
    setBoot(i / list.length, name);
    try {
      G[name] = make(G);
    } catch (e) {
      console.warn(`[boot] ${name} failed`, e);
      pushError(`[boot] ${name} failed: ${e && e.message}`);
      G[name] = (stubs[name] || (() => ({ stub: true, update() {} })))();
    }
    await raf();
  }

  if (G.renderer.stub || G.post.stub) showRenderFailure();

  // The game opens on its title screen (no game:state event announces the first state).
  if (G.game && !G.game.stub && G.game.state === 'title') G.weapon?.setVisible?.(false);

  const loop = createLoop(G, { onError: pushError });
  installHarness(G, loop);
  stageShotFromParams(G);
  if (params.adv) loop.advance(params.adv);

  // First full frame. In step mode dt is 0 here so staged shots start from the same state.
  loop.frame(params.step ? 0 : 1 / 60);
  // boot benchmark picks the tier (no-op until the render tiers exist); it must never stop the boot
  try {
    const r = G.quality.autoSelect?.();
    if (r && typeof r.catch === 'function') r.catch((e) => pushError(`[boot] autoSelect: ${e && e.message}`));
  } catch (e) { pushError(`[boot] autoSelect: ${e && e.message}`); }
  setBoot(1, 'ready');
  document.getElementById('boot')?.classList.add('done');
  window.__ready = true;

  let last = performance.now();
  const tick = (now) => {
    requestAnimationFrame(tick);
    const raw = (now - last) / 1000;
    last = now;
    if (params.step) {
      if (window.__step > 0) {
        // a shot staged with `fire: n` pulls the trigger when n stepped frames are left, so the
        // still that follows the last one shows the flash, its light and the casing in the air
        const fireAt = G.shotCam && G.shotCam.fire;
        if (fireAt && window.__step === fireAt && G.weapon && typeof G.weapon.fire === 'function') G.weapon.fire();
        loop.frame(params.dt ?? 1 / 60);
        window.__step--;
      }
    } else {
      // warp=<n>: n simulation steps per drawn frame (the smoke run plays ten rounds in a few minutes)
      if (params.warp > 1) loop.advance((Math.min(16, Math.floor(params.warp)) - 1) / 60);
      loop.frame(params.warp > 1 ? 1 / 60 : raw);
    }
  };
  requestAnimationFrame(tick);
}

boot().catch((e) => pushError(`[boot] fatal: ${e && e.stack ? e.stack : e}`));
