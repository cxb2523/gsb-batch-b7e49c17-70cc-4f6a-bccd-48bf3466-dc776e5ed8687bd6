# AGENTS.md

How to work in this repository. Read it before you change anything. It holds the rules, the map, and the reasons that would otherwise be code comments.

## What lives here

- **`react-isokit`** (`src/`): a small React kit for true-isometric line figures you can press, with optional synthesized sound. Published to npm.
- **The figure studio** (`examples/demo/`): the docs site and a gallery of figures across industries and levels. It is also the workshop where new figures are made.
- **The isokit skill** (`skills/isokit/`): what a coding agent reads to draw a figure with the kit, in any repo.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | The studio at http://localhost:5173, importing the kit from `src/` |
| `npm run check` | Everything CI runs: lint, types, tests, build, dist check, publint, attw, size budgets |
| `npm run demo:build` | Builds the studio for GitHub Pages |
| `npm run new:figure -- --industry <id> --slug <kebab> --level <1-4>` | Scaffolds a working figure from the level's template (Node 22.6 or newer) |
| `npx vitest run test/figure-catalog.test.tsx` | Checks every figure's meta, then renders every figure on the server |
| `node skills/isokit/scripts/shoot.mjs <url> --selector <plate> --click "<label>"` | Screenshots a figure in light and dark at 1280 and 390 px, and fails on console errors or a dead read-out |
| `npm run dev`, then `#/bench` | The tuning bench, in development only: DialKit dials for every motion, light, line and look token and the sound materials, on a live figure, with copy-as-CSS |

## Map

```
src/
  index.ts                    the public API; nothing else is public
  schema.ts                   zod schemas, the source of every public type; also the react-isokit/schema entry
  styles.css                  every --ik-* token and ik-* class, at zero specificity
  themes.css                  the looks (blueprint, paper, phosphor) and the drafting layer's styles; the react-isokit/themes.css entry
  drafting.ts                 the react-isokit/drafting entry: Dimension, Callout, dimension
  class-names.ts              joins class names
  environment.ts              browser feature guards: window, IntersectionObserver, reduced motion, user activation
  development-checks.ts       schema checks that run only in development and warn once per problem
  geometry/                   pure math, no React, no DOM
    projection.ts             project, the three face planes (top, front, side), path
    framing.ts                frame and corners: the viewBox that fits a pose
    rounded-outline.ts        hull, outline, radius: the silhouette of a rounded box
    curve.ts                  cubic Bézier sampling for cables and rails
    grid.ts                   the isometric graph-paper tile and the sheet it covers
    dimension.ts              where a dimension line sits, its angle, and its witness lines
    round.ts                  rounding to three decimals for SVG output
  components/                 Plate, Box, Press, Glow, SoundToggle
  drafting/                   Dimension, Callout
  guided-motion/              useDemoTap, Cursor, Ripple, Signal, Flight
  sound/
    sound-store.ts            the reader's preference and page settings (module singleton)
    sound-player.ts           configureSound, primeSound, playSound; loads the engine on intent
    sound-placement.ts        a pressed part's stereo pan and size, from its box on screen
    use-sound-enabled.ts      the React hook over the store
    sound-engine.ts           the AudioContext graph, a lazy chunk (module singleton)
    sound-recipes.ts          the twenty sounds as data over the voices
    sound-materials.ts        how plastic, metal, rubber, glass and paper press and release
    sound-voices.ts           tone, noise and bell: the synthesis primitives
test/                         vitest; DOM tests opt in with the jsdom pragma
examples/demo/src/
  main.tsx                    mounts the site and starts the theme store
  app/                        the shell: site (router), site-header, site-footer, links, copy-command, theme-store, route-store
  pages/                      one file per page: home, figures, figure, components, sound, studio, design-system, bench (development only)
  bench/                      the bench's panels, value-to-CSS conversion and the spring-to-linear() generator
  catalog/                    data only, no layout
    industries.ts             industries and their briefs; no imports, so the scaffold script can load it
    levels.ts                 the four levels; no imports, same reason
    figure-meta.ts            the FigureMeta contract; uses is typed against the kit's real exports
    figure-registry.ts        finds every figure, validates it in development, builds the lookup Maps once
    figures-by-doc.ts, component-docs.ts, sound-docs.ts
  component-examples/         one live example per component page, looked up through examples-by-slug
  figures/<industry>/<slug>.tsx + <slug>.css
  styles/                     base.css and site.css
scripts/                      check-dist.mjs, new-figure.ts and figure-templates/ (one template per level)
skills/isokit/                SKILL.md, references (api, levels, rules, recipes, complications), shoot.mjs
```

