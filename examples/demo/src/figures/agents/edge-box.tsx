import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, curve, front, Glow, Plate, Press, path, playSound, side } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import "./edge-box.css"
import type { FigureMeta } from "../../catalog/figure-meta"

type Doc = { file: string; page: string; answer: string; tab: readonly [number, number] }
const DOCS: readonly Doc[] = [
  { file: "contract.pdf", page: "p.03", answer: "Term: 24 months", tab: [4, 18] },
  { file: "lease.pdf", page: "p.07", answer: "Notice: 3 months", tab: [21, 18] },
  { file: "nda.pdf", page: "p.01", answer: "Mutual, 2 years", tab: [38, 16] },
]
const DEV = { x: 0, y: 0, z: 0, w: 92, d: 92, h: 58 }
const STAND = { x: 108, y: 34, z: 0, w: 72, d: 62, h: 9 }
const FW = 58
const FH = 52
const TAB = 7
const FX = STAND.x + 7
const STEP = 9
const fy = (i: number) => STAND.y + 10 + i * 14
const STEPS = [0, 1, 2].map((k) => ({ ...STAND, d: k ? fy(2 - k) - STAND.y + 9 : STAND.d, h: STAND.h + k * STEP }))
const fz = (i: number) => STAND.h + (2 - i) * STEP
const folder = ([tx, tw]: readonly [number, number]) =>
  `M0 ${FH + TAB}V${TAB + 2}q0-2 2-2H${tx}l3-6q.5-1 1.5-1H${tx + tw - 4.5}q1 0 1.5 1l3 6H${FW - 2}q2 0 2 2V${FH + TAB}Z`
const CABLE = path(curve([72, 112, 3], [74, 140, 1.6], [30, 118, 1.6], [6, 146, 1.6]))
const READ_MS = 700
const READ_TIMING = { "--read": `${READ_MS}ms` } as CSSProperties
const FAN = { x: 46, y: 46, r: 23, hub: 6 }
const BLADES = Array.from({ length: 7 }, (_, k) => (
  <path key={k} className="ik-detail" d={`M${FAN.hub} 0Q${FAN.r * 0.6} -6 ${FAN.r - 2.5} -2.5`} transform={`rotate(${(k * 360) / 7})`} />
))
const GUARD = [10.5, 16.5].map((r) => <circle key={r} className="ik-detail" cx={FAN.x} cy={FAN.y} r={r} />)
const PORT_AT = [71, DEV.y + DEV.d, DEV.h - 46.5] as const

