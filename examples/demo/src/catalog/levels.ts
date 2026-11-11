export const LEVELS = [
  {
    level: 1,
    name: "Tap",
    promise: "One press changes one surface, and the read-out says what changed.",
    ingredients: ["Plate", "Box", "Press", "useDemoTap", "Ripple", "Cursor", "data-hot on the part to press", "a readout written on every press"],
    timing: "No timers. The press lands at once; a CSS transition of 700 ms on var(--ik-ease) carries the change.",
    examples: ["tally-counter", "metrics-board"],
  },
  {
    level: 2,
    name: "Cause and effect",
    promise: "The press sends something to a separate result, and the result lands a moment later.",
    ingredients: ["everything in Tap", "Signal along a cable or path", "a result surface that switches with a transition-delay", "at most one timer, in a ref, cleared on unmount"],
    timing: "The result lands at Signal delay + duration. Prefer a CSS transition-delay to a timer.",
    examples: ["feature-flags", "ground-station"],
  },
  {
    level: 3,
    name: "Sequence",
    promise: "Several parts move one after another, lowest or nearest first, and a screen shows the progress.",
    ingredients: ["everything in Cause and effect", "a staggered row driven by a --i custom property", "playSound(\"cascade\") or \"process\" with its stop() kept", "timers in one ref, cleared on the next press and on unmount"],
    timing: "Stagger 40 to 60 ms apart. Match the cascade's count, stagger and delay to the motion.",
    examples: ["page-press", "cryo-stack"],
  },
  {
    level: 4,
    name: "System",
    promise: "Two or more controls or modes drive a small state machine, parts travel between places, and the figure cycles or resets.",
    ingredients: ["everything in Sequence", "useReducer for the state machine", "Flight between two world points", "a cycle or a reset with whoosh", "stale sounds cut when a newer action replaces them"],
    timing: "Each step finishes before the next control is hot. Flights land at delay + duration, and the part at the far end appears with a transition-delay.",
    examples: ["pick-and-place", "deploy-pipeline"],
  },
] as const

export type LevelNumber = (typeof LEVELS)[number]["level"]
export type LevelEntry = (typeof LEVELS)[number]
