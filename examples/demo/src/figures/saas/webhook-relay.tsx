import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, type Box3, Cursor, curve, Flight, Glow, Plate, Press, path, playSound, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./webhook-relay.css"

export const meta = {
  slug: "webhook-relay",
  title: "Webhook relay",
  industry: "saas",
  level: 4,
  blurb: "Press send: the event flies to three endpoints, each relay clicks shut as it answers 200, and a failed delivery ticks its retry dial and retries down its cable.",
  uses: ["Plate", "Box", "Press", "Flight", "Signal", "Glow", "Ripple", "Cursor", "useDemoTap", "curve", "path", "Callout"],
  sounds: ["press", "release", "notify", "relay", "error", "tick", "success"],
} satisfies FigureMeta

type Hook = { id: "api" | "crm" | "slack"; label: string; y: number; port: number; order: number }

const BASE = { x: 0, y: 0, z: 0, w: 188, d: 136, h: 8 }
const SRC = { x: 12, y: 34, z: BASE.h, w: 60, d: 52, h: 42 }
const TRAY = { x: SRC.x + 10, y: SRC.y + 10, z: SRC.z + SRC.h, w: 30, d: 22, h: 3 }
const ENV = { x: TRAY.x + 7, y: TRAY.y + 5.5, z: TRAY.z + TRAY.h, w: 16, d: 11, h: 2.5 }
const EP = { x: 132, z: BASE.h, w: 44, d: 30, h: 24 }
const KEY = { x: 12, y: 102, z: BASE.h, w: 60, d: 22, h: 6 }
const PORT_Z = 14
const CABLE_Z = BASE.h + 1.2
const HOOKS: readonly Hook[] = [
  { id: "api", label: "API", y: 8, port: 46, order: 2 },
  { id: "crm", label: "CRM", y: 52, port: 60, order: 1 },
  { id: "slack", label: "SLACK", y: 96, port: 74, order: 0 },
]
const EVENTS = ["order.paid", "user.new", "refund"] as const
const STAGGER = 60
const FLY_MS = 560
const FLY_LIFT = 34
const RETRY_GAP = 380
const RETRY_MS = 460
const LAMP_LAG = 50
const ACK_MS = 140
const LAST_ORDER = HOOKS.reduce((most, hook) => Math.max(most, hook.order), 0)
const LAST = LAST_ORDER * STAGGER + FLY_MS
const PLANE = "M0 4.2L10 0L6.6 9.2L4.9 5.3ZM4.9 5.3L10 0"
const ARM = { x: 6, y: 11, length: 8 }
const DIAL = { x: 33, y: 12, r: 5 }
const DETENTS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4)

const boxOf = (hook: Hook) => ({ ...EP, y: hook.y })
const arrival = (hook: Hook) => hook.order * STAGGER + FLY_MS
const cable = (hook: Hook): Vec3[] =>
  curve([SRC.x + SRC.w, hook.port, PORT_Z], [100, hook.port, CABLE_Z], [106, hook.y + EP.d / 2, CABLE_Z], [EP.x, hook.y + EP.d / 2, CABLE_Z], 32)
const CABLES = HOOKS.map((hook) => path(cable(hook)))
const CRM = HOOKS[1] ?? HOOKS[0]
const RETRY_AT = (CRM ? arrival(CRM) : LAST) + RETRY_GAP
const RETRIED = RETRY_AT + RETRY_MS
const eventOf = (n: number) => EVENTS[(Math.max(n, 1) - 1) % EVENTS.length] ?? EVENTS[0]
const fails = (n: number) => n > 0 && n % 3 === 0
const retriesBy = (n: number) => Math.floor(n / 3)
const ms = (value: number) => `${value}ms`
const PLATE_STYLE = { "--retry-at": ms(RETRY_AT) } as CSSProperties
const detent = (a: number, r: number) => `${DIAL.x + Math.cos(a) * r} ${DIAL.y + Math.sin(a) * r}`
const DETENT_MARKS = DETENTS.map((a) => `M${detent(a, DIAL.r + 1)}L${detent(a, DIAL.r + 2.2)}`).join("")

function Envelope(b: Box3) {
  return <Box {...b} r={1.2} top={<path className="ik-detail" d={`M1.6 1.6L${b.w / 2} ${b.d * 0.6}L${b.w - 1.6} 1.6`} />} />
}

