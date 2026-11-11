import { type CSSProperties, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useId, useRef, useState } from "react"
import { Box, curve, Glow, Plate, Press, path, playSound, top, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import { BrandMark } from "../../brand-mark"
import "./desk-computer.css"
import type { FigureMeta } from "../../catalog/figure-meta"

const MAT = { x: 0, y: 0, z: 0, w: 236, d: 244, h: 5 }
const PC = { x: 70, y: 8, z: 5, w: 120, d: 130, h: 172 }
const KB = { x: 16, y: 160, z: 5, w: 171, d: 63, h: 7 }
const U = 11
const KEY = 9.4
const KEY_H = 3.4
const GLASS = { x: 19, y: 20, w: 82, h: 70 }
const COLS = 19
const AUTOTYPE = "make it feel physical"
const KEY_DOWN_MS = 110
const RELAY_MS = 90
const DRIVE_MS = 900
const POWER_TIMING = { "--relay": `${RELAY_MS}ms` } as CSSProperties
const LEVER = { x: 110, y: 108 }
const LEVER_AT = [PC.x + PC.w, PC.y + PC.d - LEVER.x, PC.z + PC.h - LEVER.y] as const
const PAN_REACH = 0.35
const SPAN = { from: MAT.x - MAT.y - MAT.d, to: MAT.x + MAT.w - MAT.y }

type Key = { id: string; x: number; y: number; w: number }

const one = (s: string) => s.split(" ").map((c): [string, number] => [c, 1])
const ROWS: Array<Array<[string, number]>> = [
  [...one("` 1 2 3 4 5 6 7 8 9 0 - ="), ["backspace", 2]],
  [["tab", 1.5], ...one("q w e r t y u i o p [ ]"), ["\\", 1.5]],
  [["caps", 1.75], ...one("a s d f g h j k l ; '"), ["return", 2.25]],
  [["shift", 2.25], ...one("z x c v b n m , . /"), ["shift r", 2.75]],
  [["control", 1.5], ["option", 1.25], ["command", 1.5], ["space", 6.5], ["command r", 1.5], ["option r", 1.25], ["control r", 1.5]],
]
const KEYS: Key[] = ROWS.flatMap((row, r) => {
  let at = 0
  return row.map(([id, w]) => {
    const key = { id, x: KB.x + 3 + at * U + (U - KEY) / 2, y: KB.y + 3 + r * U + (U - KEY) / 2, w: w * U - (U - KEY) }
    at += w
    return key
  })
})
const KEY_IDS = new Set(KEYS.map((k) => k.id))
const KEY_SOUND: ReadonlyMap<string, { material: "plastic"; pan: number; size: number }> = new Map(
  KEYS.map((k) => {
    const across = (k.x + k.w / 2 - (k.y + KEY / 2) - SPAN.from) / (SPAN.to - SPAN.from)
    return [k.id, { material: "plastic", pan: (across * 2 - 1) * PAN_REACH, size: Math.sqrt((k.w * KEY) / (MAT.w * MAT.d)) }]
  }),
)
const SHIFTED: Record<string, string> = { "~": "`", "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", _: "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/" }
const NAMED: Record<string, string> = { " ": "space", Backspace: "backspace", Enter: "return", Shift: "shift", CapsLock: "caps", Control: "control", Alt: "option", Meta: "command" }
const keyFor = (key: string): string | null => NAMED[key] ?? (key.length === 1 ? (SHIFTED[key] ?? key.toLowerCase()) : null)

const CABLE = (() => {
  const base = curve([KB.x + KB.w - 6, KB.y + 2, KB.z + 3], [214, 164, 7], [222, 126, 7], [PC.x + PC.w + 5, PC.y + PC.d - 12.5, PC.z + 24], 260)
  return path(
    base.map((c, i): Vec3 => {
      const a = base[Math.max(0, i - 1)] ?? c
      const b = base[Math.min(base.length - 1, i + 1)] ?? c
      const tx = b[0] - a[0]
      const ty = b[1] - a[1]
      const n = Math.hypot(tx, ty) || 1
      const t = i / (base.length - 1)
      const r = 3.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.08) / 0.76))) ** 0.5
      const th = t * Math.PI * 34
      return [c[0] - (ty / n) * r * Math.cos(th), c[1] + (tx / n) * r * Math.cos(th), c[2] + r * Math.sin(th) + r]
    }),
  )
})()

