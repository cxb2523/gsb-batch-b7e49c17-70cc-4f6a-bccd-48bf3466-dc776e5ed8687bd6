// Zombie decision making and steering. Pure: no three.js, no DOM. The crowd lives in typed arrays
// (one slot per live zombie) so a frame allocates nothing here; manager.js owns the bodies and the
// animators and calls the two phases around the animator update:
//
//   crowdThink(c, dt, env)   states, attack timing, stuck guard, facing and the speed asked for (want)
//   (manager)                animator.update(dt, want) -> c.root[i] = animator.rootSpeed
//   crowdMove(c, dt, env)    root moved by exactly rootSpeed along its facing, then crowd separation,
//                            player gap and collider push-out
//
// Facing: yaw is mesh.rotation.y; forward is (sin yaw, cos yaw), the body's local +Z.
//
// Heights: c.y is the height of the feet (the manager sets it from the level's heightAt after each
// move) and c.layer the nav layer it stands on. Zombies more than AI.layerDy apart in height (one on
// the motel walkway, one under it) neither push nor steer around each other, the player gap and
// attacks measure height from the zombie's own feet, and colliders block by the band above its feet.
//
// Types (manager.js sets them per slot; 0 means "use env.tune"): reach, windup, coolT (swing);
// slamEvery/slamR/slamWindup (the brute's ground slam); fuseR/fuseDelay (the bloater: it stops and
// bursts fuseDelay s after coming within fuseR of the player, and never swings).

// agent states (0 = free slot)
export const CHASE = 1, ENTER = 2, CLIMB = 3, WINDUP = 4, RECOVER = 5, TEAR = 6, FUSE = 7;
export const STATE_NAMES = ['free', 'walk', 'walk', 'climb', 'attack', 'attack', 'tear', 'burst'];

export const AI = {
  radius: 0.25,        // body radius against colliders
  minSep: 0.5,         // no two zombies end closer than this, centre to centre
  sepPush: 0.54,       // hard separation target (a little over minSep)
  softSep: 1.1,        // steering separation radius
  softW: 0.9,          // weight of steering separation against the path direction
  playerGap: 0.6,      // soft: zombies give way to keep this from the player's centre...
  playerShove: 1.5,    // ...but no faster than this (m/s), and not at all while attacking
  playerFloor: 0.3,    // hard: never closer than this (the camera is never inside a body)
  turnRate: 2.4,       // rad/s while walking
  windupTurn: 1.6,     // rad/s while winding up an attack
  thinkEvery: 0.1,     // s between flow-field queries per zombie when the field has dirInto
  requery: 0.6,        // without dirInto: query again after this much travel (m)...
  requeryMax: 1.0,     // ...or this long (s), whichever comes first
  directRange: 2.5,    // m: closer than this, walk straight at the player
  stopDist: 0.8,       // m: stop walking this close to the player
  maxDy: 2.0,          // m: player feet must be within this height of the zombie's to be reached (a raised arm reaches someone standing on a dumpster or a tailgate)
  startCos: 0.7,       // facing within ~45 deg to start an attack
  frontCos: 0.5,       // within ~60 deg at the end of the wind-up for the hit to land
  stuckTime: 6,        // s without getting closer -> respawn
  stuckGain: 0.5,      // m of path distance that counts as getting closer
  stuckMove: 2,        // m of travel that also counts as progress (following a fleeing player)
  gatherDist: 1.5,     // m of path distance at which a zombie counts as arrived (player unreachable)
  climbGap: 0.35,      // m from the fence plane where the climb starts
  queueGap: 0.8,       // m further out a zombie waits while another is at its window
  stagedStop: 1.8,     // m: staged zombies stop this far from the shot camera
  directDy: 1.0,       // m: walk straight at the target only when its floor is this close in height
  layerDy: 1.2,        // m: zombies (and the player) further apart in height than this do not push
  lureStop: 1.2,       // m: lured zombies gather this close to the lure
  stairStep: 0.45,     // m: a stair step is climbed (and is no wall) up to this far above the feet (the nav's maxStep)
  // Walls: with a nav field, a zombie walks straight at the player only while its path distance is
  // under the straight distance + pathSlack, and starts an attack (swing, slam, a bloater's fuse) only
  // while the player's path distance is under its reach + reachSlack. Across a 0.3 m wall the centres
  // can be inside the reach; the path round the wall is not. A zombie tearing a window's boards may
  // swing through the opening once at most breachBoards are left (env.breachBoards).
  pathSlack: 1.0,
  reachSlack: 0.5,
  climbOut: 0.65,      // m inside the fence plane a climb that timed out (env.climbMax) is put
};

