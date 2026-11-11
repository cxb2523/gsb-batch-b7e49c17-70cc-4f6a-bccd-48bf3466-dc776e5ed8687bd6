import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./firewall-rack.css"

export const meta = {
  slug: "firewall-rack",
  title: "Firewall rack",
  industry: "security",
  level: 3,
  blurb: "Press block: the firewall scans its ports left to right and drops a shutter over each one carrying suspicious traffic.",
  uses: ["Plate", "Box", "Press", "Ripple", "Cursor", "useDemoTap"],
  sounds: ["press", "release", "cascade", "complete", "whoosh"],
} satisfies FigureMeta

type Guard = "rest" | "blocked" | "allowed"

const BASE = { x: 0, y: 0, z: 0, w: 160, d: 112, h: 8 }
const RACK = { x: 12, y: 14, w: 126, d: 34 }
const POST = 7
const PLINTH = { x: RACK.x, y: RACK.y, z: BASE.h, w: RACK.w, d: RACK.d, h: 6 }
const Z0 = PLINTH.z + PLINTH.h
const UNIT = { x: RACK.x + POST, y: RACK.y + 1, w: RACK.w - 2 * POST, d: RACK.d - 2 }
const LOWER = { ...UNIT, z: Z0, h: 12 }
const FIREWALL = { ...UNIT, z: LOWER.z + LOWER.h + 1, h: 48 }
const CAP = { x: RACK.x, y: RACK.y, z: FIREWALL.z + FIREWALL.h + 1, w: RACK.w, d: RACK.d, h: 5 }
const LEFT = { x: RACK.x, y: RACK.y, z: Z0, w: POST, d: RACK.d, h: CAP.z - Z0 }
const RIGHT = { ...LEFT, x: RACK.x + RACK.w - POST }
const KEY = { x: 96, y: 78, z: BASE.h, w: 50, d: 22, h: 6 }
const LCD = { x: 7, y: 5, w: 54, h: 16 }
const SOCKET = { w: 9, h: 8, y: 31 }
const THREAT_PORTS = [1, 4, 6] as const
const THREATS: ReadonlySet<number> = new Set(THREAT_PORTS)
const SCAN_MS = 200
const STAGGER_MS = 60
const DROP_MS = 420
const scanAt = (k: number) => SCAN_MS + k * STAGGER_MS
const seatAt = (k: number) => scanAt(k) + DROP_MS
const PORTS = Array.from({ length: 8 }, (_, k) => {
  const order = THREAT_PORTS.indexOf(k as (typeof THREAT_PORTS)[number])
  return {
    k,
    x: 7 + k * 12.4,
    threat: THREATS.has(k),
    style: {
      "--t": `${scanAt(k)}ms`,
      "--seat": `${seatAt(k)}ms`,
      "--u": `${(THREAT_PORTS.length - 1 - order) * STAGGER_MS}ms`,
    } as CSSProperties,
  }
})
const [FIRST, SECOND, THIRD] = THREAT_PORTS.map(seatAt)
const DONE_MS = THIRD
const PROGRESS = [
  { text: "scanning", on: 0, off: FIRST },
  { text: "1 of 3", on: FIRST, off: SECOND },
  { text: "2 of 3", on: SECOND, off: THIRD },
  { text: "blocked", on: THIRD, off: undefined },
] as const
const DONE = { "--done": `${DONE_MS}ms` } as CSSProperties
const READOUT: Readonly<Record<Guard, string>> = {
  rest: "3 threats · inbound",
  blocked: "3 threats · blocked",
  allowed: "3 threats · allowed",
}

function RackHoles() {
  return (
    <>
      {Array.from({ length: 13 }, (_, k) => (
        <circle key={k} className="ik-fill" cx={POST / 2} cy={3.5 + k * 4.6} r={0.6} />
      ))}
    </>
  )
}

