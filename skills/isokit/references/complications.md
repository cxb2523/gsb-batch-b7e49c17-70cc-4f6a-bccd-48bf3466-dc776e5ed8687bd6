# Complications

A complication is a small mechanism between the press and the result that makes an object feel built rather than drawn. The word comes from watchmaking: everything a watch does beyond telling the hour.

Every complication here holds to three rules:

1. **It is caused.** It runs because the reader pressed something, on the way from that press to the result. Nothing here idles.
2. **It sounds.** Each one brings its own mechanical sound, played at the moment it moves.
3. **It is capped.** At most one at levels 1 and 2, two at level 3, three at level 4. One that reads beats three that compete.

All timing comes from the kit's tokens, so the bench tunes every complication at once.

## Odometer digits that roll with a carry

Each wheel shows its digit in a window. When the count changes, each wheel whose digit changed rolls: the old digit leaves upward while the new one rises in from below. A carry ripples from the rightmost wheel to the left, `--ik-stagger` apart.

```tsx
const clip = useId().replace(/[^\w-]/g, "")
const wheels = String(count).padStart(4, "0").split("")
const before = String(previous).padStart(4, "0").split("")
const turning = wheels.filter((digit, index) => digit !== before[index]).length

<defs><clipPath id={clip}><rect x={0} y={0} width={WINDOW.w} height={WINDOW.h} rx={2} /></clipPath></defs>
<g clipPath={`url(#${clip})`}>
  {wheels.map((digit, index) => (
    <g key={`${index}-${count}`} className="roll-wheel" style={{ "--i": wheels.length - 1 - index } as CSSProperties}>
      {digit !== before[index] && <text className="ik-screen-text roll-out" x={index * PITCH + 4} y={WINDOW.h - 4}>{before[index]}</text>}
      <text className={`ik-screen-text${digit !== before[index] ? " roll-in" : ""}`} x={index * PITCH + 4} y={WINDOW.h - 4}>{digit}</text>
    </g>
  ))}
</g>
```

```css
.fig-x .roll-in { animation: x-roll-in var(--ik-t-state) var(--ik-ease) calc(var(--i) * var(--ik-stagger)) both; }
.fig-x .roll-out { animation: x-roll-out var(--ik-t-state) var(--ik-ease) calc(var(--i) * var(--ik-stagger)) both; }
@keyframes x-roll-in { from { transform: translateY(9px); } }
@keyframes x-roll-out { to { transform: translateY(-9px); } }
@media (prefers-reduced-motion: reduce) { .fig-x .roll-out { display: none; } }
```

Sound: `playSound("roll", { count: turning, stagger: 0.05 })`. Keep `previous` in state beside `count`. Reduced motion stops the roll, so the old digit would sit on top of the new one: hide it.

## A needle that overshoots and settles

A gauge needle swings to its new reading on the kit's spring, so it overshoots a little and comes to rest. Put the pivot at the origin with a `transform` attribute, and rotate an inner group with CSS.

```tsx
<g transform={`translate(${PIVOT.x} ${PIVOT.y})`}>
  <g className="needle" style={{ "--turn": `${angle}deg` } as CSSProperties}>
    <path className="ik-live" d={`M0 0L0 ${-NEEDLE}`} />
  </g>
  <circle className="ik-dot" r={1.6} />
</g>
```

```css
.fig-x .needle { transform: rotate(var(--turn)); transform-origin: 0 0; transition: transform var(--ik-t-spring) var(--ik-spring); }
```

The overshoot is about 3 % of the swing: deliberate and small. Sound: the reading's own result sound when it settles. A `tick` as it leaves its stop is optional.

## A dial with detents

Each press turns the dial one detent. It snaps fast and ticks once.

```css
.fig-x .dial { transform: rotate(calc(var(--step) * 30deg)); transform-origin: 0 0; transition: transform var(--ik-t-press) var(--ik-ease-out); }
```

Sound: `playSound("tick")` on every step. Ticks are throttled to one every 30 ms, so a quick run of presses stays clean. Draw a short `ik-detail` mark at every detent around the dial: the marks are the texture.

## A relay that clicks before the light

The press closes a switch, and the lamp lights a beat later. The armature is a short line that flips a few degrees, and the lamp's `Glow` turns on after `--ik-t-press`.

```tsx
<g transform={`translate(${ARM.x} ${ARM.y})`}><g className="armature"><path className="ik-line" d="M0 0h8" /></g></g>
<Glow on={on}><circle className={on ? "ik-dot lamp" : "ik-fill lamp"} cx={LAMP.x} cy={LAMP.y} r={2.4} /></Glow>
```

```css
.fig-x .armature { transform-origin: 0 0; transition: transform var(--ik-t-press) var(--ik-ease-out); }
.fig-x svg[data-on="true"] .armature { transform: rotate(-9deg); }
.fig-x .lamp { transition: fill var(--ik-t-state) var(--ik-ease) var(--ik-t-press); }
```

Sound: `playSound("relay")` on the press, then the result sound as the lamp lands.

## A latch that catches, then seats

A lid or door travels nearly shut, then a catch slides home. The catch is a small box that moves in once the lid has landed.

```css
.fig-x .lid { transition: transform var(--ik-t-move) var(--ik-ease); }
.fig-x .catch { transition: transform var(--ik-t-state) var(--ik-ease-out) var(--ik-t-move); }
```

Sound: `latch`, timed to the landing with one timer in a ref: `landing.current = window.setTimeout(() => playSound("latch"), LID_MS)`. Clear it on the next press and on unmount.

## A motor that runs while the drive moves

A belt, a lead screw or a fan turns only while the machine moves, and the motor hums for exactly that long.

```tsx
stopMotor.current()
stopMotor.current = playSound("motor", { duration: TRAVEL_MS / 1000 })
```

```css
.fig-x .fan { transform-origin: 0 0; }
.fig-x svg[data-moving="true"] .fan { animation: x-spin var(--ik-t-move) linear; }
@keyframes x-spin { to { transform: rotate(360deg); } }
```

Keep the motor's `stop` in a ref; cut it when a newer action starts and on unmount.

## A gear train at a ratio

Two or three gears on one face turn together. The driven gear turns the other way, by the ratio of their teeth.

```tsx
<g transform={`translate(${DRIVER.x} ${DRIVER.y})`}><g className="gear" style={{ "--turn": `${angle}deg` } as CSSProperties}>{teeth(DRIVER.teeth, DRIVER.r)}</g></g>
<g transform={`translate(${DRIVEN.x} ${DRIVEN.y})`}><g className="gear" style={{ "--turn": `${(-angle * DRIVER.teeth) / DRIVEN.teeth}deg` } as CSSProperties}>{teeth(DRIVEN.teeth, DRIVEN.r)}</g></g>
```

```css
.fig-x .gear { transform: rotate(var(--turn)); transform-origin: 0 0; transition: transform var(--ik-t-move) var(--ik-ease-move); }
```

Teeth are repetition: short `ik-detail` ticks around a circle, built once as a module constant. Sound: `motor` for the length of the turn, or `tick` per tooth for a hand-cranked train.

## A dimension that follows the part

In blueprint, a dimension can be the read-out. When a lid opens, its height dimension slides to the new value and relabels. `Dimension` moves its end and label with CSS transforms on `--ik-t-move`, so match the part's travel to it.

```tsx
import { Dimension } from "react-isokit/drafting"

<Dimension from={[CASE.w, 0, 0]} to={[CASE.w, 0, CASE.h + lift]} offset={[12, 0, 0]} label={`h ${CASE.h + lift}`} />
```

It shows only in a look that turns drafting on, so the figure must still read without it.

## Exploded parts that assemble

Recipes covers the motion (`Exploded layers that assemble`). The complication is the sound: `cascade` with the same count and stagger as the drop, then `latch` when the last layer seats.
