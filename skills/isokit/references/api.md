# react-isokit API, for agents

```tsx
import { Box, Glow, Plate, Press, SoundToggle, configureSound, playSound, path, project, top, front, side, type Box3, type Vec3 } from "react-isokit"
import { Callout, Dimension } from "react-isokit/drafting"
import "react-isokit/styles.css"
import "react-isokit/themes.css"
```

Import the stylesheet once, at the app root. `themes.css` is optional: it adds the looks and the drafting layer, and goes after `styles.css`.

## World

- `+x` runs down-right, `+y` down-left, `+z` up. True isometric, no perspective.
- A box is `{ x, y, z, w, d, h }`: its back-left-bottom corner and its size along x, y and z.
- `project(x, y, z)` gives the screen point `[sx, sy]` in viewBox units.

## `<Plate label fit aspect pad viewBox fig name hint readout credit theme look>`

The plate and its `<svg>`, a group named by `label` (required; pass `role="img"` for a figure with nothing to press). `fit` takes boxes and `[x, y, z]` points and frames them; `aspect` is width over height (default 1.25). `fig`, `name`, `hint`, `readout` are the four corner captions; `readout` is a polite live region. Any other prop lands on the `<svg>`: put state there as `data-*` attributes and style descendants from CSS (`.my-figure svg[data-live="true"] .block { … }`). `theme`: unset follows a `.dark` / `[data-theme="dark"]` ancestor, or `"light"`, `"dark"`, `"system"`. `look`: `"blueprint"`, `"paper"` or `"phosphor"` from `themes.css` (or your own), each in a light and a dark version; a `data-look` attribute on any ancestor works the same. Blueprint lays world-aligned isometric graph paper under the figure and shows the drafting layer.

`credit` defaults to `true`: the plate includes a small linked “Made with isokit · pushary.com” footer. Use `credit={false}` to omit it. It stays outside the SVG and live region; capture the whole plate when sharing its rendered appearance.

## `<Box x y z w d h r className top front side>`

A rounded box: hull outline, darker right side, lighter lid. `r` is the footprint corner radius. `top`, `front`, `side` are drawn on those faces in flat local coordinates:

| Face | Looks | Local x | Local y | Origin |
| --- | --- | --- | --- | --- |
| `top` | up | +x | +y | back-left corner, at z + h |
| `front` | lower-left | +x | down (−z) | top-left corner of the y + d face |
| `side` | lower-right | from the front edge toward −y | down (−z) | top-front corner of the x + w face |

`children` are drawn after the box in screen space.

## `<Press label onPress sound material disabled className>`

A focusable button part. Wrap exactly one `<g>` holding the boxes that move: `<Press …><g><Box …/></g></Press>`. It sets `data-down` while held; the `<g>` sinks `--ik-travel` (2 units; set it on the Press for a deeper key) in `--ik-t-press`, springs back on release, and every face inside turns live. `material` is `"plastic"` (default), `"metal"`, `"rubber"`, `"glass"` or `"paper"`: it shapes the click. The part's size sets the pitch and its position sets the stereo pan, measured when it is pressed. Add `className="ik-lift"` for parts that should lift rather than sink, and style `.ik-lift[data-down="true"] > g` yourself. `sound={false}` silences the press clicks (play your own instead). Extra props, `data-*` included, land on the `<g role="button">`.

## `<Glow on className>`