function Status({ n, hook }: { n: number; hook: Hook }) {
  const failing = fails(n) && hook.id === "crm"
  const at = arrival(hook)
  if (n === 0)
    return (
      <text className="ik-screen-text ik-dim" x={4.2} y={10.9} fontSize={5.6}>
        idle
      </text>
    )
  return (
    <>
      <g className="span" style={{ "--in": "0ms", "--out": ms(at) } as CSSProperties}>
        <text className="ik-screen-text ik-dim" x={4.9} y={11.2} fontSize={6.2}>
          ···
        </text>
      </g>
      {failing ? (
        <g className="span" style={{ "--in": ms(at), "--out": ms(RETRIED) } as CSSProperties}>
          <text className="ik-screen-text" x={4.9} y={11.2} fontSize={6.2}>
            500
          </text>
        </g>
      ) : null}
      <g className="from" style={{ "--in": ms(failing ? RETRIED : at) } as CSSProperties}>
        <text className="ik-screen-text" x={4.9} y={11.2} fontSize={6.2}>
          200
        </text>
      </g>
    </>
  )
}

type Pending = { timers: { current: number[] }; stops: { current: Array<() => void> } }

function release(timers: Pending["timers"], stops: Pending["stops"]) {
  for (const timer of timers.current) window.clearTimeout(timer)
  for (const stop of stops.current) stop()
  timers.current = []
  stops.current = []
}

