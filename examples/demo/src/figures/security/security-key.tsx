import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Plate, Press, playSound, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./security-key.css"

export const meta = {
  slug: "security-key",
  title: "Security key",
  industry: "security",
  level: 2,
  blurb: "Touch the key's gold disc: the signed challenge runs into the laptop and its lock screen opens. Touch again to lock it.",
  uses: ["Plate", "Box", "Press", "Signal", "Ripple", "Cursor", "useDemoTap"],
  sounds: ["press", "release", "process", "success", "toggle"],
} satisfies FigureMeta

type Lock = "rest" | "unlocked" | "locked"

const BASE = { x: 0, y: 0, z: 0, w: 184, d: 108, h: 8 }
const DECK = { x: 14, y: 20, z: BASE.h, w: 104, d: 70, h: 7 }
const LID = { x: DECK.x, y: DECK.y, z: DECK.z + DECK.h, w: DECK.w, d: 4, h: 64 }
const SCREEN = { x: 5, y: 5, w: LID.w - 10, h: 51 }
const PORT_Z = DECK.z + DECK.h / 2
const KEY = { x: DECK.x + DECK.w + 4, y: 54, z: PORT_Z - 2.8, w: 50, d: 24, h: 5.6 }
const PLUG = { x: DECK.x + DECK.w, y: KEY.y + 9, z: PORT_Z - 1.5, w: 4, d: 6, h: 3 }
const DISC = { x: KEY.x + 17, y: KEY.y + 4.5, z: KEY.z + KEY.h, w: 15, d: 15, h: 1.6 }
const DISC_TOP: Vec3 = [DISC.x + DISC.w / 2, DISC.y + DISC.d / 2, DISC.z + DISC.h]
const LANE_X = DECK.x + DECK.w - 4
const LOCK = { x: SCREEN.x + SCREEN.w / 2, y: 29.5 }
const SURFACE = LID.y + LID.d + 0.4
const CLOSED = `M${LOCK.x - 3.2} ${LOCK.y}v-2.8a3.2 3.2 0 0 1 6.4 0v2.8`
const OPENED = `M${LOCK.x - 3.2} ${LOCK.y}v-4.2a3.2 3.2 0 0 1 6.4 0v1.2`
const CHALLENGE: readonly Vec3[] = [
  DISC_TOP,
  [KEY.x + 1, DISC_TOP[1], KEY.z + KEY.h + 0.4],
  [LANE_X, DISC_TOP[1], DECK.z + DECK.h + 0.4],
  [LANE_X, SURFACE + 2, DECK.z + DECK.h + 0.4],
  [LANE_X, SURFACE, DECK.z + DECK.h + 4],
  [LANE_X, SURFACE, LID.z + LID.h - LOCK.y + 2],
  [LID.x + LOCK.x + 8, SURFACE, LID.z + LID.h - LOCK.y + 2],
]
const KEYS = Array.from({ length: 36 }, (_, k) => ({ k, x: 11.6 + (k % 12) * 6.8, y: 9 + Math.floor(k / 12) * 6.8 }))
const SIGNAL_DELAY_MS = 80
const SIGNAL_MS = 620
const ARRIVAL_MS = SIGNAL_DELAY_MS + SIGNAL_MS
const ARRIVAL = { "--sk-arrive": `${ARRIVAL_MS}ms` } as CSSProperties
const IMMEDIATE = { "--sk-arrive": "0ms" } as CSSProperties
const READOUT: Readonly<Record<Lock, string>> = {
  rest: "locked · touch key",
  unlocked: "signed in · 2FA",
  locked: "signed out · locked",
}