const DIR = new Float64Array(2);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function createCrowd(cap) {
  const f = () => new Float64Array(cap);
  return {
    cap,
    state: new Uint8Array(cap), busy: new Uint8Array(cap), custom: new Uint8Array(cap),
    x: f(), z: f(), yaw: f(), speed: f(), want: f(), root: f(),
    timer: f(), cool: f(), dx: f(), dz: f(), pathD: f(), next: f(),
    wT: f(), wX: f(), wZ: f(), wBest: f(),
    // fence: inward normal and plane offset (dot(n, p) = fd on the fence), climb approach
    fnx: f(), fnz: f(), fd: f(),
    // custom target (staged zombies walk at the shot camera)
    tx: f(), tz: f(),
    // where the flow field was last queried; player-shove budget left this frame
    qx: f(), qz: f(), shove: f(),
    // feet height and nav layer
    y: f(), layer: new Uint8Array(cap),
    // per type (0: env.tune's): swing reach, windup, cooldown; slam; bloater fuse
    reach: f(), windup: f(), coolT: f(),
    slamEvery: f(), slamT: f(), slamR: f(), slamWindup: f(),
    fuseR: f(), fuseDelay: f(),
    // attack in progress (0 swing, 1 slam); lured (goes to env.lx/lz); a window this agent climbs in
    // through (boards are torn first); waiting behind another agent at that window
    atk: new Uint8Array(cap), lure: new Uint8Array(cap), win: new Uint8Array(cap), wait: new Uint8Array(cap),
    // a swing made from a window while tearing its boards goes back to tearing (ret = TEAR) with the
    // tear clock it left (tearT)
    ret: new Uint8Array(cap), tearT: f(),
    count: 0,
  };
}

// Claims a free slot; returns its index or -1.
export function addAgent(c, x, z, yaw, speed, t = 0) {
  for (let i = 0; i < c.cap; i++) {
    if (c.state[i]) continue;
    c.state[i] = CHASE; c.busy[i] = 0; c.custom[i] = 0;
    c.speed[i] = speed; c.want[i] = 0; c.root[i] = 0; c.cool[i] = 0; c.timer[i] = 0;
    c.dx[i] = 0; c.dz[i] = 0; c.pathD[i] = Infinity;
    c.y[i] = 0; c.layer[i] = 0; c.reach[i] = 0; c.windup[i] = 0; c.coolT[i] = 0;
    c.slamEvery[i] = 0; c.slamT[i] = 0; c.slamR[i] = 0; c.slamWindup[i] = 0; c.fuseR[i] = 0; c.fuseDelay[i] = 0;
    c.atk[i] = 0; c.lure[i] = 0; c.win[i] = 0; c.wait[i] = 0; c.ret[i] = 0; c.tearT[i] = 0;
    placeAgent(c, i, x, z, yaw, t);
    c.count++;
    return i;
  }
  return -1;
}

// Moves an agent (spawn, stuck respawn) and restarts its stuck window.
export function placeAgent(c, i, x, z, yaw, t = 0) {
  c.x[i] = x; c.z[i] = z; c.yaw[i] = yaw; c.root[i] = 0; c.want[i] = 0;
  c.state[i] = CHASE; c.timer[i] = 0; c.pathD[i] = Infinity; c.next[i] = t; c.qx[i] = x; c.qz[i] = z;
  c.win[i] = 0; c.wait[i] = 0; c.atk[i] = 0; c.ret[i] = 0;
  resetWindow(c, i, t, Infinity);
}

// Walk to the fence, then climb it. n: inward unit normal (the way over), fd: dot(n, p) on the fence.
// window: true when the way in is a window, whose boards (hooks.boards) are torn off first.
export function enterOverFence(c, i, nx, nz, fd, window = false) {
  c.state[i] = ENTER; c.fnx[i] = nx; c.fnz[i] = nz; c.fd[i] = fd; c.timer[i] = 0; c.win[i] = window ? 1 : 0;
}

// The type's numbers for slot i. o: { reach, windup, cooldown, slam?: {every, radius, windup},
// fuse?: {trigger, fuse} } (tuning.zombies.types[t] rows have this shape).
export function setAgentType(c, i, o) {
  c.reach[i] = o.reach || 0; c.windup[i] = o.windup || 0; c.coolT[i] = o.cooldown || 0;
  const s = o.slam, b = o.burst;
  c.slamEvery[i] = s ? s.every : 0; c.slamR[i] = s ? s.radius : 0; c.slamWindup[i] = s ? s.windup : 0; c.slamT[i] = 0;
  c.fuseR[i] = b ? b.trigger : 0; c.fuseDelay[i] = b ? b.fuse : 0;
}

export function removeAgent(c, i) {
  if (!c.state[i]) return;
  c.state[i] = 0; c.count--;
}