export default function WebhookRelay() {
  const [run, setRun] = useState({ n: 0, settled: false })
  const [touched, setTouched] = useState(false)
  const stops = useRef<Array<() => void>>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => release(timers, stops), [])

  const { n, settled } = run
  const failing = fails(n)
  const done = (failing ? RETRIED : LAST) + ACK_MS
  const later = (wait: number, step: () => void) => timers.current.push(window.setTimeout(step, wait))
  const sound = (wait: number, name: "relay" | "error" | "tick" | "success") => later(wait, () => stops.current.push(playSound(name)))
  const send = (audible: boolean) => {
    release(timers, stops)
    const next = n + 1
    const retrying = fails(next)
    if (audible) {
      stops.current.push(playSound("notify"))
      for (const hook of HOOKS) {
        if (retrying && hook.id === "crm") {
          sound(arrival(hook), "error")
          sound(RETRY_AT, "tick")
          sound(RETRIED, "relay")
        } else sound(arrival(hook), "relay")
      }
      sound((retrying ? RETRIED : LAST) + ACK_MS, "success")
    }
    if (retrying) later(RETRIED, () => setRun((r) => (r.n === next ? { ...r, settled: true } : r)))
    setRun({ n: next, settled: false })
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (n === 0) send(false)
    },
    { delay: 1200 },
  )
  const press = () => {
    dismiss()
    setTouched(true)
    send(true)
  }

  const event = eventOf(n)
  const retries = retriesBy(n)
  const readout = n === 0 ? "1 event queued · 3 hooks" : !failing ? `${event} · delivered · 3/3` : settled ? `${event} · crm retried · 3/3` : `${event} · crm 500 · retrying`

  return (
    <Plate
      {...plate}
      fig="SaaS"
      name="Webhook relay"
      hint={n === 0 ? "Press send" : "Send the next event"}
      readout={readout}
      className="fig-webhook-relay"
      style={PLATE_STYLE}
      data-fresh={n === 0}
      fit={[BASE, SRC, [104, 30, 84], [104, 84, 84]]}
      aspect={1.3}
      label="An app with an outbox tray, cabled to three webhook endpoints: API, CRM and Slack, each with a relay, a lamp and a retry dial. Press send to deliver the event to all three and watch each one answer."
    >
      <g ref={demoAnchor}>
        <Box {...BASE} r={10} />
        <Box
          {...SRC}
          r={6}
          top={
            <>
              <text className="ik-label outbox" x={10} y={44}>
                OUTBOX
              </text>
              <circle className="ik-fill" cx={SRC.w - 8} cy={8} r={1.3} />
              <circle className="ik-fill" cx={SRC.w - 8} cy={SRC.d - 8} r={1.3} />
            </>
          }
          front={
            <>
              <rect className="ik-screen" x={6} y={6} width={48} height={20} rx={3} />
              <g key={n} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={10} y={13.4} fontSize={5.4}>
                  {n === 0 ? "1 queued" : "→ 3 hooks"}
                </text>
                <text className="ik-screen-text" x={10} y={22.4} fontSize={6.4}>
                  {event}
                </text>
              </g>
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <path key={k} className="ik-detail" d={`M${8 + k * 3.2} 31v6`} />
              ))}
              <text className="ik-label ack-label" x={45} y={35.8} textAnchor="end">
                ACK
              </text>
              <g key={`ack-${n}`} style={{ "--t": ms(done) } as CSSProperties}>
                <Glow on={n > 0} className="ack-glow">
                  <circle className="ack" data-on={n > 0} cx={50} cy={34} r={2.2} />
                </Glow>
              </g>
            </>
          }
          side={
            <>
              {HOOKS.map((hook) => (
                <circle key={hook.id} className="ik-well" cx={SRC.y + SRC.d - hook.port} cy={SRC.z + SRC.h - PORT_Z} r={2.4} />
              ))}
              {[0, 1, 2, 3, 4].map((k) => (
                <path key={k} className="ik-detail" d={`M${14 + k * 6} 8v10`} />
              ))}
            </>
          }
        />
        <Box {...TRAY} r={2} top={<rect className="ik-well" x={2.5} y={2.5} width={TRAY.w - 5} height={TRAY.d - 5} rx={1.5} />} />
        <g key={`tray-${n}`} className={n > 0 ? "refill" : undefined} style={{ "--refill": ms(LAST) } as CSSProperties}>
          <Envelope {...ENV} />
        </g>
        {CABLES.map((d, i) => (
          <path key={HOOKS[i]?.id ?? i} className="ik-line" d={d} />
        ))}
        {failing && CRM ? <Signal key={`retry-${n}`} points={cable(CRM)} delay={RETRY_AT} duration={RETRY_MS} /> : null}
        {HOOKS.map((hook) => {
          const failed = failing && hook.id === "crm"
          const at = arrival(hook)
          const lit = failed ? RETRIED : at
          const timing = {
            "--in": ms(failed ? at : at + LAMP_LAG),
            "--retry": ms(RETRIED + LAMP_LAG),
            "--lit": ms(lit),
            "--lamp-at": ms(lit + LAMP_LAG),
          } as CSSProperties
          return (
            <Box
              key={hook.id}
              {...boxOf(hook)}
              r={4}
              top={
                <>
                  <rect className="ik-well" x={22} y={4.5} width={19} height={14} rx={1.5} />
                  <path className="ik-detail" d={`M${ARM.x + ARM.length + 1.4} ${ARM.y - 2.6}v5.2`} />
                  <g key={`arm-${n}`} transform={`translate(${ARM.x} ${ARM.y})`} style={timing}>
                    <g className="arm" data-closing={n > 0}>
                      <path className="ik-line" d={`M0 0h${ARM.length}`} />
                    </g>
                    <circle className="ik-fill" r={1.1} />
                  </g>
                  <text className="ik-label hook" x={5} y={25.5}>
                    {hook.label}
                  </text>
                </>
              }
              front={
                <>
                  <path className="ik-detail" d="M5 7v9M8.2 7v9M11.4 7v9M14.6 7v9" />
                  <path className="ik-detail" d={DETENT_MARKS} />
                  <circle className="ik-face ik-top" cx={DIAL.x} cy={DIAL.y} r={DIAL.r} />
                  <g transform={`translate(${DIAL.x} ${DIAL.y})`}>
                    <g className="dial" style={{ "--step": hook.id === "crm" ? retries : 0 } as CSSProperties}>
                      <path className="ik-line" d={`M0-1V${-DIAL.r + 1}`} />
                    </g>
                  </g>
                </>
              }
              side={
                <>
                  <rect className="ik-screen" x={3} y={3.5} width={15.5} height={10} rx={1.5} />
                  <g key={n}>
                    <Status n={n} hook={hook} />
                  </g>
                  <g key={`lamp-${n}`} style={timing}>
                    <Glow on={n > 0} className="lamp-glow">
                      <circle className="lamp" data-state={n === 0 ? "idle" : failed ? "retry" : "ok"} cx={22.3} cy={8.5} r={2} />
                    </Glow>
                  </g>
                  {failed ? (
                    <g key={`cross-${n}`} className="span" style={{ "--in": ms(at), "--out": ms(RETRIED) } as CSSProperties}>
                      <path className="ik-line ik-thick" d="M20.4 6.6l3.8 3.8M24.2 6.6l-3.8 3.8" />
                    </g>
                  ) : null}
                  <path className="ik-detail" d="M4 18h18M4 20.8h18" />
                </>
              }
            />
          )
        })}
        {!touched && n === 0 && phase !== "aim" && phase !== "press" ? <Ripple {...KEY} r={6} /> : null}
        <Press label="Send the event" material="plastic" onPress={press} data-hot={n === 0}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label key" x={8} y={13.6}>
                    SEND
                  </text>
                  <path className="ik-detail ik-thick plane" d={PLANE} transform={`translate(${KEY.w - 18} 6.4)`} />
                </>
              }
            />
          </g>
        </Press>
        {n > 0 ? (
          <g key={`fly-${n}`}>
            {HOOKS.map((hook) => (
              <Flight key={hook.id} from={[ENV.x, ENV.y, ENV.z]} to={[EP.x + 24, hook.y + 6, EP.z + EP.h]} delay={hook.order * STAGGER} duration={FLY_MS} lift={FLY_LIFT}>
                <Envelope {...ENV} />
              </Flight>
            ))}
          </g>
        ) : null}
        {CRM ? <Callout at={[EP.x + DIAL.x, CRM.y + EP.d, EP.z + EP.h - DIAL.y]} dx={30} dy={40} label={`retries · ${retries}`} /> : null}
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