export default function SecurityKey() {
  const [lock, setLock] = useState<Lock>("rest")
  const [step, setStep] = useState(0)
  const arrival = useRef(0)
  const stop = useRef(() => {})
  const clip = useId().replace(/:/g, "")
  useEffect(
    () => () => {
      window.clearTimeout(arrival.current)
      stop.current()
    },
    [],
  )

  const unlocked = lock === "unlocked"
  const touch = (audible: boolean) => {
    window.clearTimeout(arrival.current)
    stop.current()
    if (audible && !unlocked) {
      stop.current = playSound("process")
      arrival.current = window.setTimeout(() => {
        stop.current()
        stop.current = playSound("success")
      }, ARRIVAL_MS)
    }
    if (audible && unlocked) stop.current = playSound("toggle")
    setLock(unlocked ? "locked" : "unlocked")
    setStep((step + 1) % 4)
  }
  const demo = useDemoTap(() => {
    if (lock === "rest") touch(false)
  }, { delay: 1100 })
  const press = () => {
    demo.dismiss()
    touch(true)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Security"
      name="Security key"
      hint={unlocked ? "Touch to lock" : "Touch the gold disc"}
      readout={READOUT[lock]}
      className="fig-security-key"
      data-unlocked={unlocked}
      style={unlocked ? ARRIVAL : IMMEDIATE}
      fit={[BASE, { ...LID, z: 0, h: LID.z + LID.h }, KEY]}
      aspect={1.25}
      label="A laptop on its lock screen with a hardware security key in its side port. Touch the key's gold disc to send the signed challenge into the laptop and unlock it; touch again to lock it."
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
        <Box
          {...DECK}
          r={5}
          top={
            <>
              <path className="ik-detail" d={`M4 ${LID.d + 2}h${DECK.w - 8}`} />
              {KEYS.map((key) => (
                <rect key={key.k} className="ik-detail" x={key.x} y={key.y} width={5.6} height={5.6} rx={1} />
              ))}
              <rect className="ik-detail" x={11.6} y={29.4} width={12.4} height={5.6} rx={1} />
              <rect className="ik-detail" x={25.2} y={29.4} width={53.6} height={5.6} rx={1} />
              <rect className="ik-detail" x={80} y={29.4} width={12.4} height={5.6} rx={1} />
              <rect className="ik-detail" x={33} y={41} width={38} height={22} rx={2.4} />
            </>
          }
          front={<path className="ik-detail" d={`M${DECK.w / 2 - 9} 1.4h18`} />}
          side={
            <>
              <rect className="ik-well" x={38} y={2} width={9} height={3} rx={0.8} />
              <circle className="ik-fill" cx={54} cy={3.5} r={0.9} />
            </>
          }
        />
        <Box
          {...LID}
          r={2}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-screen`}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={3} />
                </clipPath>
              </defs>
              <circle className="ik-fill" cx={LID.w / 2} cy={2.5} r={0.9} />
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={3} />
              <g clipPath={`url(#${clip}-screen)`}>
                <circle className="sk-avatar" cx={LOCK.x} cy={13} r={5.6} />
                <circle className="sk-avatar" cx={LOCK.x} cy={11.6} r={2} />
                <path className="sk-avatar" d={`M${LOCK.x - 3.4} 17.2a3.6 3.6 0 0 1 6.8 0`} />
                <rect className="sk-lock" x={LOCK.x - 5} y={LOCK.y} width={10} height={8} rx={1.4} />
                <path className="sk-lock" d={`M${LOCK.x} ${LOCK.y + 3}v2`} />
                <g key={`shackle-${step}`}>
                  {unlocked ? (
                    <>
                      <path className="sk-lock sk-until" d={CLOSED} />
                      <path className="sk-lock sk-from" d={OPENED} />
                    </>
                  ) : (
                    <path className="sk-lock" d={CLOSED} />
                  )}
                </g>
                <g key={`prompt-${step}`}>
                  {unlocked ? (
                    <>
                      <text className="ik-screen-text ik-dim sk-until" x={LOCK.x} y={51.5} fontSize={5.6} textAnchor="middle">
                        checking key
                      </text>
                      <text className="ik-screen-text sk-from" x={LOCK.x} y={51.5} fontSize={5.6} textAnchor="middle">
                        signed in · 2FA
                      </text>
                    </>
                  ) : (
                    <g className="ik-enter">
                      <text className="ik-screen-text" x={LOCK.x} y={51.5} fontSize={5.6} textAnchor="middle">
                        touch your key
                      </text>
                    </g>
                  )}
                </g>
              </g>
              <path className="ik-detail" d={`M${LID.w / 2 - 12} ${LID.h - 4}h24`} />
            </>
          }
        />

        <Box {...PLUG} r={0.8} />
        <Box
          {...KEY}
          r={4}
          top={
            <>
              <circle className="ik-detail" cx={DISC.x - KEY.x + DISC.w / 2} cy={KEY.d / 2} r={DISC.w / 2 + 2.4} />
              <circle className="ik-well" cx={KEY.w - 6} cy={KEY.d / 2} r={2.8} />
              <path className="ik-detail" d={`M4 5v${KEY.d - 10}`} />
            </>
          }
          side={<path className="ik-detail" d={`M3 ${KEY.h / 2}h${KEY.d - 6}`} />}
        />
        {lock === "rest" && !aiming ? <Ripple x={DISC.x} y={DISC.y} z={DISC.z} w={DISC.w} d={DISC.d} r={DISC.w / 2} /> : null}
        <Press label={unlocked ? "Touch the key to lock the laptop" : "Touch the key's gold disc to sign in"} onPress={press} data-hot={!unlocked} className="sk-disc">
          <g>
            <Box
              {...DISC}
              r={DISC.w / 2}
              top={
                <>
                  <circle className="ik-detail" cx={DISC.w / 2} cy={DISC.d / 2} r={3.8} />
                  <circle className="ik-detail" cx={DISC.w / 2} cy={DISC.d / 2} r={1.8} />
                </>
              }
            />
          </g>
        </Press>
        {unlocked ? <Signal key={step} points={CHALLENGE} delay={SIGNAL_DELAY_MS} duration={SIGNAL_MS} /> : null}
        <Cursor at={DISC_TOP} phase={demo.phase} />
      </g>
    </Plate>
  )
}
