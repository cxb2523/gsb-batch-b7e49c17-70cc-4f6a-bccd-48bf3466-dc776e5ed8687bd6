# Levels of complication

Decide a figure's level before you lay out its boxes. The level sets how many parts move, how the cause reaches the effect, and how much state you hold. Aim for the lowest level that tells the story. A level 1 figure that reads instantly beats a level 4 figure that needs explaining.

## Level 1 · Tap

One press changes one surface.

- **Parts:** one pressable part, one surface that shows state, a read-out.
- **Pieces:** `Plate`, `Box`, `Press`, `useDemoTap`, `Ripple`, `Cursor`.
- **State:** one `useState`. No timers.
- **Motion:** the press itself, and a screen or light that changes on release.
- **Sound:** the built-in press and release in the part's material, plus at most one short result sound on release: `toggle` for a switch, `success` or `notify` for an answer.
- **Complications:** at most one, such as digits that roll or a lamp that glows.
- **Shape of it:** a tally counter, a light switch, a stamp.

## Level 2 · Cause and effect

The press sends something to a separate part, and the result lands there a moment later.

- **Parts:** the control, a path (cable, rail, beam), the result surface.
- **Pieces:** everything from level 1, plus `Signal` (or one moving part) from cause to effect.
- **State:** one or two `useState`s. At most one timer, kept in a ref, for a sound that lands with the result.
- **Motion:** the signal runs for `duration`; the result changes at `delay + duration` through a CSS `transition-delay`, not a timer.
- **Sound:** `process` while it travels (keep its stop and cut it on arrival), then `success` or `done`. A `relay` as the result switches on is the classic complication here.
- **Complications:** at most one.
- **Shape of it:** a feature-flag panel, a usage meter, a ground station that pings a satellite.

## Level 3 · Sequence

Several parts move one after another, and the order explains the work.

- **Parts:** a row or stack of similar parts, a progress surface, the control.
- **Pieces:** everything from level 2, plus staggered CSS delays (`--i`) and `playSound("cascade", { count, stagger, delay })` matched to them.
- **State:** a step or count. Timers live in a ref and are all cleared on the next press and on unmount.
- **Motion:** stagger by physical position (lowest first, nearest the pointer first), 40 to 60 ms apart. Progress counts up on a screen as the parts land.
- **Sound:** `cascade` with the same count and stagger as the motion, then `complete` when the last part lands.
- **Complications:** up to two, such as a progress counter that rolls and a motor that runs while the sequence plays.
- **Shape of it:** a page press seating blocks, a cryostat cooling stage by stage, a GPU rack lighting node by node.

## Level 4 · System

Two or more controls or modes drive a small machine whose parts trade things between them.

- **Parts:** several controls, at least two stations, things that move between them.
- **Pieces:** everything from level 3, plus `Flight` for a part carried between stations (or chained CSS moves when the part must stay on a track, like a train on its rails) and a `useReducer` for the state machine.
- **State:** one reducer with named actions. Every press is a transition, every transition writes the read-out, and a cycle resets cleanly.
- **Motion:** a flight hides the part at `from` on take-off and shows it at `to` on landing, both through CSS delays. Only one thing is in the air at a time unless the story needs more.
- **Sound:** cut stale sounds when a newer action replaces them; `whoosh` on reset; `motor` for every drive, with its stop kept.
- **Complications:** up to three.
- **Shape of it:** a pick-and-place arm, a webhook relay with retries, a container crane.

## Ideas by industry

Physical objects behind products, with the level each wants. Pick one, or use it to find yours.

- **SaaS:** approval pad (1), feature flags (2), deploy pipeline (3), webhook relay (4).
- **Fintech:** card terminal (1), vault door (2), ledger press (3), clearing house (4).
- **Health:** pill counter (1), infusion pump (2), ECG monitor (3), lab sorter (4).
- **Logistics:** parcel locker (1), conveyor scanner (2), loading dock (3), container crane (4).
- **Energy:** breaker switch (1), solar tracker (2), battery stack (3), grid substation (4).
- **Manufacturing:** stamp press (1), CNC mill (2), assembly line (3), pick-and-place (4).
- **Retail:** price gun (1), receipt printer (2), shelf restock (3), checkout lane (4).
- **Media:** record button (1), mixing desk (2), render farm (3), broadcast van (4).
- **Security:** key fob (1), badge gate (2), vault timer (3), SOC wall (4).
- **Mobility:** charge plug (1), parking barrier (2), traffic signal (3), rail switchyard (4).
- **Education:** school bell (1), quiz buzzer (2), abacus (3), library sorter (4).
- **Deep tech:** wafer probe (2), cryostat (3), GPU cluster (3), ground station (2), agent relay (4).