function resetWindow(c, i, t, best) {
  c.wT[i] = t; c.wX[i] = c.x[i]; c.wZ[i] = c.z[i]; c.wBest[i] = best;
}

function turnTo(c, i, ang, rate, dt) {
  c.yaw[i] += clamp(angDiff(ang, c.yaw[i]), -rate * dt, rate * dt);
}

// Distance from an agent to its fence plane (positive while still outside).
export function fenceGap(c, i) {
  return c.fd[i] - (c.fnx[i] * c.x[i] + c.fnz[i] * c.z[i]);
}

// env: { t, px, py, pz, pAlive, field ({dir, dist, dirInto?} | null), tune (tuning.walker), hooks,
//        lureField ({dir, dist, dirInto?} | null), lx, ly, lz (the lure, for agents with c.lure),
//        tearEvery (s a board), climbMax (s a climb may last, whatever the animator does),
//        breachBoards (a tearing zombie swings through its window at most this many boards left) }
// hooks: attackStart(i, kind), attackEnd(i, landed, dirX, dirZ, kind) (kind 0 swing, 1 slam; dir from
//        the player toward the zombie), climb(i), stuck(i), boards(i) -> boards left at i's window,
//        tear(i) -> boards left after tearing one, fuse(i) (a bloater starts to burst), burst(i)
//        (it bursts: the hook removes the agent)
export function crowdThink(c, dt, env) {
  const { t, px, py, pz, pAlive, field, tune, hooks } = env;
  const lureField = env.lureField || null, lx = env.lx, lz = env.lz, ly = env.ly || 0;
  const tearEvery = env.tearEvery || 0.9;
  const climbMax = env.climbMax || 5;
  const breachBoards = env.breachBoards ?? 3;
  for (let i = 0; i < c.cap; i++) {
    const st = c.state[i];
    if (!st) continue;
    c.cool[i] -= dt; c.slamT[i] -= dt;
    const x = c.x[i], z = c.z[i], y = c.y[i];

    if (st === ENTER) {
      // square up to the fence and walk to the climb point (or wait behind one at the same window)
      const gap = fenceGap(c, i);
      turnTo(c, i, Math.atan2(c.fnx[i], c.fnz[i]), AI.turnRate, dt);
      if (c.wait[i] && gap <= AI.climbGap + AI.queueGap) c.want[i] = 0;
      else if (gap <= AI.climbGap + 0.02) {
        c.want[i] = 0;
        if (c.win[i] && hooks.claim && !hooks.claim(i)) c.wait[i] = 1; // another got there first
        else {
          c.yaw[i] = Math.atan2(c.fnx[i], c.fnz[i]);
          c.timer[i] = 0;
          if (c.win[i] && hooks.boards && hooks.boards(i) > 0) { c.state[i] = TEAR; if (hooks.tearStart) hooks.tearStart(i); } else { c.state[i] = CLIMB; hooks.climb(i); }
        }
      } else c.want[i] = c.speed[i] * clamp((gap - AI.climbGap) / 0.5, 0.35, 1);
      resetWindow(c, i, t, Infinity);
      continue;
    }
    if (st === TEAR) {
      // at a boarded window: a board every tearEvery s, then through; a player standing at the window
      // inside its reach is hit through the gap once enough boards are gone
      c.want[i] = 0; c.timer[i] += dt;
      if (pAlive && !c.busy[i] && c.cool[i] <= 0 && hooks.boards(i) <= breachBoards && Math.abs(py - y) <= AI.maxDy) {
        const hx = px - x, hz = pz - z, hd = Math.hypot(hx, hz);
        const inside = c.fnx[i] * px + c.fnz[i] * pz > c.fd[i];
        if (inside && hd <= (c.reach[i] || tune.reach) && c.fuseR[i] <= 0) {
          c.tearT[i] = c.timer[i]; c.ret[i] = TEAR;
          c.yaw[i] = Math.atan2(hx, hz);
          c.state[i] = WINDUP; c.atk[i] = 0; c.timer[i] = 0;
          hooks.attackStart(i, 0);
          resetWindow(c, i, t, Infinity);
          continue;
        }
      }
      turnTo(c, i, Math.atan2(c.fnx[i], c.fnz[i]), AI.turnRate, dt);
      if (c.timer[i] >= tearEvery - 1e-9) {
        c.timer[i] -= tearEvery;
        if (hooks.tear(i) <= 0) { c.state[i] = CLIMB; c.timer[i] = 0; hooks.climb(i); }
      } else if (hooks.boards(i) <= 0) { c.state[i] = CLIMB; c.timer[i] = 0; hooks.climb(i); }
      resetWindow(c, i, t, Infinity);
      continue;
    }
    if (st === CLIMB) {
      c.want[i] = 0; c.timer[i] += dt;
      const late = c.timer[i] >= climbMax - 1e-9;
      if (c.timer[i] > 0.2 && (!c.busy[i] || late)) {
        // a climb the animator never ends (a clip that does not finish in idle) is left after climbMax
        // s; one still short of the far side is put there
        if (late && fenceGap(c, i) > -AI.climbOut) {
          const k = fenceGap(c, i) + AI.climbOut;
          c.x[i] += c.fnx[i] * k; c.z[i] += c.fnz[i] * k;
        }
        c.state[i] = CHASE; c.next[i] = t; c.win[i] = 0;
        if (late && hooks.climbEnd) hooks.climbEnd(i);
      }
      resetWindow(c, i, t, Infinity);
      continue;
    }

    const hx = px - x, hz = pz - z;
    const hd = Math.hypot(hx, hz);
    const pdy = Math.abs(py - y);
    const toPlayer = Math.atan2(hx, hz);

    if (st === FUSE) {
      // a bloater swelling: it stands, faces the player and bursts after its fuse
      c.want[i] = 0; c.timer[i] += dt;
      turnTo(c, i, toPlayer, AI.turnRate, dt);
      resetWindow(c, i, t, Infinity);
      if (c.timer[i] >= c.fuseDelay[i] - 1e-9) hooks.burst(i);
      continue;
    }
    if (st === WINDUP) {
      const slam = c.atk[i] === 1;
      const reach = c.reach[i] || tune.reach;
      c.want[i] = 0; c.timer[i] += dt;
      if (!slam) turnTo(c, i, toPlayer, AI.windupTurn, dt);
      if (c.timer[i] >= (slam ? c.slamWindup[i] : c.windup[i] || tune.windup) - 1e-9) {
        const fc = hd > 1e-6 ? (Math.sin(c.yaw[i]) * hx + Math.cos(c.yaw[i]) * hz) / hd : 1;
        const landed = pAlive && pdy <= AI.maxDy && (slam ? hd <= c.slamR[i] : hd <= reach && fc >= AI.frontCos);
        const l = hd > 1e-6 ? hd : 1;
        c.state[i] = RECOVER; c.timer[i] = 0; c.cool[i] = c.coolT[i] || tune.cooldown;
        if (slam) c.slamT[i] = c.slamEvery[i];
        hooks.attackEnd(i, landed, -hx / l, -hz / l, c.atk[i]);
      }
      resetWindow(c, i, t, Infinity);
      continue;
    }
    if (st === RECOVER) {
      c.want[i] = 0; c.timer[i] += dt;
      if (c.timer[i] > 0.05 && !c.busy[i]) {
        if (c.ret[i] === TEAR) {
          c.ret[i] = 0; c.state[i] = TEAR; c.timer[i] = c.tearT[i];
          c.yaw[i] = Math.atan2(c.fnx[i], c.fnz[i]);
          if (hooks.tearStart) hooks.tearStart(i);
        } else { c.state[i] = CHASE; c.next[i] = t; }
      }
      resetWindow(c, i, t, Infinity);
      continue;
    }

    // ---- CHASE: the player, or the lure, or (staged) the shot camera
    const custom = c.custom[i] === 1;
    const lured = !custom && c.lure[i] === 1;
    const gx = custom ? c.tx[i] : lured ? lx : px, gz = custom ? c.tz[i] : lured ? lz : pz;
    const gy = custom ? y : lured ? ly : py;
    const fld = custom ? null : lured ? lureField : field;
    const ex = gx - x, ez = gz - z;
    const ed = Math.hypot(ex, ez);
    const L = c.layer[i];
    if (fld) {
      // field.dir() returns a new array, so without an allocation-free dirInto the direction is
      // cached and queried again only after AI.requery m of travel or AI.requeryMax s
      if (fld.dirInto ? t >= c.next[i] : t >= c.next[i] || Math.hypot(x - c.qx[i], z - c.qz[i]) >= AI.requery) {
        c.next[i] = t + (fld.dirInto ? AI.thinkEvery : AI.requeryMax);
        c.qx[i] = x; c.qz[i] = z;
        if (fld.dirInto) { fld.dirInto(x, z, DIR, L); c.dx[i] = DIR[0]; c.dz[i] = DIR[1]; } else { const d = fld.dir(x, z, L); c.dx[i] = d[0]; c.dz[i] = d[1]; }
        c.pathD[i] = fld.dist(x, z, L);
      }
    }
    const flowZero = c.dx[i] === 0 && c.dz[i] === 0;
    const reachable = c.pathD[i] < Infinity;
    const level = Math.abs(gy - y) < AI.directDy;
    // straight at the target when close on the same floor and the path is about that long (not round
    // a wall), or with no field to follow; where the field ends short of it (a player on a car roof, a
    // part of the map cut off from it) wait
    const direct = !fld || (ed < AI.directRange && level && c.pathD[i] < ed + AI.pathSlack);
    const gathered = !direct && flowZero;
    let ddx, ddz;
    if (direct) { ddx = ed > 1e-6 ? ex / ed : 0; ddz = ed > 1e-6 ? ez / ed : 0; } else { ddx = c.dx[i]; ddz = c.dz[i]; }

    const stop = custom ? AI.stagedStop : lured ? AI.lureStop : AI.stopDist;
    // queued: another zombie right next to this one is further along the same path (a jam on the
    // stairs, the walkway or in a doorway is not being stuck)
    let queued = false;
    if (gathered || (direct && ed <= stop && level)) {
      c.want[i] = 0;
      turnTo(c, i, Math.atan2(ex, ez), AI.turnRate, dt);
    } else {
      // steer around neighbours on the same floor
      let sx = 0, sz = 0;
      const pd = c.pathD[i];
      for (let j = 0; j < c.cap; j++) {
        const sj = c.state[j];
        if (j === i || !sj || sj === CLIMB || sj === ENTER || sj === TEAR) continue;
        const ox = x - c.x[j], oz = z - c.z[j];
        const d2 = ox * ox + oz * oz;
        if (d2 >= AI.softSep * AI.softSep || d2 < 1e-10 || Math.abs(c.y[j] - y) > AI.layerDy) continue;
        const d = Math.sqrt(d2), w = (AI.softSep - d) / AI.softSep;
        sx += (ox / d) * w; sz += (oz / d) * w;
        if (pd < Infinity && c.pathD[j] < pd - 0.1 && !c.lure[j]) queued = true;
      }
      ddx += sx * AI.softW; ddz += sz * AI.softW;
      if (ddx !== 0 || ddz !== 0) turnTo(c, i, Math.atan2(ddx, ddz), AI.turnRate, dt);
      const err = Math.abs(angDiff(Math.atan2(ddx, ddz), c.yaw[i]));
      c.want[i] = c.speed[i] * (err < 0.5 ? 1 : err < 1.4 ? 1 - ((err - 0.5) / 0.9) * 0.7 : 0.3);
    }

    // attack: the bloater's fuse, the brute's slam, a swing; each only while the player's path distance
    // (not just the straight one) is inside its range, so never through a wall
    const reachI = c.reach[i] || tune.reach;
    let pathP = 0;
    if (field && !custom && hd <= Math.max(reachI + 0.3, c.slamR[i], c.fuseR[i])) {
      pathP = lured ? field.dist(x, z, L) : c.pathD[i];
    }
    if (!custom && pAlive && pdy <= AI.maxDy && !c.busy[i]) {
      if (c.fuseR[i] > 0) {
        if (hd <= c.fuseR[i] && pathP < c.fuseR[i] + AI.reachSlack) {
          c.state[i] = FUSE; c.timer[i] = 0; c.want[i] = 0;
          hooks.fuse(i);
          resetWindow(c, i, t, Infinity);
          continue;
        }
      } else if (c.slamEvery[i] > 0 && c.slamT[i] <= 0 && hd <= c.slamR[i] && pathP < c.slamR[i] + AI.reachSlack) {
        c.state[i] = WINDUP; c.atk[i] = 1; c.timer[i] = 0; c.want[i] = 0;
        hooks.attackStart(i, 1);
        resetWindow(c, i, t, Infinity);
        continue;
      } else if (hd <= reachI && c.cool[i] <= 0 && pathP < reachI + AI.reachSlack) {
        const fc = hd > 1e-6 ? (Math.sin(c.yaw[i]) * hx + Math.cos(c.yaw[i]) * hz) / hd : 1;
        if (fc >= AI.startCos) {
          c.state[i] = WINDUP; c.atk[i] = 0; c.timer[i] = 0; c.want[i] = 0;
          hooks.attackStart(i, 0);
          resetWindow(c, i, t, Infinity);
          continue;
        }
      }
    }

    // stuck guard: no closer by stuckGain and no stuckMove of travel within stuckTime (not while
    // following a lure: that lasts seconds and ends where they gather)
    if (custom || lured) { resetWindow(c, i, t, Infinity); continue; }
    const prog = reachable ? c.pathD[i] : ed;
    // cut off from the player (no path at all): it is gathering where its part of the map ends, and
    // a respawn would not help; the manager moves it if it is the only one cut off (relocateCutOff)
    const cutOff = fld && !reachable;
    const exempt = (hd <= reachI + 0.3 && pdy <= AI.maxDy && pathP < reachI + AI.reachSlack + 0.3) || gathered || queued || cutOff || c.pathD[i] < AI.gatherDist;
    const moved = Math.hypot(x - c.wX[i], z - c.wZ[i]);
    if (exempt || prog < c.wBest[i] - AI.stuckGain || moved > AI.stuckMove || c.wBest[i] === Infinity) {
      resetWindow(c, i, t, prog);
    } else if (t - c.wT[i] >= AI.stuckTime) {
      resetWindow(c, i, t, prog);
      hooks.stuck(i);
    }
  }
}

