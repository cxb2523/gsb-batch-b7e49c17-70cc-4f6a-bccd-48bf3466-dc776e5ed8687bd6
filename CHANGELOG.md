# react-isokit

## 0.6.0

### Minor Changes

- [#34](https://github.com/aadilghani1/isokit/pull/34) [`054dfee`](https://github.com/aadilghani1/isokit/commit/054dfee289541fd3b488e20fbd4e6cc9cf3e8070) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Add `charge`, an electric whine that climbs for `duration` seconds and cuts: for something that charges before it fires, such as a capacitor, a flash or a reactor core. Land the light as it cuts.

## 0.5.0

### Minor Changes

- [#30](https://github.com/aadilghani1/isokit/pull/30) [`61ca83a`](https://github.com/aadilghani1/isokit/commit/61ca83a15c13e56b1ea725753bc49c9bc48c3c4a) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Light, looks, drafting and a fuller sound palette.
  
  - `Glow` gives things that are switched on a soft halo that ignites fast and fades slowly, without CSS filters, so it works in Safari.
  - `react-isokit/themes.css` adds the blueprint, paper and phosphor looks, each in light and dark, set with `look` on `Plate` or `data-look` on any ancestor. Blueprint lays world-aligned isometric graph paper under the figure.
  - `react-isokit/drafting` adds `Dimension` and `Callout`, shown in blueprint; a dimension slides with the part it measures.
  - `Press` takes a `material` (plastic, metal, rubber, glass, paper); its click follows the material, the part's size and its position in the figure.
  - Six new sounds for mechanisms: `tick`, `latch`, `relay`, `motor`, `roll`, `beep`. `playSound` takes `duration`, `material`, `pan` and `size`.
  - Motion is one scale of tokens (`--ik-ease-out`, `--ik-ease-move`, `--ik-ease-fall`, `--ik-t-*`, `--ik-stagger`, `--ik-travel`), and `--ik-spring` is now a real spring written as CSS `linear()`, with the old curve as the fallback.
  - `Box` draws its silhouette at `--ik-weight-edge`, heavier than creases and inner marks, and evenly all the way round.
  - A press sinks 2 units instead of 3, disabled parts draw in the detail ink, and reduced motion keeps short fades instead of cutting everything.
  - The plate credit stays readable when the host page styles links.

- [#24](https://github.com/aadilghani1/isokit/pull/24) [`a075f8d`](https://github.com/aadilghani1/isokit/commit/a075f8deefe52a2e1f0c355e5a25b0d5fb77a80e) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Add a small linked maker credit to Plate by default. Use credit={false} to omit it. Keep the drawing in its own grid row so plates without captions retain the correct layout.

### Patch Changes

- [#31](https://github.com/aadilghani1/isokit/pull/31) [`f787ea1`](https://github.com/aadilghani1/isokit/commit/f787ea19c1066ec8cacd6cece65c915188bf6e7c) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Keep every colour a look sets in oklab, so a figure's one-sided colour keyframe (`from { fill: var(--ik-well) }`) no longer renders near-black in blueprint, paper or phosphor in Chrome.

## 0.4.0

### Minor Changes

- [#18](https://github.com/aadilghani1/isokit/pull/18) [`5e92136`](https://github.com/aadilghani1/isokit/commit/5e92136f68c195a0408807ae96607328039551a6) Thanks [@aadilghani1](https://github.com/aadilghani1)! - `<Ripple inFace>` draws its ring in the coordinates of the face it sits in, so a key on an upright face (inside a `Box`'s `front` or `side`) can be marked without an inverse matrix. `z` is now optional, defaulting to 0.

### Patch Changes

- [#18](https://github.com/aadilghani1/isokit/pull/18) [`5e92136`](https://github.com/aadilghani1/isokit/commit/5e92136f68c195a0408807ae96607328039551a6) Thanks [@aadilghani1](https://github.com/aadilghani1)! - `Plate`'s grid has an explicit `minmax(0, 1fr)` column. A plate given a fixed height can no longer have its drawing widen the column past the plate's own edge.

- [#16](https://github.com/aadilghani1/isokit/pull/16) [`db1c65b`](https://github.com/aadilghani1/isokit/commit/db1c65b74215a613e2abc42bb8fd5666b9ef7859) Thanks [@aadilghani1](https://github.com/aadilghani1)! - The source is reorganised into small modules with one job each: geometry, components, guided motion and sound (store, player, engine, recipes, voices). The public API is unchanged.
  
  - `frame` fits boxes in a single pass, with no array spreads, so a large `fit` can no longer overflow the stack.
  - `Box` recomputes its outline only when its numbers change.
  - Sound state lives in two lazily created module singletons, and the engine chunk still imports nothing at runtime from the main entry.
  - The type declarations no longer carry doc comments. The props and usage for every component are on the docs site.

## 0.3.0

### Minor Changes

- [#14](https://github.com/aadilghani1/isokit/pull/14) [`246319f`](https://github.com/aadilghani1/isokit/commit/246319f0cc7a4ce2339f7278bc6e28af9bbb0ec0) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Guided motion, so a first-time reader sees what to press and what pressing does.
  
  - `useDemoTap(onTap, { delay, threshold })` presses a figure's hot part once, silently, the first time it is mostly in view, then hands it over. It cancels if the figure leaves view before the press, stops for good when the reader presses or types in the figure, and never plays under reduced motion or without IntersectionObserver.
  - `<Cursor>`, `<Ripple>`, `<Signal>` and `<Flight>`: the demo's pointer, a "press here" ring, a dash that runs along a path, and a part carried along an arc between two world points. None of them catch the pointer, and all sleep offscreen.
  
  Also:
  
  - Your own `onPointerDown`, `onPointerUp`, `onPointerLeave` and `onPointerCancel` on `Press` now run after its own handlers instead of replacing them, and a part that became disabled while held no longer acts when released.
  - `Plate` renders its live region whenever a `readout` is passed, even as `null`, so the first announcement is read.
  - The sound engine waits for the longest scheduled sound before suspending, so a delayed cascade is no longer cut off.
  - Only the main entry carries `"use client"`: `react-isokit/schema` can be imported from server code again.

## 0.2.2

### Patch Changes

- [#12](https://github.com/aadilghani1/isokit/pull/12) [`808ace4`](https://github.com/aadilghani1/isokit/commit/808ace48005b6d819c8b9299823712e2eaacd098) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Keyboard focus is visible on parts that are already live. 0.2.1 stopped host pages' focus rings from drawing around pressed parts and relied on the live stroke alone, so a `data-hot` key (or one a figure marks as picked) looked the same focused or not. A focused part's faces now also draw at a heavier stroke.

## 0.2.1

### Patch Changes

- [#10](https://github.com/aadilghani1/isokit/pull/10) [`a313c70`](https://github.com/aadilghani1/isokit/commit/a313c709217f8eceb4b6c290662b9210d8c577e6) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Production builds no longer run the development checks. The library was built for the browser platform, which inlined `process.env.NODE_ENV` at build time, so every app loaded the zod schemas and validated each box on every render. The published code now leaves `process.env.NODE_ENV` for your bundler, and a post-build check keeps it that way.
  
  Also:
  
  - A `Press` held from the keyboard comes back up when focus leaves it, instead of staying down.
  - `Plate` renders its svg as a labelled `group` instead of an `img`, since an image's children are presentational and a figure holds buttons. Pass `role="img"` for a figure with nothing to press.
  - A host page's `:focus-visible` outline no longer draws a misplaced box around a focused part; focus shows as the live stroke.
  - Looping animations sleep offscreen even when a figure sets its own `animation` shorthand.

## 0.2.0

### Minor Changes

- [`73b449d`](https://github.com/aadilghani1/isokit/commit/73b449d684294082dbb60acb77cb6764af87c904) Thanks [@aadilghani1](https://github.com/aadilghani1)! - Runtime validation and a stricter type setup.
  
  - New `react-isokit/schema` entry: zod schemas for boxes, points, framing and sound settings (`box3Schema`, `vec3Schema`, `fitSchema`, `soundConfigSchema`, `soundOptionsSchema`, `soundNameSchema`) and a readable `describe(error)`. Every public type is now inferred from them.
  - In development, `Plate`, `Box`, `frame`, `playSound` and `configureSound` check what they are given and explain problems once in the console. Production builds skip the checks entirely and clamp bad input instead of breaking.
  - New `curve(a, b, c, d, steps)` helper for cables and rails.
  - Built with tsdown; the type setup now uses `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, with type tests.

## 0.1.0

First release.

- `Plate`, `Box` and `Press`: frame a figure, draw rounded boxes with faces you can draw on, and make parts that press like real keys.
- `frame`, `project`, `top`, `front`, `side`, `path`, `outline`: the isometric geometry underneath.
- Thirteen synthesized interaction sounds, off until a page opts in, loaded only on intent, and suspended when idle.
- A Claude Code skill, `isokit`, that draws interactive figures with the kit and checks them in a browser.
