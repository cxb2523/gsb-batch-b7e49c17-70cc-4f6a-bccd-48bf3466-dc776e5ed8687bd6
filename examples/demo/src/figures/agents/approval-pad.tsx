import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Glow, Plate, Press, playSound, project } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import "./approval-pad.css"
import type { FigureMeta } from "../../catalog/figure-meta"

type Request = { agent: string; where: string; ask: string }
const QUEUE: readonly Request[] = [
  { agent: "claude code", where: "portfolio/main", ask: "Deploy preview?" },
  { agent: "codex", where: "api/staging", ask: "Run migration?" },
  { agent: "cursor", where: "web · 3 commits", ask: "Push to main?" },
  { agent: "claude code", where: "scripts/cleanup", ask: "Delete 2 files?" },
]
const BASE = { x: 0, y: 0, z: 0, w: 150, d: 124, h: 14 }
const RISER = { x: 0, y: 0, z: 14, w: 150, d: 48, h: 46 }
const ALLOW = { x: 10, y: 60, z: 14, w: 82, d: 52, h: 9 }
const DENY = { x: 100, y: 60, z: 14, w: 40, d: 52, h: 9 }
const MAST = { x: 126, y: 8, z: 60, w: 8, d: 8, h: 24 }
const [TX, TY] = project(MAST.x + 4, MAST.y + 4, MAST.z + MAST.h + 4)
const CHECK = "M0 5.5l3.6 3.6L11 1.5"
const CROSS = "M1 1l7.5 7.5M8.5 1L1 8.5"
const RELAY = { x: 10, y: 11, w: 27, h: 19 }
const RELAY_AT = [RISER.x + RISER.w, RISER.y + RISER.d - RELAY.x - RELAY.w / 2, RISER.z + RISER.h - RELAY.y - RELAY.h / 2] as const
const RELAY_MS = 90
const NEXT_MS = 1500
const RELAY_TIMING = { "--relay": `${RELAY_MS}ms` } as CSSProperties

type Phase = "waiting" | "allowed" | "denied"