// env: { px, py?, pz, obstacles (createObstacles result | null) }
export function crowdMove(c, dt, env) {
  const { px, pz, obstacles } = env;
  const py = env.py || 0;
  for (let i = 0; i < c.cap; i++) {
    if (!c.state[i]) continue;
    const v = c.root[i] * dt;
    c.x[i] += Math.sin(c.yaw[i]) * v;
    c.z[i] += Math.cos(c.yaw[i]) * v;
  }
  // separation, player gap and colliders, repeated until the crowd is apart (colliders win last).
  // The player gap is soft: a zombie gives way at most AI.playerShove m/s (not at all while it winds
  // up or recovers from an attack), so the player cannot drag zombies along; only AI.playerFloor is hard.
  const budget = AI.playerShove * dt;
  for (let i = 0; i < c.cap; i++) c.shove[i] = budget;
  for (let iter = 0; iter < 8; iter++) {
    const closest = separate(c);
    let pushed = false;
    for (let i = 0; i < c.cap; i++) {
      const st = c.state[i];
      if (!st || st === ENTER || st === TEAR) continue;
      if (st === CLIMB) {
        // climbing over a fence or through a window: it never comes nearer the player than playerGap
        // (it waits on the way in, backed out along it, so the camera is never inside it)
        if (c.custom[i] || Math.abs(py - c.y[i]) > AI.layerDy) continue;
        const ox = c.x[i] - px, oz = c.z[i] - pz, d2 = ox * ox + oz * oz;
        if (d2 >= AI.playerGap * AI.playerGap) continue;
        const nx = c.fnx[i], nz = c.fnz[i], b = ox * nx + oz * nz;
        const back = b + Math.sqrt(Math.max(0, b * b - d2 + AI.playerGap * AI.playerGap));
        c.x[i] -= nx * back; c.z[i] -= nz * back;
        continue;
      }
      if (!c.custom[i] && Math.abs(py - c.y[i]) <= AI.layerDy) {
        let ox = c.x[i] - px, oz = c.z[i] - pz;
        const d2 = ox * ox + oz * oz;
        if (d2 < AI.playerGap * AI.playerGap) {
          let d = Math.sqrt(d2);
          if (d > 1e-6) { ox /= d; oz /= d; } else { ox = -Math.sin(c.yaw[i]); oz = -Math.cos(c.yaw[i]); d = 0; }
          let to = d;
          if (d < AI.playerFloor) to = AI.playerFloor;
          const holds = st === WINDUP || st === RECOVER;
          if (!holds && c.shove[i] > 0) {
            const step = Math.min(AI.playerGap - to, c.shove[i]);
            to += step; c.shove[i] -= step;
          }
          if (to > d + 1e-9) { c.x[i] = px + ox * to; c.z[i] = pz + oz * to; pushed = true; }
        }
      }
      if (obstacles && obstacles.push(c.x[i], c.z[i], AI.radius, c.y[i])) { c.x[i] = obstacles.out[0]; c.z[i] = obstacles.out[1]; pushed = true; }
    }
    if (!pushed && closest >= AI.minSep) break;
  }
}

