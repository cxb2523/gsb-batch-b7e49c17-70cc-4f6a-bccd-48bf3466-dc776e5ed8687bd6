import { useEffect, useRef, useState } from "react"
import { Box, Cursor, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./badge-reader.css"

export const meta = {
  slug: "badge-reader",
  title: "Badge reader",
  industry: "security",
  level: 1,
  blurb: "Tap the badge on the reader: its light comes on and the door beside it slides open. Tap again to lock it.",
  uses: ["Plate", "Box", "Press", "Ripple", "Cursor", "useDemoTap"],
  sounds: ["press", "release", "success", "toggle"],
} satisfies FigureMeta

type Door = "rest" | "open" | "locked"

const BASE = { x: 0, y: 0, z: 0, w: 168, d: 96, h: 8 }
const WALL = { x: 6, y: 6, z: BASE.h, w: 156, d: 10, h: 76 }
const FRONT = WALL.y + WALL.d
const DOORWAY = { x: 56, y: 12, w: 46, h: WALL.h - 12 }
const LEAF = { x: WALL.x + DOORWAY.x - 1, y: FRONT, z: BASE.h, w: DOORWAY.w + 2, d: 3, h: DOORWAY.h }
const TRACK = { x: LEAF.x - 3, y: FRONT, z: LEAF.z + LEAF.h + 1, w: WALL.x + WALL.w - LEAF.x + 1, d: 5, h: 5 }
const POST = { x: 23, y: 56, z: BASE.h, w: 18, d: 18, h: 22 }
const HEAD = { x: 10, y: 48, z: POST.z + POST.h, w: 44, d: 34, h: 14 }
const BADGE = { x: 13, y: 53, z: HEAD.z + HEAD.h + 3, w: 38, d: 24, h: 2 }
const SLIDE = LEAF.w
const SLID = `translate(${(SLIDE * Math.cos(Math.PI / 6)).toFixed(3)}px, ${(SLIDE * Math.sin(Math.PI / 6)).toFixed(3)}px)`
const READOUT: Readonly<Record<Door, string>> = {
  rest: "no badge · door locked",
  open: "badge 0412 · door open",
  locked: "badge 0412 · door locked",
}

export default function BadgeReader() {
  const [door, setDoor] = useState<Door>("rest")
  const stop = useRef(() => {})
  useEffect(() => () => stop.current(), [])

  const open = door === "open"
  const tap = (audible: boolean) => {
    stop.current()
    if (audible) stop.current = playSound(open ? "toggle" : "success")
    setDoor(open ? "locked" : "open")
  }
  const demo = useDemoTap(() => {
    if (door === "rest") tap(false)
  }, { delay: 500 })
  const press = () => {
    demo.dismiss()
    tap(true)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Security"
      name="Badge reader"
      hint={open ? "Tap to lock" : "Tap the badge"}
      readout={READOUT[door]}
      className="fig-badge-reader"
      data-open={open}
      fit={[BASE, { ...WALL, z: 0, h: WALL.z + WALL.h }, BADGE]}
      aspect={1.25}
      label="A badge reader on a post beside a sliding door. Tap the badge on the reader to turn its light on and open the door; tap again to lock it."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              <rect className="ik-detail" x={WALL.x + DOORWAY.x} y={FRONT + 5} width={DOORWAY.w} height={16} rx={2} />
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${WALL.x + DOORWAY.x + 6 + k * 6.8} ${FRONT + 8}v10`} />
              ))}
              {[
                [8, BASE.d - 8],
                [BASE.w - 8, BASE.d - 8],
              ].map(([cx, cy]) => (
                <circle key={cx} className="ik-fill" cx={cx} cy={cy} r={1.6} />
              ))}
            </>
          }
        />
        <Box
          {...WALL}
          r={2}
          top={<path className="ik-detail" d={`M4 ${WALL.d / 2}h${WALL.w - 8}`} />}
          front={
            <>
              <path className="ik-detail" d={`M${DOORWAY.x - 3} ${WALL.h}V${DOORWAY.y - 3}H${DOORWAY.x + DOORWAY.w + 3}V${WALL.h}`} />
              <rect className="ik-well" x={DOORWAY.x} y={DOORWAY.y} width={DOORWAY.w} height={DOORWAY.h} />
              <path className="ik-detail" d={`M${DOORWAY.x} ${WALL.h - 4}h${DOORWAY.w}`} />
              <rect className="ik-face ik-top" x={12} y={8} width={28} height={11} rx={1.5} />
              <text className="ik-label br-sign" x={16} y={15.6}>
                LAB 4
              </text>
            </>
          }
          side={<path className="ik-detail" d={`M3 6v${WALL.h - 12}`} />}
        />
        <g className="br-leaf" style={open ? { transform: SLID } : undefined}>
          <Box
            {...LEAF}
            r={1}
            front={
              <>
                <rect className="ik-well" x={8} y={8} width={10} height={26} rx={1.5} />
                <rect className="ik-well" x={LEAF.w - 9} y={28} width={4} height={14} rx={2} />
                <rect className="ik-detail" x={4} y={LEAF.h - 11} width={LEAF.w - 8} height={7} rx={1} />
              </>
            }
          />
        </g>
        <Box {...TRACK} r={1.5} front={<path className="ik-detail" d={`M3 2.5h${TRACK.w - 6}`} />} />

        <Box
          {...POST}
          r={3}
          front={
            <>
              <rect className="ik-detail" x={4} y={4} width={POST.w - 8} height={9} rx={1} />
              <circle className="ik-fill" cx={6} cy={6} r={0.8} />
              <circle className="ik-fill" cx={POST.w - 6} cy={11} r={0.8} />
            </>
          }
          side={<path className="ik-detail" d={`M4 ${POST.h - 4}h${POST.d - 8}`} />}
        />
        <Box
          {...HEAD}
          r={5}
          top={<rect className="ik-detail" x={2.5} y={2.5} width={HEAD.w - 5} height={HEAD.d - 5} rx={3} />}
          front={
            <>
              <rect className="br-led" x={6} y={4.2} width={18} height={3.6} rx={1.8} />
              <g className="ik-detail" transform="translate(31 6)">
                <path d="M0-1.6a2.3 2.3 0 0 1 0 3.2" />
                <path d="M1.8-3.2a4.6 4.6 0 0 1 0 6.4" />
                <path d="M3.6-4.8a6.9 6.9 0 0 1 0 9.6" />
              </g>
              <path className="ik-detail" d={`M6 ${HEAD.h - 2.8}h${HEAD.w - 12}`} />
            </>
          }
          side={Array.from({ length: 5 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${6 + k * 3} 3.6v6`} />
          ))}
        />

        {door === "rest" && !aiming ? <Ripple x={BADGE.x} y={BADGE.y} z={BADGE.z} w={BADGE.w} d={BADGE.d} r={3} /> : null}
        <Press label={open ? "Tap the badge to lock the door" : "Tap the badge to open the door"} onPress={press} data-hot={!open}>
          <g>
            <Box
              {...BADGE}
              r={3}
              top={
                <>
                  <rect className="ik-well" x={2.6} y={8} width={2.6} height={8} rx={1.3} />
                  <rect className="ik-detail" x={8.5} y={4} width={10.5} height={15} rx={1.4} />
                  <circle className="ik-detail" cx={13.75} cy={9.2} r={2.6} />
                  <path className="ik-detail" d="M10 17.6a4 4 0 0 1 7.5 0" />
                  <path className="ik-detail" d="M23 6.5h11M23 10h7" />
                  <rect className="ik-detail" x={23} y={13.5} width={7} height={5.4} rx={1} />
                  <path className="ik-detail" d="M23 16.2h7M26.5 13.5v5.4" />
                </>
              }
            />
          </g>
        </Press>
        <Cursor at={[BADGE.x + BADGE.w / 2, BADGE.y + BADGE.d / 2, BADGE.z + BADGE.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