export function EdgeBox() {
  const [pick, setPick] = useState(0)
  const [reading, setReading] = useState(false)
  const timer = useRef(0)
  const stop = useRef(() => {})
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )
  const choose = (i: number) => {
    window.clearTimeout(timer.current)
    stop.current()
    playSound("paper")
    stop.current = playSound("motor", { duration: READ_MS / 1000 })
    setPick(i)
    setReading(true)
    timer.current = window.setTimeout(() => {
      setReading(false)
      playSound("done")
    }, READ_MS)
  }
  const doc = DOCS[pick] ?? DOCS[0]
  if (!doc) return null

  return (
    <Plate
      fig="Fig 4"
      name="Edge box"
      hint="Pick a file"
      readout={`${doc.file} · ${reading ? "reading" : doc.page}`}
      className="edge"
      data-reading={reading}
      style={READ_TIMING}
      fit={[DEV, STAND, [FX, fy(0), fz(0) + FH + TAB + 22], [6, 146, 0]]}
      aspect={1.18}
      label="A small computer with its network cable unplugged, beside a sorter of three folders. Pick a folder and the computer answers from it on its own screen."
    >
      <Box
        {...DEV}
        r={10}
        top={
          <>
            <rect className="ik-detail" x={16} y={16} width={60} height={60} rx={9} />
            <circle className="ik-well" cx={FAN.x} cy={FAN.y} r={FAN.r} />
            <g transform={`translate(${FAN.x} ${FAN.y})`}>
              <g key={pick} className="fan">
                {BLADES}
              </g>
            </g>
            {GUARD}
            <path className="ik-detail" d={`M${FAN.x - FAN.r} ${FAN.y}h${FAN.r * 2}M${FAN.x} ${FAN.y - FAN.r}v${FAN.r * 2}`} />
            <circle className="hub" cx={FAN.x} cy={FAN.y} r={FAN.hub} />
            {[20.5, 71.5].flatMap((x) => [20.5, 71.5].map((y) => <circle key={`${x}-${y}`} className="ik-detail" cx={x} cy={y} r={1.4} />))}
          </>
        }
        side={
          <>
            <circle className="ik-well" cx={82} cy={42.5} r={2.4} />
            {Array.from({ length: 6 }, (_, k) => (
              <path key={k} className="ik-detail" d={`M${10 + k * 3.4} 40v12`} />
            ))}
          </>
        }
        front={
          <>
            <rect className="ik-screen" x={8} y={8} width={76} height={28} rx={4} />
            <g key={`${pick}-${reading}`} className="ik-enter">
              <text className="ik-screen-text ik-dim" x={13} y={17.5} fontSize={5.6}>
                {reading ? "reading on device" : `${doc.file} · ${doc.page}`}
              </text>
              {reading ? (
                <rect className="sweep" x={13} y={25} width={14} height={3.5} rx={1} />
              ) : (
                <text className="ik-screen-text" x={13} y={30} fontSize={7.2}>
                  {doc.answer}
                </text>
              )}
            </g>
            <Glow on={reading}>
              <circle className="light ik-loop" cx={11} cy={47.5} r={1.8} />
            </Glow>
            <path className="ik-detail" d="M18.5 46v-2a2.5 2.5 0 0 1 5 0v2" />
            <rect className="ik-detail" x={17} y={46} width={8} height={6} rx={1} />
            {Array.from({ length: 7 }, (_, k) => (
              <path key={k} className="ik-detail" d={`M${33 + k * 3.4} 42v10`} />
            ))}
            <rect className="ik-well" x={65} y={42} width={12} height={9} rx={1.2} />
            <path className="ik-detail" d="M69 51v-2.5h4V51" />
          </>
        }
      />

      <path className="ik-line" d={CABLE} />
      <Box x={66} y={100} z={0} w={10} d={12} h={6} r={1.5} top={<path className="ik-detail" d="M5 3v5" />} />

      {STEPS.map((st, k) => (
        <Box key={st.h} {...st} r={5} top={<path className="ik-detail" d={`M5 ${fy(2 - k) - st.y + 2}h${st.w - 10}`} />} />
      ))}
      {DOCS.map((d, i) => (
        <Press
          key={d.file}
          className="ik-lift folder"
          label={`Read ${d.file}`}
          material="paper"
          onPress={() => choose(i)}
          sound={false}
          data-on={pick === i}
          style={{ "--d": Math.abs(i - pick) } as CSSProperties}
        >
          <g>
            <g transform={side(FX + FW, fy(i) + 2, fz(i) + FH)}>
              <rect className="ik-face strip" width={2} height={FH} />
            </g>
            <g transform={front(FX, fy(i) + 2, fz(i) + FH + TAB)}>
              <path className="ik-face" d={folder(d.tab)} />
              {Array.from({ length: i + 1 }, (_, k) => (
                <circle key={k} className="ik-fill tab-dot" cx={d.tab[0] + 6 + k * 3.4} cy={4} r={0.9} />
              ))}
              <path className="ik-detail" d={`M7 ${TAB + 11}h30M7 ${TAB + 17}h40M7 ${TAB + 23}h24`} />
            </g>
          </g>
        </Press>
      ))}
      <Callout at={PORT_AT} dx={-12} dy={32} label="offline" />
    </Plate>
  )
}

export const meta = {
  slug: "edge-box",
  title: "Edge box",
  industry: "agents",
  level: 2,
  blurb: "Pick a folder from the stepped sorter: it lifts, the fan spins up and the box reads it offline.",
  uses: ["Plate", "Box", "Press", "Glow", "curve", "path", "front", "side", "playSound", "Callout"],
  sounds: ["paper", "motor", "done"],
} satisfies FigureMeta

export default EdgeBox
