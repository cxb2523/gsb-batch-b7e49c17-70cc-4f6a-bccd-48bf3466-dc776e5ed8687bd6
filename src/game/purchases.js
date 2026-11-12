// What using each kind of interactable does, and what it costs. Pure: no DOM, no three.js.
//
// use(it) -> {ok, reason}. Refusal reasons:
//   none (no such interactable) | unavailable (no weapon yet, or nothing to sell) | full (ammo at
//   max) | points (too few) | locked (a door that never opens) | owned (already bought, open, on or
//   upgraded) | power (needs the power on) | busy (the box is rolling or moving) | hold (a hold
//   interactable: searching and boards are driven by the hold, not the press) | unknown (kind)
// Every refusal except `hold` emits `buy:denied {item: kind, reason}`. Purchases emit
// `buy {item, cost, id}` through the economy (item: wallWeapon | wallAmmo | door | box | bench |
// machine:<kind>).
import { tuning } from './tuning.js';
import { WEAPONS, isWeapon, statsFor } from '../weapon/defs.js';

const TE = tuning.economy;
const TB = tuning.world.boards || { repairPoints: 10, repairCapPerRound: 200 };
const ok = { ok: true, reason: null };
const refuse = (reason) => ({ ok: false, reason });

export const wallWeaponOf = (it) => (it && (TE.wallBuys[it.weapon] || (isWeapon(it.weapon) ? it.weapon : null))) || null;

// The slot holding weapon `id`, or null.
function slotOf(w, id) {
  const s = w && w.slots;
  if (!s) return null;
  return s[0] && s[0].id === id ? s[0] : s[1] && s[1].id === id ? s[1] : null;
}

// Price of ammo for weapon `id` as the player holds it (4500 once upgraded).
export function ammoCost(w, id, fallback) {
  const s = slotOf(w, id);
  if (s && s.upgraded) return TE.upgradedAmmo;
  const def = WEAPONS[id];
  return (def && def.wall && def.wall.ammo) || fallback || TE.wallAmmo.cost;
}

/**
 * @param {object} o
 * @param {object} o.economy                 createEconomy()
 * @param {() => object} o.weapon            G.weapon (arsenal API)
 * @param {(name, payload) => void} [o.emit]
 * @param {() => object} [o.level]           G.level (doors, openDoor, power, setPower, repairBoard)
 * @param {object} [o.box] [o.bench] [o.machines] [o.loot]
 */
export function createPurchases({ economy, weapon, emit = () => {}, level = () => null, box = null, bench = null, machines = null, loot = null }) {
  let boardPoints = 0; // paid for boards this round

  function ammo(it, id) {
    const w = weapon();
    if (!w || !w.ammo || typeof w.addReserve !== 'function') return refuse('unavailable');
    const s = typeof w.has === 'function' ? slotOf(w, id) : null;
    if (typeof w.has === 'function' && !s) return refuse('unavailable');
    // an original stand-in weapon (no slots): the held weapon at the pistol's max
    const max = s ? statsFor(s).maxReserve : tuning.pistol.maxReserve;
    const have = s ? s.reserve : w.ammo.reserve;
    if (have >= max) return refuse('full');
    // the store's price is its own (the original 250); a wall buy's is the weapon table's
    const cost = s && s.upgraded ? TE.upgradedAmmo : it.kind === 'wallAmmo' && it.cost != null ? it.cost : ammoCost(w, id);
    if (!economy.spend(cost, 'wallAmmo', it.id)) return refuse('points');
    if (s) w.addReserve(undefined, id); else w.addReserve(max - have);
    return ok;
  }

  const handlers = {
    // the store's ammo: the pistol's (it.weapon names another weapon, if a level gives one)
    wallAmmo: (it) => ammo(it, wallWeaponOf(it) || 'pistol'),
    wallWeapon(it) {
      const id = wallWeaponOf(it);
      const w = weapon();
      if (!id || !w || typeof w.give !== 'function') return refuse('unavailable');
      if (w.has(id)) return ammo(it, id);
      const cost = WEAPONS[id].wall && WEAPONS[id].wall.cost;
      if (!(cost > 0)) return refuse('unavailable');
      if (!economy.spend(cost, 'wallWeapon', it.id)) return refuse('points');
      w.give(id);
      return ok;
    },
    door(it) {
      const L = level();
      const d = L && L.doors ? L.doors.find((q) => q.id === it.door) : null;
      if (!d || typeof L.openDoor !== 'function') return refuse('locked');
      if (d.open) return refuse('owned');
      const cost = (tuning.world.doors && tuning.world.doors[d.id]) ?? d.cost ?? it.cost;
      if (!economy.spend(cost, 'door', it.id)) return refuse('points');
      L.openDoor(d.id);
      return ok;
    },
    power() {
      const L = level();
      if (!L || !L.power || typeof L.setPower !== 'function') return refuse('unavailable');
      if (L.power.on) return refuse('owned');
      L.setPower(true);
      return ok;
    },
    box() {
      if (!box) return refuse('unavailable');
      return box.state === 'offering' ? box.take() : box.roll();
    },
    bench() { return bench ? bench.use() : refuse('unavailable'); },
    machine(it) { return machines ? machines.buy(it.machine) : refuse('unavailable'); },
    pickup(it) { return loot ? loot.take(it) : refuse('unavailable'); },
    search: () => refuse('hold'),
    boards: () => refuse('hold'),
    lockedDoor: () => refuse('locked'), // a door that never opens (an early greybox's)
  };

  const p = {
    use(it) {
      const h = it && handlers[it.kind];
      const r = !it ? refuse('none') : h ? h(it) : refuse('unknown');
      if (!r.ok && r.reason !== 'hold') emit('buy:denied', { item: it ? it.kind : null, reason: r.reason });
      return r;
    },

    // One board back on window `it.window`: 10 points each, up to 200 a round.
    repairBoard(it) {
      const L = level();
      const win = L && L.windows ? L.windows.find((q) => q.id === it.window) : null;
      if (!win || win.boards >= win.max || typeof L.repairBoard !== 'function') return false;
      L.repairBoard(win.id);
      const pay = Math.min(TB.repairPoints, TB.repairCapPerRound - boardPoints);
      if (pay > 0) { boardPoints += pay; economy.add(pay, 'board'); }
      return true;
    },
    get boardPoints() { return boardPoints; },
    onRound() { boardPoints = 0; },
    reset() { boardPoints = 0; },
  };
  return p;
}