## Code rules

1. **No comments.** No `//`, `/* */`, JSDoc, `{/* */}` or CSS comments. Names carry intent. A reason that cannot become a name goes in the "Why it is this way" section below, or in the docs. Tool pragmas are not comments and stay: `// @vitest-environment jsdom`, `// @ts-expect-error`.
2. **Readable file names.** Use kebab-case names that say what is inside: `use-demo-tap.ts`, `rounded-outline.ts`, `figure-registry.ts`. Put one concern in each file. A figure's file name is its slug, and its folder is its industry.
3. **Separation of concerns.**
   - Geometry is pure functions over numbers.
   - Components render and call geometry; they never hold math of their own.
   - Sound is split into preference (store), gating and loading (player), audio graph (engine), data (recipes) and primitives (voices).
   - In the studio, catalog files hold data, pages hold layout, app holds the shell and its stores, and a figure holds one object.
4. **Reuse before you write.**
   - `classNames`, `round3`, `cornerRadius`, the environment guards, `project`/`top`/`front`/`side`/`path`/`curve`.
   - The guided-motion pieces for any "press here", demo, signal or flight.
   - The registry `Map`s for any lookup.

   A second copy of any of these is a bug.
5. **State and memory.**
   - A figure holds its state in a few `useState`s, or one `useReducer` at level 4. No global state in figures.
   - Every timer lives in a ref and is cleared on the next action and on unmount.
   - Every listener and observer is removed in its effect's cleanup.
   - Keep the stop function `playSound` returns, and call it when a newer action replaces the sound.
   - Nothing reads `window` or `document` during render. The catalog test renders every figure in Node to prove it.
   - Static objects (options, frozen props, thresholds) are module constants, so their identity is stable.
6. **Singletons.**
   - An ES module is the singleton. Its state lives in module scope, is created lazily on first use, and is reached only through the module's functions.
   - Nothing touches a browser API at import time.
   - Examples: `sound-store`, the engine loader in `sound-player`, the audio graph in `sound-engine`, the schema loader in `development-checks`, and the studio's `theme-store` and `route-store`.
   - Write a factory only when a test needs to inject a dependency. No classes.
