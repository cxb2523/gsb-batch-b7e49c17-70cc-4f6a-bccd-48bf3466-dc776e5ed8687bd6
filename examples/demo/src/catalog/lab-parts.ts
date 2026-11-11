export const LAB_PARTS = [
  { name: "Drum", file: "drum.tsx", what: "A cylinder on a vertical axis, with optional ribs and grooves on its wall and anything you like drawn on its lid." },
  { name: "Ring", file: "ring.tsx", what: "A drum with a bore. You see down into it, and whatever sits inside is hidden behind its near lip." },
  { name: "CoilRing", file: "coil-ring.tsx", what: "A ring wound with copper coils across its lid and both walls, with light windows between them." },
  { name: "RadialSlots", file: "radial-slots.tsx", what: "Slots around a centre: vents, a dial, the ring that spins up." },
  { name: "Lens", file: "lens.tsx", what: "A round lamp glass in a bezel that lights up." },
  { name: "BoltCircle", file: "bolt-circle.tsx", what: "Bolt heads evenly around a flange." },
  { name: "Seat", file: "seat.tsx", what: "The machined ring and wire bore where the next part sits." },
  { name: "Bloom", file: "bloom.tsx", what: "Light from several sources that adds up where they overlap, so it is brightest at the slots and fades over the copper." },
  { name: "Exploded", file: "explode.tsx", what: "Floats a stack of parts apart and seats them one after another, each on its own joint." },
] as const

export type LabPartName = (typeof LAB_PARTS)[number]["name"]