export function ApprovalPad() {
  const [at, setAt] = useState(0)
  const [phase, setPhase] = useState<Phase>("waiting")
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const request = QUEUE[at]
  const decide = (kind: "allow" | "deny") => {
    if (!request) {
      setAt(0)
      setPhase("waiting")
      playSound("notify")
      return
    }
    if (phase !== "waiting") return
    const allowed = kind === "allow"
    const next = at + 1
    setPhase(allowed ? "allowed" : "denied")
    playSound("relay")
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      playSound(allowed ? "success" : "error")
      timer.current = window.setTimeout(() => {
        setAt(next)
        setPhase("waiting")
        playSound(next >= QUEUE.length ? "complete" : "notify")
      }, NEXT_MS - RELAY_MS)
    }, RELAY_MS)
  }

  const decided = request !== undefined && phase !== "waiting"
  const waiting = request !== undefined && phase === "waiting"
  const [small, big, readout] = !request
    ? ["no agents waiting", "All clear.", "all clear · 0 waiting"]
    : phase === "allowed"
      ? ["agent back to work", "Approved", "allowed · back to work"]
      : phase === "denied"
        ? ["agent paused", "Denied", "denied · agent paused"]
        : [request.where, request.ask, `${request.agent} · ${QUEUE.length - at} waiting`]

  return (
    <Plate
      fig="Fig 2"
      name="Approval pad"
      hint="Allow or deny"
      readout={readout}
      className="approval"
      data-phase={request ? phase : "clear"}
      style={RELAY_TIMING}
      fit={[BASE, { ...RISER, z: 0, h: RISER.z + RISER.h }, [MAST.x, MAST.y, MAST.z + MAST.h + 10]]}
      aspect={1.18}
      label="An approval pad. An agent's request waits on its screen; press allow or deny to answer it."
    >
      <Box {...BASE} r={10} />
      <Box
        {...RISER}
        r={8}
        front={
          <>
            <rect className="ik-screen" x={9} y={8} width={106} height={30} rx={4} />
            <Glow>
              <g key={`${at}-${phase}`} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={15} y={18} fontSize={5.6}>
                  {small}
                </text>
                {decided && <path className="ik-screen-line" d={phase === "allowed" ? CHECK : CROSS} transform="translate(15 23.5)" />}
                <text className="ik-screen-text" x={decided ? 30 : 15} y={32} fontSize={9.5}>
                  {big}
                </text>
              </g>
            </Glow>
            {QUEUE.map((r, i) => (
              <rect key={`${r.where}-${i}`} className="pip" data-on={i >= at} x={92 + i * 5} y={12} width={3} height={3} rx={0.6} />
            ))}
            <Glow on={waiting}>
              <circle className="light ik-loop" cx={132} cy={13} r={2.4} />
            </Glow>
            {Array.from({ length: 6 }, (_, i) => (
              <path key={i} className="ik-detail" d={`M${123.5 + i * 3.4} 21v16`} />
            ))}
          </>
        }
        side={
          <g transform={`translate(${RELAY.x} ${RELAY.y})`}>
            <rect className="ik-well" width={RELAY.w} height={RELAY.h} rx={2.5} />
            <rect className="ik-detail" x={4} y={8.5} width={9} height={7.5} rx={1} />
            <path className="ik-detail" d="M4 11h9M4 13.5h9M8.5 8.5V6.5" />
            <circle className="ik-fill" cx={22} cy={8.9} r={1.2} />
            <path className="ik-detail" d="M22 10.1V16" />
            <g transform="translate(4.5 5)">
              <g className="armature">
                <path className="ik-line" d="M0 0h17" />
              </g>
            </g>
            <circle className="ik-fill" cx={4.5} cy={5} r={1} />
          </g>
        }
      />
      <Box {...MAST} r={4} />
      <circle className="ik-face ik-top" cx={TX} cy={TY} r={4.6} />
      <Glow on={decided} className="tx">
        <circle className="tip-lamp" cx={TX} cy={TY} r={2.1} />
      </Glow>
      {phase === "allowed" && (
        <g className="ping">
          {[0, 1, 2].map((i) => (
            <path key={i} className="ik-live" style={{ "--i": i } as CSSProperties} d={`M${TX - 8 - i * 5} ${TY - 3 - i * 3}a${10 + i * 6} ${10 + i * 6} 0 0 1 ${16 + i * 10} 0`} />
          ))}
        </g>
      )}

      <Press label="Allow the request" material="plastic" onPress={() => decide("allow")}>
        <g>
          <Box
            {...ALLOW}
            r={7}
            top={
              <>
                <text className="ik-label" x={12} y={30}>
                  ALLOW
                </text>
                <path className="ik-detail" d="M12 36h22" />
              </>
            }
          />
        </g>
      </Press>
      <Press label="Deny the request" material="plastic" onPress={() => decide("deny")}>
        <g>
          <Box
            {...DENY}
            r={7}
            top={
              <>
                <path className="ik-detail ik-thick" d={CROSS} transform="translate(9 14) scale(1.1)" />
                <text className="ik-label" x={8} y={40}>
                  DENY
                </text>
              </>
            }
          />
        </g>
      </Press>
      <Callout at={RELAY_AT} dx={12} dy={-18} label="relay" />
    </Plate>
  )
}

export const meta = {
  slug: "approval-pad",
  title: "Approval pad",
  industry: "agents",
  level: 2,
  blurb: "An agent request waits on the screen; press allow or deny, a relay clicks, the answer goes out and the next one arrives.",
  uses: ["Plate", "Box", "Press", "Glow", "project", "playSound", "Callout"],
  sounds: ["press", "release", "relay", "success", "error", "notify", "complete"],
} satisfies FigureMeta

export default ApprovalPad