7. **Time and space.**
   - Render paths are linear in the number of parts.
   - Lookups by key use a `Map` built once at module load; render never runs `.find` or `.filter` scans.
   - Extents take a single pass. Never `Math.min(...array)`: it allocates, and throws on large inputs.
   - Memoize only pure geometry with primitive dependencies (`Box`'s outline). Never memoize on array identity.
   - Prefer CSS transitions with delays over JS timers; a sound that lands later is the one place for a timer.
   - Nothing grows per press: counters cycle and lists reset.
8. **Size budgets** (brotli, enforced by `npm run size`):

   | Bundle | Budget | Now |
   | --- | --- | --- |
   | Core (Plate, Box, Press, frame) | 3.5 kB | 3.17 kB |
   | Main entry | 5.25 kB | 4.91 kB |
   | Sound engine | 2.75 kB | 2.63 kB |
   | Drafting | 1 kB | 0.92 kB |
   | CSS | 2.75 kB | 2.59 kB |
   | Themes CSS | 1 kB | 0.90 kB |

   The sound engine chunk imports types only from the rest of `src/`. One runtime import from the main chunk makes size-limit count the whole entry, and the lazy split is lost.
9. **The public API is stable.**
   - It is exactly what `src/index.ts` exports.
   - A change needs a changeset, an update to `skills/isokit/references/api.md`, and an update to the studio's component docs, in the same pull request.
10. **Tests.**
    - No global monkey-patching: no stubbed `IntersectionObserver`, `matchMedia` or timers on `globalThis`.
    - Inject a dependency or test through public behaviour.
    - Geometry changes come with a test, and an optimization comes with an equivalence test against the plain version (see the `frame` test).
11. **Commits and pull requests.**
    - Conventional subjects (`feat:`, `fix:`, `chore:`, `docs:`), authored with `aadilghani1@gmail.com`.
    - No AI trailers: no `Co-Authored-By` lines for an assistant, no "Generated with" footers.
    - Library changes carry a changeset.
    - Nothing merges without the maintainer's explicit go, because merging releases to npm and redeploys the studio.

## The figure studio

New figures come from a matrix of **industries** (`examples/demo/src/catalog/industries.ts`) and **levels** (`examples/demo/src/catalog/levels.ts`). The `#/studio` page shows the matrix: built figures link to their pages, and open briefs show the command that starts them.

### Levels

| Level | Name | What it adds | State | Example |
| --- | --- | --- | --- | --- |
| 1 | Tap | One press, one surface changes, a read-out | one `useState`, no timers | tally counter |
| 2 | Cause and effect | A `Signal` or moving part carries the press to a separate result that lands later | one or two `useState`s, at most one timer | feature flags |
| 3 | Sequence | Several parts move in a staggered order with progress on a screen | a step count, timers in a ref | cryo stack |
| 4 | System | Several controls or modes, a state machine, a `Flight` between stations, a reset cycle | one `useReducer` | pick and place |

Choose the lowest level that tells the story. `skills/isokit/references/levels.md` has the full recipe for each.

### Making a figure

1. Pick an open brief at `#/studio`, or add one to `industries.ts`. A brief is one line: "Object. What the pointer presses. What changes, and what the read-out says."
2. `npm run new:figure -- --industry fintech --slug card-terminal --level 2`. You get a working figure at the right level to reshape.
3. Follow `skills/isokit/SKILL.md`: boxes as constants, back-to-front paint order, wiring, framing.
4. Verify: `npm run check`, the catalog test, and `shoot.mjs` in light and dark at 1280 and 390 px. Look at every picture against `skills/isokit/references/rules.md`.
5. The brief turns into a built figure by itself: the registry finds the file by its slug.

### Figure contract

- Exports `meta` (`slug`, `title`, `industry`, `level`, `blurb`, `uses`, `sounds`) and a default component. `uses` lists real exports of `react-isokit`, and `sounds` lists the sounds it plays.
- The file is `figures/<industry>/<slug>.tsx`, and the CSS beside it is scoped under `.fig-<slug>`. A bare class name collides with the host page.
- At rest exactly one thing is live, and it moves to what was pressed. A `Ripple` marks the first part to press until the reader presses anything.
- `useDemoTap` presses the hot part once, silently, the first time the figure is mostly in view.
- Every press writes the read-out: terse, lowercase, dot-separated.
- Sounds play only for what the reader caused, at the moment the visual change happens.
- `fit` covers the most extreme pose. Faces are opaque, and nothing leaves the plate.
- It reads in light and dark through the `--ik-*` tokens. Never hard-code a colour.
- Motion is timed with the kit's tokens (`--ik-t-*`, `--ik-ease*`, `--ik-spring`, `--ik-stagger`), never literal durations or curves for a kind of motion the kit names.
- Anything switched on that gives off light sits in `<Glow on>`. Every `Press` names its `material`.
- Complications follow `skills/isokit/references/complications.md`: caused, sounded, and capped by level.
- It reads in every look from `themes.css`, light and dark.

## Why it is this way

These are the reasons behind code that looks odd. Each one cost a bug to learn.

### Rendering

- **`useDemoTap` observes the figure's `<svg>`, not the element its ref is on.** IntersectionObserver reports an unreliable box for an SVG `<g>` (about twice too big), so a 0.6 threshold never fired.
- **A very tall figure only has to fill the viewport.** The threshold is capped at `viewport height / figure height`.
- **`Signal` has no `vector-effect: non-scaling-stroke`.** That property measures dashes in screen pixels and ignores `pathLength`, so the dash stuck mid-cable. The dash starts and ends fully off the path, so no end cap is left behind.
- **`Flight` is two nested groups.** The outer moves along x, and the inner rises and falls with its own easing. Two independent easings are what make an arc instead of two straight lines.
- **The decorative guided-motion pieces have `pointer-events: none`.** An element at opacity 0 still catches clicks, so an invisible flight intercepted presses.
- **`Plate`'s svg has `role="group"`, not `img`.** A figure holds buttons, and an image's children are presentational. Pass `role="img"` for a figure with nothing to press.
- **`Plate` renders its live region whenever `readout` is passed, even as `null`.** The region has to exist before its first announcement, or that announcement is never read.
- **Presses have `outline: none`, and focus thickens the faces' stroke.** A host focus ring is drawn around the transformed group's bounding box, not the part. The heavier stroke keeps focus visible on a part that is already the live one.
- **`.ik-plate:not([data-awake])` pauses loops with `!important`.** A figure's own `animation` shorthand resets the play state, so loops would never sleep offscreen.
- **Reduced motion lands everything at once.** Animations stop and transitions take 0 ms. `useDemoTap` never runs under reduced motion.

- **Glow draws its children three times instead of using a filter.** Safari ignores CSS filters on SVG children, and an SVG filter on a moving part repaints on the CPU every frame. Two halo copies with wide strokes (a faint outer one and a brighter core) read as bloom and fade with opacity alone.
- **A glow's timing is custom properties, not props.** Light usually lands through a `transition-delay` in figure CSS, so the halo reads the same value from `--ik-glow-delay` (and `--ik-glow-fade-delay` for the fade). `@starting-style` makes a halo that mounts already lit honour the delay too. Text inside a Glow takes half the halo, because a full one smeared screen text.
- **The blueprint grid is three times the viewBox, and the plate clips it.** A grid the size of the viewBox showed as a hard-edged rectangle floating on the plate. Captions are positioned so they paint above it.
- **The grid and the drafting layer hide behind `display: var(--ik-drafting, none)`.** Plate always draws the grid, so a look set on an ancestor can reveal it without Plate knowing; a look turns it on by setting one property.
- **Box draws its silhouette again after the tint, before the lid.** The lid's fill covered the inner half of the outline on the back edges, so silhouettes were uneven. The second, heavier path gives one edge weight all the way round; the lid's own stroke sits on top of the back edges, so hover still lights the whole lid.

### Interaction

- **`Press` runs your pointer handlers after its own.** Replacing them made a demo press and a reader's press race, so the action ran twice.
- **`Press` resets on blur.** A key released after focus moved on would otherwise stay down.
- **A part that becomes disabled while held does not act on key-up.**
- **`useDemoTap` sets the phase to `release` before it calls your `onTap`.** Otherwise the phase could stick at `release` if `onTap` re-rendered the tree. It dismisses itself on a capture-phase `pointerdown` or `keydown` anywhere in the figure.

### Sound

- **Nothing plays until the page opts in.** The engine chunk is fetched on intent (pointer enter, focus), and the `AudioContext` is made on the first sound.
- **Sounds asked for before the reader has interacted are dropped, not queued.** The browser holds audio until then.
- **The context suspends only after the longest scheduled sound, plus a margin, and never sooner than four seconds.** A delayed cascade outlasts four seconds.
- **A stored value other than `on` or `off` means "not chosen yet".** Storage is shared with the host page.
- **`playSound` honours `delay` only for `cascade`.** Any other sound that lands later needs one timer in a ref.

- **Press measures pan and size from bounding rects in its handlers.** The rects include every transform above the part, so a part inside a translated group still pans from where it is drawn; nothing is read during render.
- **Noise sources loop.** The noise buffer is half a second long; a motor held for longer would fall silent without it.
- **`tick` and `roll` are throttled to one every 30 ms.** A dial pressed quickly stacked clicks into a buzz.

### Packaging

- **The build uses `platform: "neutral"` and keeps `process.env.NODE_ENV` in `dist/`.** The browser platform inlined it at library build time and shipped the development checks to production (0.2.0). `scripts/check-dist.mjs` guards this.
- **Only the `index` chunk carries `"use client"`.** `react-isokit/schema` stays importable from server code, where validating JSON usually happens.

- **`themes.css` uses zero specificity and loads after `styles.css`.** Looks override the core palette by order, so a host can still override a look with one class.
- **Every colour a look sets is in oklab, even a plain seed.** Chrome interpolates a one-sided keyframe (`from { fill: var(--ik-well) }`, with the other end taken from the element) wrongly when the two ends are in different colour spaces, and painted it near-black. A seed is mixed with itself to move it into oklab beside the derived tones; a test in `glow-and-looks.test.tsx` keeps it that way.

### Drawing figures

- **A curve revealed by its dash has no non-scaling stroke.** The dash is measured against `pathLength`.
- **One polyline per step.** Each press draws only its own stretch of a curve.
- **Text on a card or a screen is clipped to its rect.** No font can push it past the edge.
- **A ticking clock runs only while its figure is visible.**
- **A cable attached to a moving plug has a segment that lies under the plug's tail and continues past it.** The cable stays whole when the plug moves.
- **Parts are swapped through two alternating keyed slots.** The old card leaves while the new one lands.
- **Each step of a stepped sorter is shallower and taller than the one in front.** The item on it then shows above that one: paint order by height.
- **A rollout lights a fixed, scattered sample.** It looks like real people, not a filled row.
- **Growing slabs land bottom-up, and shrinking ones leave top-down.** Each column moves a beat after its left neighbour.
- **The first-view demo runs once, unless the reader gets there first.**

### Tooling

- **Playwright's `click` waits for an element to be stable, and a bobbing part never is.** Press parts with focus and Enter.
- **`.ik-plate` sets `grid-template-columns: minmax(0, 1fr)`.** With the implicit `auto` column, a plate of fixed height let its svg's aspect ratio widen the column past the plate (the oktai landing layout test caught it at 320, 390 and 820 px).
- **Destructure `useDemoTap` in React-compiler codebases.** The compiler's `react-hooks/refs` rule treats every field of an object that carries a `ref` as a ref read during render.
- **`shoot.mjs` dismisses the first-view demo with a right-button pointerdown on each svg before the rest shot.** Without it, fast demos pressed the hot part before the rest picture, its label changed, and the click landed on a copy in the variation grid. A Shift keydown did the same job, but a figure that takes typing read it as a key.
- **Studio gallery plates set `aspect-ratio: auto`.** A figure's own aspect ratio plus a fixed gallery height overflowed the page.
- **Builders work one industry folder each.** Never stash, reset or check out the shared tree while another agent is editing it.
- **`--ik-spring` is generated, not typed.** `examples/demo/src/bench/spring-easing.ts` samples a damped spring into a `linear()` curve; a test keeps `src/styles.css` equal to its output, and the bench writes new values the same way. A `linear()` spring jumps when it is interrupted, so it is used on release only.
- **The bench is reachable only in development.** `site.tsx` imports it behind `import.meta.env.DEV`, so Vite drops it and DialKit from the Pages build. It tunes the sound materials by writing into the material table in place: development tooling, never shipped.
- **Biome's `noAriaHiddenOnFocusable` is off.** It flags every SVG `<g>` as focusable, and Glow's halo copies must be hidden so their text is read once.