Light coming off something that is switched on. It draws its children twice more underneath as a halo that ignites in `--ik-t-glow-on` and fades over `--ik-t-glow-off`. Wrap small emitters only (an LED, an awake screen's text, a signal): never faces, pressable parts, or anything with an `id`. `--ik-glow` colours it, `--ik-glow-size` sets its spread (text gets half of it, so screen text stays crisp), `--ik-glow-strength` (0 on light themes, 1 on dark) sets how much shows, `--ik-glow-delay` holds the halo back when the light it belongs to arrives late through a CSS delay (also when the Glow mounts already on), and `--ik-glow-fade-delay` holds back its fade. They all inherit, so set them on the Glow's parent or in your figure's CSS; never style the halo's own classes. On light themes "lit" is the darker fill you give the child.

## Drafting: `react-isokit/drafting`

- `<Dimension from to offset label>`: a dimension line between two world points, standing off by `offset` (world units), with witness lines and arrowheads. Its end and label slide on `--ik-t-move` when `to` moves along the same line, so the label can be a read-out (`h 42` → `h 64`). Labels always read left to right or bottom to top.
- `<Callout at dx dy label>`: a dot on a world point, a leader to `(dx, dy)` in viewBox units, a short shelf and a label.
- Both carry `ik-drafting` and show only when `--ik-drafting` is set, which `themes.css` does in blueprint. Draw them last. Labels are 5.5 units; set `--ik-drafting-size` on the plate for a large figure.

## Planes, for drawing outside a box

`top(x, y, z)`, `front(x, y, z)`, `side(x, y, z)` return a `transform` string. `<g transform={front(…)}>…</g>` puts anything in that plane. Never put a CSS `transform` on an element that has a `transform` attribute: wrap it in another `<g>` and move that.

`path([[x, y, z], …])` is an open path through world points, for cables and guides; give it the class `ik-line`. `curve(a, b, c, d, steps)` returns points along a cubic Bézier, so a cable is `path(curve(…))`.

## Classes

`ik-face` `ik-top` `ik-tint` (solids) · `ik-edge` (a Box's silhouette) · `ik-detail` (dim lines) · `ik-line` (structure lines) · `ik-live` (the one bright stroke) · `ik-dash` (guides) · `ik-well` (recesses) · `ik-fill` (solid marks) · `ik-dot` (bright dot) · `ik-screen` `ik-screen-text` `ik-screen-line` (displays) · `ik-label` (engraved text) · `ik-thick` (heavier stroke) · `ik-dim` (half strength) · `ik-enter` `ik-pulse` `ik-blink` `ik-float` `ik-loop` (motion).

Colour: `--ik-panel --ik-top --ik-front --ik-side --ik-well --ik-line --ik-detail --ik-live --ik-ink --ik-ink-hi --ik-screen --ik-screen-ink --ik-screen-font --ik-border`, and for light `--ik-glow --ik-glow-size --ik-glow-strength`.

Line weights: `--ik-weight-edge` (silhouettes, 1.4) · `--ik-weight-crease` (creases and lines, 1) · `--ik-weight-fine` (inner marks, 0.75).

Motion, one scale for every figure:

| Token | Default | Use |
| --- | --- | --- |
| `--ik-ease` | `cubic-bezier(.32, .72, 0, 1)` | Discrete changes of state |
| `--ik-ease-out` | `cubic-bezier(.23, 1, .32, 1)` | Things arriving, hover |
| `--ik-ease-move` | `cubic-bezier(.65, 0, .35, 1)` | Travel across the figure |
| `--ik-ease-fall` | `cubic-bezier(.55, 0, 1, .45)` | Things dropping under gravity |
| `--ik-spring` | a `linear()` spring, bounce 0.25 | Settling: release, needles, landings |
| `--ik-t-press` | 50ms | A part going down |
| `--ik-t-hover` | 150ms | Hover and focus colour |
| `--ik-t-state` | 260ms | A surface changing |
| `--ik-t-move` | 700ms | A part travelling, a sequence step |
| `--ik-t-spring` | 560ms | How long `--ik-spring` takes to settle |
| `--ik-t-glow-on` / `--ik-t-glow-off` | 90ms / 400ms | Light igniting and fading |
| `--ik-stagger` | 50ms | Between neighbours in a sequence |
| `--ik-travel` | 2px | How far a Press sinks |

Looks (`themes.css`) are written as five colours per scheme on any element with `data-look`: `--ik-paper-light --ik-pen-light --ik-live-light --ik-glow-light --ik-accent-light --ik-strength-light` and the same with `-dark`. Every face tone is mixed from them, and `--ik-accent` is there for parts that really have a colour.

Size `ik-label` text with CSS `font-size`, not the `fontSize` attribute: the class sets a `font` shorthand, and CSS wins over presentation attributes.

## Validation

All input types come from zod schemas in `react-isokit/schema` (`box3Schema`, `vec3Schema`, `fitSchema`, `soundConfigSchema`, `soundOptionsSchema`, `soundNameSchema`, `describe`). In development the components warn in the console about bad boxes, frames and sounds: read the console when you check a figure, and fix every `react-isokit:` warning. If a figure's data comes from JSON or another tool, validate it with the schemas before drawing.

## Sound

- Off until the app calls `configureSound({ defaultOn: true })` once, or the reader presses a `<SoundToggle />`.
- `playSound(name, options?)` returns `stop()`. Names: `press release toggle boot success error notify complete cascade whoosh paper process done`, and the mechanical complications `tick latch relay motor charge roll beep`. `motor` and `charge` take `duration`: how long the motor runs, or how long the charge whine climbs before it cuts.
- Options: `material` (shapes press and release), `pan` (-1 to 1) and `size` (the part's share of the plate, 0 to 1; bigger is lower), which Press fills in for you; `duration` (seconds the motor holds); `count`, `stagger`, `delay` for cascade and roll.
- `tick` and `roll` are throttled to one every 30 ms.
- `playSound("cascade", { count, stagger, delay })` lands `count` rising tocks `stagger` seconds apart starting at `delay`, then a small bell: match it to a staggered CSS animation.
- Sounds asked for before the reader has interacted with the page are dropped, never queued.

## Guided motion, for first-time readers

```tsx
import { Cursor, Flight, Ripple, Signal, useDemoTap } from "react-isokit"
```

- `useDemoTap(onTap, { delay, threshold })` → `{ ref, phase, dismiss, plate }`. The first time the figure is mostly in view, a cursor presses the part marked `data-hot` and calls `onTap` (keep it silent). Put `ref` on a `<g>` inside the svg, spread `plate` onto `Plate`, pass `phase` to `Cursor`. The reader pressing or typing anywhere in the figure dismisses it; call `dismiss()` from your press handlers too. It never plays under reduced motion or without IntersectionObserver, and scrolling away before the press cancels it. Stagger `delay` for figures shown side by side. In a codebase linted by the React compiler (`react-hooks/refs`), destructure the result (`const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(...)`): reading a field of an object that also carries a `ref` counts as reading a ref during render.
- `<Cursor at={[x, y, z]} phase size />`: the pointer. A fixed world point on the part (the middle of its lid). Draw it last.
- `<Ripple x y z w d r />`: a ring breathing out from a footprint at height z, drawn just before the key it marks. For a key on an upright face, put `<Ripple inFace x y w d r />` inside that Box's `front` or `side`: it draws in the face's own coordinates. Render it until the reader's first press and hide it while `phase` is `aim` or `press`.
- `<Signal points delay duration />`: a dash that runs once from the first world point to the last. New `key` to run again; the result lands at `delay + duration`.
- `<Flight from to delay duration lift>children</Flight>`: carries children drawn at `from` along an arc to `to`, then hides them. Hide the part at `from` at `delay` and show it at `to` at `delay + duration` with a CSS `transition-delay`, not a timer.
- All of them ignore the pointer, sleep offscreen and calm down under reduced motion. `delay` and `duration` are milliseconds here; sound options are seconds.