// Who takes part in separation: 2 moves (walking, attacking, a bloater swelling, one waiting its turn
// at a window), 1 holds its place (tearing boards: the one waiting is pushed off it), 0 neither
// (walking up to a fence or climbing over it).
function sepRole(c, k) {
  const s = c.state[k];
  if (s === CHASE || s === WINDUP || s === RECOVER || s === FUSE) return 2;
  if (s === TEAR) return 1;
  if (s === ENTER && c.wait[k]) return 2;
  return 0;
}

// Hard separation: pairs closer than sepPush are pushed apart (equally, or all of it onto the one that
// may move). Returns the closest distance found after the pass's pushes (a pass is not exact for dense
// groups; the caller repeats).
function separate(c) {
  const S = AI.sepPush;
  let closest = Infinity;
  for (let i = 0; i < c.cap; i++) {
    const ri = c.state[i] ? sepRole(c, i) : 0;
    if (!ri) continue;
    for (let j = i + 1; j < c.cap; j++) {
      const rj = c.state[j] ? sepRole(c, j) : 0;
      if (!rj || (ri === 1 && rj === 1) || Math.abs(c.y[j] - c.y[i]) > AI.layerDy) continue;
      let ox = c.x[j] - c.x[i], oz = c.z[j] - c.z[i];
      let d2 = ox * ox + oz * oz;
      if (d2 >= S * S) continue;
      let d = Math.sqrt(d2);
      if (d < closest) closest = d;
      if (d < 1e-6) { const a = (i * 2.399963 + j * 0.7) % (Math.PI * 2); ox = Math.cos(a); oz = Math.sin(a); d = 1; d2 = 0; } else { ox /= d; oz /= d; }
      const push = S - (d2 === 0 ? 0 : d);
      const wi = ri === 1 ? 0 : rj === 1 ? 1 : 0.5, wj = 1 - wi;
      c.x[i] -= ox * push * wi; c.z[i] -= oz * push * wi;
      c.x[j] += ox * push * wj; c.z[j] += oz * push * wj;
    }
  }
  return closest;
}

