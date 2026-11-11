import { useEffect, useRef, useState } from "react"
import { Box, Glow, Plate, Press, playSound, type SoundName, type SoundOptions, useSoundEnabled } from "react-isokit"
import "./sound-board.css"
import type { FigureMeta } from "../../catalog/figure-meta"

const ROWS: ReadonlyArray<readonly SoundName[]> = [
  ["press", "release", "toggle", "tick", "latch"],
  ["relay", "roll", "motor", "charge", "beep"],
  ["success", "error", "notify", "complete", "cascade"],
  ["whoosh", "paper", "process", "done", "boot"],
]
const BASE = { x: 0, y: 0, z: 0, w: 287, d: 150, h: 10 }
const PAD = { w: 36, d: 28, h: 5 }
const LENGTH: Record<SoundName, number> = { press: 0.2, release: 0.12, toggle: 0.1, boot: 1.4, success: 0.6, error: 0.35, notify: 0.3, complete: 0.7, cascade: 1, whoosh: 0.4, paper: 0.2, process: 0.6, done: 0.4, tick: 0.1, latch: 0.2, relay: 0.1, motor: 1.15, charge: 1.05, roll: 0.2, beep: 0.15 }
const OPTIONS: Partial<Record<SoundName, SoundOptions>> = { motor: { duration: 0.9 }, charge: { duration: 0.9 }, roll: { count: 3 } }
const PADS = ROWS.flatMap((row, r) => row.map((name, c) => ({ name, x: 10 + r * 21 + c * 42, y: 10 + r * 34 })))

export function SoundBoard() {
  const [lit, setLit] = useState<SoundName | null>(null)
  const [last, setLast] = useState<SoundName | null>(null)
  const [on] = useSoundEnabled()
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const play = (name: SoundName) => {
    playSound(name, OPTIONS[name])
    setLit(name)
    setLast(name)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLit(null), LENGTH[name] * 1000)
  }

  return (
    <Plate
      fig="Fig 5"
      name="Sound board"
      hint={on ? "Press a pad" : "Sound is off · switch it on"}
      readout={last ? `${last} · ${LENGTH[last]}s` : `${PADS.length} sounds`}
      className="board"
      fit={[BASE, { ...BASE, h: BASE.h + PAD.h }]}
      aspect={1.4}
      label="A sound board with a pad for each of isokit's twenty interaction sounds. Press a pad to hear it."
    >
      <Box {...BASE} r={10} front={<path className="ik-detail" d={`M8 ${BASE.h / 2}h${BASE.w - 16}`} />} />
      {PADS.map((p) => (
        <Press key={p.name} label={`Play ${p.name}`} material="rubber" onPress={() => play(p.name)} sound={false} data-hot={lit === p.name}>
          <g>
            <Box
              x={p.x}
              y={p.y}
              z={BASE.h}
              {...PAD}
              r={5}
              top={
                <>
                  <Glow on={lit === p.name}>
                    <circle className={lit === p.name ? "ik-dot" : "ik-fill"} cx={6} cy={6} r={1.6} />
                  </Glow>
                  <text className="ik-label" x={5} y={22}>
                    {p.name}
                  </text>
                </>
              }
            />
          </g>
        </Press>
      ))}
    </Plate>
  )
}

export const meta = {
  slug: "sound-board",
  title: "Sound board",
  industry: "agents",
  level: 1,
  blurb: "Every sound the kit can make, one pad each: press a pad to hear it.",
  uses: ["Plate", "Box", "Press", "Glow", "playSound"],
  sounds: ["press", "release", "toggle", "tick", "latch", "relay", "roll", "motor", "beep", "boot", "success", "error", "notify", "complete", "cascade", "whoosh", "paper", "process", "done"],
} satisfies FigureMeta

export default SoundBoard