export function DeskComputer() {
  const [on, setOn] = useState(false)
  const [text, setText] = useState("")
  const [past, setPast] = useState("")
  const [down, setDown] = useState<ReadonlySet<string>>(new Set())
  const [last, setLast] = useState<string | null>(null)
  const [driving, setDriving] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const timers = useRef(new Map<string, number>())
  const auto = useRef({ done: false, timer: 0 })
  const boot = useRef(0)
  const stopDrive = useRef(() => {})
  const id = useId().replace(/[^\w-]/g, "")

  const power = useCallback((next: boolean, quiet: boolean) => {
    window.clearTimeout(boot.current)
    stopDrive.current()
    setOn(next)
    setLast(null)
    setDriving(false)
    if (!quiet) playSound("relay")
    if (!next) return
    boot.current = window.setTimeout(() => {
      setDriving(true)
      if (!quiet) {
        playSound("boot")
        stopDrive.current = playSound("motor", { duration: DRIVE_MS / 1000 })
      }
      boot.current = window.setTimeout(() => setDriving(false), DRIVE_MS)
    }, RELAY_MS)
  }, [])

  const press = useCallback((key: string, char?: string, quiet = false) => {
    window.clearTimeout(timers.current.get(key))
    setDown((d) => new Set(d).add(key))
    timers.current.set(
      key,
      window.setTimeout(() => {
        setDown((d) => {
          const next = new Set(d)
          next.delete(key)
          return next
        })
        if (!quiet) playSound("release", KEY_SOUND.get(key))
      }, KEY_DOWN_MS),
    )
    setLast(key)
    if (!quiet) playSound("press", KEY_SOUND.get(key))
    if (key === "backspace") setText((t) => t.slice(0, -1))
    else if (key === "return")
      setText((t) => {
        if (t) setPast(t)
        return ""
      })
    else if (char) setText((t) => (t + char).slice(-200))
  }, [])
  const stopAuto = () => {
    auto.current.done = true
    window.clearTimeout(auto.current.timer)
  }

  useEffect(() => {
    const el = host.current
    const run = auto.current
    const timer = timers.current
    if (!el) return
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || run.done) return
        io.disconnect()
        if (still) {
          run.done = true
          setOn(true)
          setText(AUTOTYPE)
          return
        }
        let i = 0
        const step = () => {
          const ch = AUTOTYPE[i++]
          if (run.done || ch === undefined) {
            run.done = true
            return
          }
          press(ch === " " ? "space" : ch, ch, true)
          run.timer = window.setTimeout(step, 70 + Math.random() * 70)
        }
        run.timer = window.setTimeout(() => {
          if (run.done) return
          power(true, true)
          run.timer = window.setTimeout(step, RELAY_MS + DRIVE_MS)
        }, 500)
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      window.clearTimeout(run.timer)
      for (const t of timer.values()) window.clearTimeout(t)
    }
  }, [press, power])
  useEffect(
    () => () => {
      window.clearTimeout(boot.current)
      stopDrive.current()
    },
    [],
  )

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Tab") return
    const key = keyFor(e.key)
    if (!key || !KEY_IDS.has(key)) return
    e.preventDefault()
    stopAuto()
    press(key, on && e.key.length === 1 ? e.key : undefined)
  }
  const toggle = () => {
    stopAuto()
    power(!on, false)
  }
  const typeKey = (e: PointerEvent, key: string) => {
    e.preventDefault()
    stopAuto()
    e.currentTarget.closest("svg")?.focus({ preventScroll: true })
    press(key, !on ? undefined : key === "space" ? " " : key.length === 1 ? key : undefined)
  }

  const name = last === "space" || last === "return" || last === "backspace" ? last : last?.replace(/ r$/, "")
  const readout = (on ? `on · ${text.length} chars` : "off") + (name ? ` · key ${name}` : "")

  return (
    <div ref={host}>
      <Plate
        fig="Fig 1"
        name="Desk computer"
        hint="Type on it · click it to switch"
        readout={readout}
        className="desk"
        data-on={on}
        style={POWER_TIMING}
        fit={[MAT, PC]}
        aspect={1.6}
        pad={0.05}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={stopAuto}
        label="A desk computer with a keyboard and a coiled cable. Click the computer to switch it on, then type to write on its screen."
      >
        <defs>
          <clipPath id={`${id}-glass`}>
            <rect x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} rx={11} />
          </clipPath>
        </defs>

        <Box {...MAT} r={14} className="mat" />

        <Press className="ik-lift pc" label={on ? "Switch the computer off" : "Switch the computer on"} material="plastic" onPress={toggle} sound={false}>
          <Box
            {...PC}
            r={10}
            top={
              <>
                <rect className="ik-well" x={14} y={9} width={92} height={13} rx={6.5} />
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <path key={i} className="ik-detail" d={`M28 ${32 + i * 4.5}h64`} />
                ))}
                <path className="ik-detail" d={`M4 ${PC.d - 12}h${PC.w - 8}`} />
              </>
            }
            side={
              <>
                <path className="ik-detail" d={`M12 4v${PC.h - 8}`} />
                {Array.from({ length: 9 }, (_, i) => (
                  <path key={i} className="ik-detail" d={`M${92 + i * 3.4} 18v46`} />
                ))}
                {Array.from({ length: 6 }, (_, i) => (
                  <path key={i} className="ik-detail" d={`M${98 + i * 3.4} 128v16`} />
                ))}
                <rect className="ik-well" x={100} y={150} width={9} height={8} rx={1.5} />
                <rect className="ik-well" x={112} y={150} width={9} height={8} rx={1.5} />
                <rect className="ik-well" x={8} y={148} width={9} height={9} rx={1.5} />
                <rect className="ik-well" x={LEVER.x - 8} y={LEVER.y - 10} width={16} height={20} rx={2} />
                <text className="ik-label lever-mark" x={LEVER.x + 4} y={LEVER.y - 5}>
                  I
                </text>
                <text className="ik-label lever-mark" x={LEVER.x + 3.4} y={LEVER.y + 8}>
                  O
                </text>
                <g transform={`translate(${LEVER.x} ${LEVER.y})`}>
                  <g className="lever">
                    <path className="ik-line ik-thick" d="M0 0V7" />
                    <circle className="knob" cy={7} r={1.6} />
                  </g>
                </g>
                <circle className="knob" cx={LEVER.x} cy={LEVER.y} r={2.2} />
              </>
            }
            front={
              <>
                <rect className="ik-well" x={10} y={11} width={100} height={88} rx={9} />
                <rect className="ik-detail" x={13} y={14} width={94} height={82} rx={8} />
                <rect className="glass" x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} rx={11} />
                <g className="crt" clipPath={`url(#${id}-glass)`}>
                  {Array.from({ length: 23 }, (_, i) => (
                    <path key={i} className="scanline" d={`M${GLASS.x} ${GLASS.y + 2 + i * 3}h${GLASS.w}`} />
                  ))}
                  <Glow on={on} className="crt-glow">
                    <BrandMark x={GLASS.x + GLASS.w / 2} y={GLASS.y + 22} size={11} className="phosphor" />
                    <text className="screen-text dim" x={GLASS.x + 7} y={GLASS.y + 47}>
                      {past ? `> ${past.slice(-(COLS - 2))}` : ""}
                    </text>
                    <text className="screen-text" x={GLASS.x + 7} y={GLASS.y + 57}>
                      {`> ${text.slice(-(COLS - 2))}`}
                      <tspan className="cursor ik-loop">_</tspan>
                    </text>
                  </Glow>
                </g>
                <path className="ik-detail" d="M8 106h104" />
                {Array.from({ length: 6 }, (_, i) => (
                  <path key={i} className="ik-detail" d={`M${15 + i * 3} 114v15`} />
                ))}
                <rect className="ik-well" x={58} y={124} width={44} height={5.5} rx={2.75} />
                <path className="ik-detail" d="M62 133h12" />
                <Glow on={driving}>
                  <circle className="drive-led" cx={98.5} cy={133.5} r={1.2} />
                </Glow>
                <Glow on={on} className="power">
                  <circle className="led" cx={14} cy={151} r={1.7} />
                </Glow>
                <path className="ik-detail" d={`M6 ${PC.h - 10}h108`} />
              </>
            }
          />
        </Press>

        <Box x={PC.x + PC.w} y={PC.y + PC.d - 17} z={PC.z + 20} w={5} d={9} h={9} r={1.5} />
        <path className="ik-line" d={CABLE} />

        <Box {...KB} r={4} />
        <g transform={top(KB.x, KB.y, KB.z + KB.h)}>
          <rect className="ik-detail" x={2} y={2} width={KB.w - 4} height={KB.d - 4} rx={3} />
        </g>
        {KEYS.map((k) => (
          <g key={k.id} className="key" data-down={down.has(k.id)} onPointerDown={(e) => typeKey(e, k.id)}>
            <Box x={k.x} y={k.y} z={KB.z + KB.h} w={k.w} d={KEY} h={KEY_H} r={1.6} />
          </g>
        ))}
        <Callout at={LEVER_AT} dx={20} dy={-16} label="power" />
      </Plate>
    </div>
  )
}

export const meta = {
  slug: "desk-computer",
  title: "Desk computer",
  industry: "agents",
  level: 4,
  blurb: "Flip it on: a relay clicks, the drive whirs, the screen warms. Then type on its keys or yours and the prompt appears.",
  uses: ["Plate", "Box", "Press", "Glow", "curve", "path", "top", "playSound", "Callout"],
  sounds: ["relay", "boot", "motor", "press", "release"],
} satisfies FigureMeta

export default DeskComputer
