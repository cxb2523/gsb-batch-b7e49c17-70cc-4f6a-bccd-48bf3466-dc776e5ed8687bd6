export const DOC_GROUPS = ["Drawing", "Guided motion", "Drafting", "Sound", "Geometry"] as const

export type DocGroup = (typeof DOC_GROUPS)[number]

export type DocKind = "Component" | "Hook" | "Function" | "Sound"

export type PropRow = { name: string; type: string; fallback?: string; about: string }

export type ComponentDoc = {
  slug: string
  name: string
  kind: DocKind
  group: DocGroup
  summary: string
  signature: string
  props: readonly PropRow[]
  usage: string
  notes: readonly string[]
}

const GEOMETRY = new Set(["project", "top", "front", "side", "path", "curve", "frame", "outline", "corners", "hull", "radius"])
const SOUND = new Set(["playSound", "configureSound", "primeSound", "useSoundEnabled", "soundPreference"])
const DRAFTING = new Set(["Dimension", "Callout", "dimension"])

export function docSlugForExport(name: string): string {
  if (GEOMETRY.has(name)) return "geometry"
  if (SOUND.has(name)) return "sound"
  if (DRAFTING.has(name)) return "drafting"
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()
}

export const DOCS: readonly ComponentDoc[] = [
  {
    slug: "plate",
    name: "Plate",
    kind: "Component",
    group: "Drawing",
    summary: "The numbered plate a figure sits on, and the svg it is drawn in. It frames what you give it, puts captions in its corners and wakes looping animations only near the viewport.",
    signature: "<Plate label fit aspect pad viewBox fig name hint readout credit theme look>",
    props: [
      { name: "label", type: "string", about: "Required. The accessible name: what the figure is and how to use it." },
      { name: "fit", type: "Array<Box3 | Vec3>", about: "Boxes and points to frame. Include the most extreme pose, so nothing leaves the plate when it moves." },
      { name: "aspect", type: "number", fallback: "1.25", about: "Width over height of the drawing." },
      { name: "pad", type: "number", fallback: "0.07", about: "Padding around fit, as a share of its size." },
      { name: "viewBox", type: "string", about: "Your own viewBox instead of fit." },
      { name: "fig, name, hint, readout", type: "ReactNode", about: "The four corner captions. readout is a polite live region: write it on every interaction." },
      { name: "credit", type: "boolean", fallback: "true", about: "Shows a small Made with isokit · pushary.com link beneath the captions. Set false to omit it." },
      { name: "theme", type: '"light" | "dark" | "system"', about: "Unset follows a .dark or [data-theme=dark] ancestor." },
      { name: "look", type: '"blueprint" | "paper" | "phosphor" | string', about: "A look from react-isokit/themes.css, in its light or dark version. A data-look attribute on any ancestor works too. Blueprint lays isometric graph paper under the figure and shows the drafting layer." },
      { name: "...svg", type: "SVGProps", about: "Anything else lands on the svg. Put state there as data-* attributes and style descendants from CSS." },
    ],
    usage: `<Plate label="A key you can press" fit={[key]} hint="Press it" readout={\`pressed \${n}×\`}>
  …
</Plate>`,
    notes: [
      "The svg is a labelled group: a figure holds buttons. Pass role=\"img\" for a figure with nothing to press.",
      "Loops marked ik-loop, ik-float, ik-pulse or ik-blink pause while the plate is offscreen.",
      "Import react-isokit/themes.css after react-isokit/styles.css. A look is five colours (paper, pen, live, glow, accent) in light and dark; every face tone is mixed from them.",
    ],
  },
  {
    slug: "box",
    name: "Box",
    kind: "Component",
    group: "Drawing",
    summary: "A rounded box: the hull of its rounded top and foot, a darker right side and a lighter lid. Draw on its faces in each face's own flat coordinates.",
    signature: "<Box x y z w d h r top front side className>",
    props: [
      { name: "x, y, z, w, d, h", type: "number", about: "Required. The back-left-bottom corner and the size along x (down-right), y (down-left) and z (up)." },
      { name: "r", type: "number", fallback: "0", about: "Corner radius of the footprint. Never more than half the shorter side." },
      { name: "top", type: "ReactNode", about: "Drawn on the lid. Local x along +x, local y along +y, from the back-left corner." },
      { name: "front", type: "ReactNode", about: "Drawn on the face toward lower-left. Local x along +x, local y down, from its top-left corner." },
      { name: "side", type: "ReactNode", about: "Drawn on the face toward lower-right. Local x from the front edge toward the back, local y down." },
      { name: "children", type: "ReactNode", about: "Drawn after the box, in screen space." },
    ],
    usage: `<Box x={0} y={0} z={0} w={150} d={48} h={46} r={8}
  front={<rect className="ik-screen" x={9} y={8} width={106} height={30} rx={4} />}
/>`,
    notes: ["There is no depth buffer: emit boxes back to front, lower z and smaller x + y first.", "Never hand-compute a skewed polygon: draw ordinary rects, paths and text on a face."],
  },
  {
    slug: "press",
    name: "Press",
    kind: "Component",
    group: "Drawing",
    summary: "A part you can press, the way a real key works: down on press, up on release, and it acts on release. Pointer, touch, Enter and Space.",
    signature: "<Press label onPress sound material disabled className>",
    props: [
      { name: "label", type: "string", about: "Required. The accessible name of the part: what pressing it does." },
      { name: "onPress", type: "() => void", about: "Required. Called on release." },
      { name: "sound", type: "boolean", fallback: "true", about: "Play the press and release clicks (sound must also be on). Turn it off to play your own." },
      { name: "material", type: '"plastic" | "metal" | "rubber" | "glass" | "paper"', fallback: '"plastic"', about: "What the part is made of: it shapes the click. The part's size sets the pitch and where it sits sets the stereo position, both measured when it is pressed." },
      { name: "disabled", type: "boolean", about: "Not focusable, not pressable." },
      { name: "data-hot", type: "boolean", about: "Marks the part as the one to press: its faces take the live stroke, and useDemoTap presses it." },
      { name: "className", type: "string", about: "Add ik-lift for parts that lift instead of sinking." },
    ],
    usage: `<Press label="Publish the page" onPress={publish} data-hot={!live}>
  <g><Box {...KEY} r={6} /></g>
</Press>`,
    notes: [
      "Wrap exactly one <g> holding the boxes that move: that group sinks --ik-travel (2 units) in 50 ms and springs back up on release.",
      "Set --ik-travel on a Press for a deeper or shallower key.",
      "A part held from the keyboard comes back up when focus leaves it.",
    ],
  },
  {
    slug: "glow",
    name: "Glow",
    kind: "Component",
    group: "Drawing",
    summary: "Light coming off something that is switched on: an LED, an awake screen's text, a signal on a wire. It draws its children twice more underneath as a soft halo, and fades the halo in fast and out slowly.",
    signature: "<Glow on className>children</Glow>",
    props: [
      { name: "on", type: "boolean", fallback: "true", about: "Whether the light is on. The halo ignites in --ik-t-glow-on and fades over --ik-t-glow-off." },
      { name: "children", type: "ReactNode", about: "Small emitters only: dots, short lines, screen text. Never faces, and never anything pressable or with an id: it is drawn three times." },
    ],
    usage: `<Glow on={lit}>
  <circle className={lit ? "ik-dot" : "ik-fill"} cx={6} cy={6} r={1.6} />
</Glow>`,
    notes: [
      "Glow is emission, not attention: the one live stroke still says where to look.",
      "On light themes --ik-glow-strength is 0, so lit means a darker fill; dark themes and the dark looks show the bloom.",
      "No CSS filter is used: Safari ignores filters on SVG children, and a halo layer costs one paint.",
      "Colour a glow with --ik-glow on an ancestor; --ik-glow-size sets how far it spreads, and text takes half of it.",
      "When the light lands late through a transition-delay, set --ik-glow-delay to the same delay so the halo ignites with it.",
    ],
  },
  {
    slug: "use-demo-tap",
    name: "useDemoTap",
    kind: "Hook",
    group: "Guided motion",
    summary: "Presses a figure once, for the reader, the first time it is mostly in view: a cursor glides onto the part marked data-hot, presses it and calls your action, then hands the figure over.",
    signature: "const demo = useDemoTap(onTap, { delay, threshold })",
    props: [
      { name: "onTap", type: "() => void", about: "Your action, without sound: the reader did not cause it." },
      { name: "delay", type: "number", fallback: "500", about: "Milliseconds in view before the cursor appears. Stagger figures shown side by side." },
      { name: "threshold", type: "number", fallback: "0.6", about: "Share of the figure that counts as in view." },
      { name: "→ ref", type: "RefObject<SVGGElement>", about: "Put it on any group inside the figure." },
      { name: "→ phase", type: '"waiting" | "aim" | "press" | "release" | "done"', about: "Pass it to <Cursor>. Hide your ripple while it is aim or press." },
      { name: "→ dismiss", type: "() => void", about: "Call it from every press the reader makes; the demo never plays after that." },
      { name: "→ plate", type: '{ "data-demo"?: "press" }', about: "Spread it onto the Plate, so the hot part sinks while the cursor presses it." },
    ],
    usage: `const demo = useDemoTap(() => publish(false), { delay: 600 })
const press = () => { demo.dismiss(); publish(true) }

<Plate {...demo.plate} …>
  <g ref={demo.ref}>
    …
    <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
  </g>
</Plate>`,
    notes: [
      "Scrolling away before the press cancels it; it waits for the next visit.",
      "It never plays under reduced motion, without IntersectionObserver, or after dismiss.",
      "Keep onTap silent: sound follows only what the reader caused.",
    ],
  },
  {
    slug: "cursor",
    name: "Cursor",
    kind: "Component",
    group: "Guided motion",
    summary: "The pointer a demo press is made with. It glides in from the lower right, dips as it presses, rings at its tip and drifts off.",
    signature: "<Cursor at phase className>",
    props: [
      { name: "at", type: "Vec3", about: "The world point the tip lands on: the middle of the part's lid, or of its front face." },
      { name: "phase", type: "DemoPhase", about: "From useDemoTap. Renders nothing while waiting or done." },
    ],
    usage: `<Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />`,
    notes: ["Draw it last, so it is on top of everything.", "Keep the point fixed: if the hot part changes when the press lands, the cursor should not jump with it."],
  },
  {
    slug: "ripple",
    name: "Ripple",
    kind: "Component",
    group: "Guided motion",
    summary: "A ring that breathes out from a footprint: the part to press. It is the one live thing at rest, and it goes away once the reader has pressed.",
    signature: "<Ripple x y z w d r inFace className>",
    props: [
      { name: "x, y, z, w, d", type: "number", about: "The footprint, at height z. Usually the footprint of the key it sits under." },
      { name: "r", type: "number", fallback: "0", about: "Corner radius of the footprint." },
      { name: "inFace", type: "boolean", fallback: "false", about: "Draw the ring in the face it sits in, at x, y, instead of on the ground at height z. Use it inside a Box's top, front or side to ring a key on an upright face." },
    ],
    usage: `{!touched && <Ripple {...KEY} r={6} />}
<Press …><g><Box {...KEY} r={6} /></g></Press>`,
    notes: ["Draw it just before the key, so the key covers its middle.", "It sleeps offscreen and stands still under reduced motion."],
  },
  {
    slug: "signal",
    name: "Signal",
    kind: "Component",
    group: "Guided motion",
    summary: "A short bright dash that runs once along a path, from its first point to its last: a request leaving a hub, a reading reaching a screen.",
    signature: "<Signal points delay duration className>",
    props: [
      { name: "points", type: "Vec3[]", about: "World points from the cause to the result, as for path()." },
      { name: "delay", type: "number", fallback: "0", about: "Milliseconds before it sets off." },
      { name: "duration", type: "number", fallback: "320", about: "Milliseconds from end to end." },
    ],
    usage: `{live && <Signal key={launches} points={CABLE} delay={150} />}`,
    notes: ["It runs when it mounts: give it a new key to run again.", "Make the result land at delay + duration.", "Its dash is measured with pathLength, so it never uses a non-scaling stroke."],
  },
  {
    slug: "flight",
    name: "Flight",
    kind: "Component",
    group: "Guided motion",
    summary: "Carries its children, drawn at one world point, along an arc to another, and hides them as they land: a coin between stacks, a card between slots.",
    signature: "<Flight from to delay duration lift className>",
    props: [
      { name: "from, to", type: "Vec3", about: "Where its children are drawn, and where they land." },
      { name: "delay", type: "number", fallback: "0", about: "Milliseconds before take-off. Hide the part at from at this moment." },
      { name: "duration", type: "number", fallback: "520", about: "Milliseconds in the air. Show the part at to at delay + duration." },
      { name: "lift", type: "number", fallback: "26", about: "How high the arc rises, in viewBox units." },
    ],
    usage: `<Flight key={step} from={[x, y, z]} to={[x2, y2, z2]} delay={260}>
  <Box x={x} y={y} z={z} w={24} d={24} h={4} r={12} />
</Flight>`,
    notes: ["Draw it last; give it a new key to fly again.", "Switch the parts at either end with a transition-delay rather than a timer, so it costs nothing."],
  },
  {
    slug: "drafting",
    name: "Dimension, Callout",
    kind: "Component",
    group: "Drafting",
    summary: "The drafting layer, from react-isokit/drafting: dimension lines with witness lines and arrowheads, and leader-line callouts. It shows only in a look that turns drafting on, like blueprint, and a dimension slides to its new length when what it measures moves.",
    signature: "<Dimension from to offset label /> · <Callout at dx dy label />",
    props: [
      { name: "from, to", type: "Vec3", about: "The two ends being measured, in world units." },
      { name: "offset", type: "Vec3", about: "How far the dimension line stands off the edge, in world units. The witness lines run back along it." },
      { name: "label", type: "ReactNode", about: "What the dimension says. Treat it as a read-out: write the new value when the part moves." },
      { name: "at", type: "Vec3", about: "Callout: the world point the leader starts from." },
      { name: "dx, dy", type: "number", fallback: "18, -14", about: "Callout: where the leader's elbow sits, in viewBox units from at." },
    ],
    usage: `<Dimension from={[KEY.x, KEY.y + KEY.d, 0]} to={[KEY.x + KEY.w, KEY.y + KEY.d, 0]} offset={[0, 10, 0]} label="w 82" />
<Callout at={[x, y, z]} label="lid" />`,
    notes: [
      "Hidden unless --ik-drafting is set; react-isokit/themes.css sets it in blueprint and styles the lines.",
      "Labels always read left to right or bottom to top: the ends swap for you.",
      "Draw dimensions last, after the parts they measure.",
    ],
  },
  {
    slug: "sound-toggle",
    name: "SoundToggle",
    kind: "Component",
    group: "Sound",
    summary: "A small switch for interaction sound that remembers the reader's choice.",
    signature: "<SoundToggle className>children</SoundToggle>",
    props: [{ name: "...button", type: "ButtonHTMLAttributes", about: "Any button prop. Its children replace the Sound label." }],
    usage: `<SoundToggle className="pill" />`,
    notes: ["Turning it on plays the toggle sound, so the reader hears that it worked."],
  },
  {
    slug: "sound",
    name: "playSound, configureSound",
    kind: "Sound",
    group: "Sound",
    summary: "Twenty synthesized interaction sounds, no audio files: clicks shaped by material, mechanical complications (tick, latch, relay, motor, charge, roll, beep) and result bells. The engine is a separate chunk fetched when a pointer reaches a figure; nothing plays until the page opts in and the reader has interacted.",
    signature: "playSound(name, { count, stagger, delay, duration, material, pan, size }) → stop()",
    props: [
      { name: "configureSound", type: "({ defaultOn, storageKey, volume }) => void", about: "Call once, early. Sound is off until the page turns it on or the reader presses a SoundToggle." },
      { name: "playSound", type: "(name, options?) => () => void", about: "Plays a sound if sound is on. Keep the stop() for anything a newer action should cut short." },
      { name: "options.material", type: "Material", about: "Shapes press and release: plastic, metal, rubber, glass or paper. Press passes its own." },
      { name: "options.duration", type: "number", about: "Seconds the motor runs before it winds down, or the charge climbs before it cuts." },
      { name: "options.pan, options.size", type: "number", about: "Stereo position from -1 to 1, and the part's share of the plate from 0 to 1 (bigger is lower). Press measures both for you." },
      { name: "primeSound", type: "() => void", about: "Starts loading the engine. Plate calls it when a pointer or focus arrives." },
      { name: "useSoundEnabled", type: "() => [boolean, (on) => void]", about: "The reader's preference." },
    ],
    usage: `configureSound({ defaultOn: true })
const stop = playSound("cascade", { count: 4, stagger: 0.06, delay: 0.3 })`,
    notes: [
      "Sounds asked for before the reader has interacted with the page are dropped, never queued.",
      "Match a cascade's stagger and delay to the staggered motion it accompanies.",
      "tick and roll are throttled to one every 30 ms, so a fast dial never machine-guns.",
    ],
  },
  {
    slug: "geometry",
    name: "project, top, front, side, path, curve",
    kind: "Function",
    group: "Geometry",
    summary: "The projection underneath. True isometric: +x runs down-right, +y down-left and +z up, 120° apart, with no perspective.",
    signature: "project(x, y, z) → [sx, sy]",
    props: [
      { name: "project(x, y, z)", type: "Vec2", about: "A world point on screen, in viewBox units." },
      { name: "top, front, side(x, y, z)", type: "string", about: "A transform string that puts anything you draw onto that plane." },
      { name: "path(points)", type: "string", about: "An open path through world points: cables, guides, wires. Class it ik-line." },
      { name: "curve(a, b, c, d, steps?)", type: "Vec3[]", about: "Points along a cubic Bézier through four world points." },
      { name: "frame(fit, aspect?, pad?)", type: "string", about: "The viewBox Plate computes from fit." },
      { name: "outline, corners, hull, radius", type: "…", about: "The rounded-box geometry Box is built on." },
    ],
    usage: `const CABLE = curve([72, 112, 3], [74, 140, 1.6], [30, 118, 1.6], [6, 146, 1.6])
<path className="ik-line" d={path(CABLE)} />`,
    notes: ["Never put a CSS transform on an element that has a transform attribute: wrap it and move the wrapper."],
  },
]

export const docBySlug: ReadonlyMap<string, ComponentDoc> = new Map(DOCS.map((doc) => [doc.slug, doc]))

export const docsByGroup: ReadonlyMap<DocGroup, readonly ComponentDoc[]> = new Map(DOC_GROUPS.map((group) => [group, DOCS.filter((doc) => doc.group === group)]))