export default function FirewallRack() {
  const [guard, setGuard] = useState<Guard>("rest")
  const [step, setStep] = useState(0)
  const timer = useRef(0)
  const stop = useRef(() => {})
  const clip = useId().replace(/:/g, "")
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const blocked = guard === "blocked"
  const toggle = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    if (audible && !blocked) {
      stop.current = playSound("cascade", { count: PORTS.length, stagger: STAGGER_MS / 1000, delay: SCAN_MS / 1000 })
      timer.current = window.setTimeout(() => {
        stop.current = playSound("complete")
      }, DONE_MS)
    }
    if (audible && blocked) stop.current = playSound("whoosh")
    setGuard(blocked ? "allowed" : "blocked")
    setStep((step + 1) % 4)
  }
  const demo = useDemoTap(() => {
    if (guard === "rest") toggle(false)
  }, { delay: 1700 })
  const press = () => {
    demo.dismiss()
    toggle(true)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Security"
      name="Firewall rack"
      hint={blocked ? "Press allow" : "Press block"}
      readout={READOUT[guard]}
      className="fig-firewall-rack"
      data-blocked={blocked}
      style={DONE}
      fit={[BASE, { x: RACK.x, y: RACK.y, z: 0, w: RACK.w, d: RACK.d, h: CAP.z + CAP.h }]}
      aspect={1.3}
      label="A firewall in a rack, with an eight-port front panel, a status screen and a block key. Press block to scan the ports left to right and shut the three carrying suspicious traffic; press allow to open them again."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={10}
          top={[
            [8, 8],
            [BASE.w - 8, 8],
            [8, BASE.d - 8],
            [BASE.w - 8, BASE.d - 8],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.6} />
          ))}
        />
        <Box {...PLINTH} r={3} front={<path className="ik-detail" d={`M4 3h${RACK.w - 8}`} />} />
        <Box {...LEFT} r={1.5} front={<RackHoles />} />
        <Box
          {...LOWER}
          r={1.5}
          front={
            <>
              <circle className="ik-detail" cx={8} cy={LOWER.h / 2} r={2.2} />
              <circle className="ik-fill" cx={14} cy={LOWER.h / 2} r={1} />
              {Array.from({ length: 14 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${30 + k * 5.4} 3v${LOWER.h - 6}`} />
              ))}
            </>
          }
        />
        <Box
          {...FIREWALL}
          r={1.5}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-lcd`}>
                  <rect x={LCD.x} y={LCD.y} width={LCD.w} height={LCD.h} rx={2} />
                </clipPath>
                {PORTS.map((port) =>
                  port.threat ? (
                    <clipPath key={port.k} id={`${clip}-port-${port.k}`}>
                      <rect x={port.x - 0.5} y={SOCKET.y - 0.5} width={SOCKET.w + 1} height={SOCKET.h + 1} />
                    </clipPath>
                  ) : null,
                )}
              </defs>
              <path className="ik-detail" d={`M2.5 6v${FIREWALL.h - 12}M${FIREWALL.w - 2.5} 6v${FIREWALL.h - 12}`} />
              <rect className="ik-screen" x={LCD.x} y={LCD.y} width={LCD.w} height={LCD.h} rx={2} />
              <g clipPath={`url(#${clip}-lcd)`}>
                <text className="ik-screen-text ik-dim" x={LCD.x + 4} y={LCD.y + 5.8} fontSize={5.2}>
                  3 threats
                </text>
                <g key={`progress-${step}`}>
                  {blocked ? (
                    PROGRESS.map((frame) => (
                      <text
                        key={frame.text}
                        className={frame.off === undefined ? "ik-screen-text fw-shown" : "ik-screen-text fw-shown fw-passing"}
                        x={LCD.x + 4}
                        y={LCD.y + 13.8}
                        fontSize={7}
                        style={{ "--on": `${frame.on}ms`, "--off": `${frame.off ?? 0}ms` } as CSSProperties}
                      >
                        {frame.text}
                      </text>
                    ))
                  ) : (
                    <g className="ik-enter">
                      <text className="ik-screen-text" x={LCD.x + 4} y={LCD.y + 13.8} fontSize={7}>
                        {guard === "allowed" ? "allowed" : "inbound"}
                      </text>
                    </g>
                  )}
                </g>
              </g>
              <circle className="fw-status" cx={71} cy={9.6} r={2} />
              <text className="ik-label fw-tag" x={76} y={11.5}>
                SHIELD
              </text>
              {Array.from({ length: 10 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${70 + k * 3.4} 15.4v5.6`} />
              ))}
              {PORTS.map((port) => (
                <g key={port.k} style={port.style}>
                  <circle className={port.threat ? "fw-lamp ik-loop" : "fw-lamp"} data-threat={port.threat} cx={port.x + SOCKET.w / 2} cy={27} r={1.7} />
                  <rect className="ik-well" x={port.x} y={SOCKET.y} width={SOCKET.w} height={SOCKET.h} rx={0.8} />
                  <path className="ik-detail" d={`M${port.x + 3} ${SOCKET.y + SOCKET.h}v-1.8h3v1.8`} />
                  {port.threat ? (
                    <>
                      <g clipPath={`url(#${clip}-port-${port.k})`}>
                        <g className="fw-shutter">
                          <rect className="ik-face" x={port.x} y={SOCKET.y} width={SOCKET.w} height={SOCKET.h} rx={0.8} />
                          <path className="ik-detail" d={`M${port.x + 1.4} ${SOCKET.y + 2.7}h${SOCKET.w - 2.8}M${port.x + 1.4} ${SOCKET.y + 5.3}h${SOCKET.w - 2.8}`} />
                        </g>
                      </g>
                      <path className="ik-detail" d={`M${port.x + SOCKET.w / 2} ${SOCKET.y + SOCKET.h + 1.8}l2 3.4h-4z`} />
                    </>
                  ) : null}
                </g>
              ))}
            </>
          }
        />
        <Box
          {...RIGHT}
          r={1.5}
          front={<RackHoles />}
          side={
            <>
              {Array.from({ length: 8 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M7 ${10 + k * 4.4}h${RACK.d - 14}`} />
              ))}
              <rect className="ik-well" x={7} y={RIGHT.h - 10} width={7} height={5} rx={1} />
            </>
          }
        />
        <Box
          {...CAP}
          r={3}
          top={
            <>
              <rect className="ik-detail" x={8} y={6} width={RACK.w - 16} height={RACK.d - 12} rx={3} />
              {Array.from({ length: 4 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M18 ${10.5 + k * 4.4}h${RACK.w - 36}`} />
              ))}
            </>
          }
        />

        {guard === "rest" && !aiming ? <Ripple {...KEY} r={5} /> : null}
        <Press label={blocked ? "Allow the ports again" : "Block suspicious traffic"} onPress={press} data-hot={!blocked}>
          <g>
            <Box
              {...KEY}
              r={5}
              top={
                <>
                  <text className="ik-label fw-key" x={7} y={14}>
                    {blocked ? "ALLOW" : "BLOCK"}
                  </text>
                  <g className="ik-detail ik-thick" transform={`translate(${KEY.w - 10} ${KEY.d / 2})`}>
                    <circle r={3.6} />
                    {blocked ? null : <path d="M-2.5 2.5L2.5-2.5" />}
                  </g>
                </>
              }
            />
          </g>
        </Press>
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