// Static blockers from the level's boxes, by height: a box blocks a body whose feet are at y when it
// reaches into [y + step, y + top] (taller than a step above the feet, and not wholly overhead), so the
// motel walkway's rail blocks a zombie on the walkway and not one under it. Stair steps (`stair`) are
// floors to climb: one blocks only where its top is more than AI.stairStep over the feet (two risers
// up, so the step after next never stops a body climbing, while the side of a stair is a wall to one
// beside it); opened doors (`off`) never block. A uniform grid in compressed rows;
// push() allocates nothing and writes the corrected position into out.
export function createObstacles(colliders, { step = 0.32, top = 1.8, cell = 2, margin = 0.4 } = {}) {
  const src = (colliders || []).filter((b) => b && !b.off && b.max[1] > step);
  const n = src.length;
  const box = new Float64Array(n * 4);
  const ys = new Float64Array(n * 2);
  const stair = new Uint8Array(n);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  src.forEach((b, k) => {
    box[k * 4] = b.min[0]; box[k * 4 + 1] = b.min[2]; box[k * 4 + 2] = b.max[0]; box[k * 4 + 3] = b.max[2];
    ys[k * 2] = b.min[1]; ys[k * 2 + 1] = b.max[1]; stair[k] = b.stair ? 1 : 0;
    x0 = Math.min(x0, b.min[0] - margin); z0 = Math.min(z0, b.min[2] - margin);
    x1 = Math.max(x1, b.max[0] + margin); z1 = Math.max(z1, b.max[2] + margin);
  });
  const out = new Float64Array(2);
  if (!n) return { count: 0, out, push: () => false };
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((z1 - z0) / cell));
  const start = new Int32Array(cols * rows + 1);
  const span = (k, fn) => {
    const i0 = Math.max(0, Math.floor((box[k * 4] - margin - x0) / cell)), i1 = Math.min(cols - 1, Math.floor((box[k * 4 + 2] + margin - x0) / cell));
    const j0 = Math.max(0, Math.floor((box[k * 4 + 1] - margin - z0) / cell)), j1 = Math.min(rows - 1, Math.floor((box[k * 4 + 3] + margin - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * cols + i);
  };
  for (let k = 0; k < n; k++) span(k, (c) => { start[c + 1]++; });
  for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
  const items = new Int32Array(start[cols * rows]);
  const fill = start.slice(0, cols * rows);
  for (let k = 0; k < n; k++) span(k, (c) => { items[fill[c]++] = k; });

  // y: the feet (default the ground)
  function push(x, z, r, y = 0) {
    const ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell);
    if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) return false;
    const c = cj * cols + ci;
    const lo = y + step, hi = y + top, stairLo = y + AI.stairStep;
    let moved = false;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (let s = start[c]; s < start[c + 1]; s++) {
        const kk = items[s];
        const yTop = ys[kk * 2 + 1];
        if (yTop <= (stair[kk] ? stairLo : lo) || ys[kk * 2] >= hi) continue;
        const k = kk * 4;
        const bx0 = box[k], bz0 = box[k + 1], bx1 = box[k + 2], bz1 = box[k + 3];
        const cx = x < bx0 ? bx0 : x > bx1 ? bx1 : x;
        const cz = z < bz0 ? bz0 : z > bz1 ? bz1 : z;
        const dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2), k2 = (r - d + 1e-4) / d;
          x += dx * k2; z += dz * k2;
        } else {
          // centre inside the box: leave by the nearest face
          const l = x - bx0, rt = bx1 - x, nn = z - bz0, ff = bz1 - z;
          const m = Math.min(l, rt, nn, ff);
          if (m === l) x = bx0 - r - 1e-4; else if (m === rt) x = bx1 + r + 1e-4; else if (m === nn) z = bz0 - r - 1e-4; else z = bz1 + r + 1e-4;
        }
        any = moved = true;
      }
      if (!any) break;
    }
    out[0] = x; out[1] = z;
    return moved;
  }
  return { count: n, out, push };
}

const px = (p) => (p.pos ? (Array.isArray(p.pos) ? p.pos[0] : p.pos.x) : Array.isArray(p) ? p[0] : p.x);
const pz = (p) => (p.pos ? (Array.isArray(p.pos) ? p.pos[2] : p.pos.z) : Array.isArray(p) ? p[2] : p.z);
export const pointX = px, pointZ = pz;

// Is a ground point inside the camera's horizontal field of view?
// view: { x, z, fx, fz (unit forward on the ground), cosHalf } or null (nothing is in view).
export function inView(view, x, z) {
  if (!view) return false;
  const vx = x - view.x, vz = z - view.z;
  const l = Math.hypot(vx, vz);
  if (l < 0.01) return true;
  return (vx * view.fx + vz * view.fz) / l > view.cosHalf;
}

// Spawn point choice: the director's candidate if it is out of view and at least minDist from the
// player; else a random point that is; else the farthest point out of view; else the farthest.
export function pickSpawn(points, candidate, playerX, playerZ, view, rng, minDist = 8) {
  const far = (p) => Math.hypot(px(p) - playerX, pz(p) - playerZ);
  const ok = (p) => far(p) >= minDist && !inView(view, px(p), pz(p));
  if (candidate && ok(candidate)) return candidate;
  if (!points || !points.length) return candidate || null;
  const good = points.filter(ok);
  if (good.length) return rng ? rng.pick(good) : good[0];
  const unseen = points.filter((p) => !inView(view, px(p), pz(p)));
  const pool = unseen.length ? unseen : points;
  let best = pool[0];
  for (const p of pool) if (far(p) > far(best)) best = p;
  return best;
}

// For a zombie already in play (a stuck respawn, a relocation): a point out of view, never one in it.
// Out of view and at least minDist from the player (nearer than `nearer`: the nearest such point; else
// a random one); else the farthest out of view (and nearer than `nearer`); else null: the caller waits.
export function pickHidden(points, playerX, playerZ, view, rng, minDist = 8, nearer = Infinity) {
  if (!points || !points.length) return null;
  const good = [];
  let far = null, farD = -1, best = null, bestD = Infinity;
  for (const p of points) {
    const x = px(p), z = pz(p);
    if (inView(view, x, z)) continue;
    const d = Math.hypot(x - playerX, z - playerZ);
    if (d >= nearer) continue;
    if (d >= minDist) { good.push(p); if (d < bestD) { best = p; bestD = d; } } else if (d > farD) { far = p; farD = d; }
  }
  if (good.length) return nearer < Infinity ? best : rng ? rng.pick(good) : good[0];
  return far;
}

// Stand-in animator with the real one's contract (rootSpeed, set, update, done, state, collapse,
// hitReact, setTarget, settled), used when no body can be built and by the tests. Timings match
// anim.js: speed ramps up at 2 m/s^2 and down at 3; attack done at 1.55 s; stagger 0.8 s;
// climb 2.78 s, carrying the root over the fence; settled 2 s after a collapse.
export function createGhostAnimator() {
  let state = 'idle', t = 0, v = 0, climbSpeed = 0, end = 0;
  const api = {
    rootSpeed: 0, done: true, settled: false, onStep: null, lod: 0,
    get state() { return state; },
    get time() { return t; },
    set(next, opts = {}) {
      if (state === 'dead') return;
      if (next === 'dead') { api.collapse(opts.dir, opts.impulse); return; }
      if (next === state && !api.done && next !== 'attack') return;
      if (next === 'attack' && state === 'attack' && !api.done) return;
      if (next === 'climb') { const d0 = opts.distance ?? 0.35; end = 2.78; climbSpeed = (d0 + 0.56) / (end - 0.45); }
      state = next; t = 0; api.done = next === 'walk' || next === 'idle';
    },
    setTarget() {},
    hitReact() {},
    collapse() { if (state === 'dead') return; state = 'dead'; t = 0; v = 0; api.rootSpeed = 0; api.done = false; },
    update(dt, speed = 0) {
      if (api.settled) return;
      t += dt;
      if (state === 'dead') { api.rootSpeed = 0; if (t > 2) { api.settled = true; api.done = true; } return; }
      if (state === 'climb') {
        api.rootSpeed = t > 0.45 && t < end ? climbSpeed : 0;
        if (t >= end) { state = 'idle'; api.done = true; v = 0.5; }
        return;
      }
      const vT = state === 'walk' ? speed : 0;
      v += clamp(vT - v, -3 * dt, 2 * dt);
      api.rootSpeed = state === 'attack' ? 0 : state === 'stagger' ? 0 : v;
      if (state === 'attack' && t >= 1.55) { state = 'idle'; api.done = true; }
      if (state === 'stagger' && t >= 0.8) { state = 'idle'; api.done = true; }
    },
  };
  return api;
}
