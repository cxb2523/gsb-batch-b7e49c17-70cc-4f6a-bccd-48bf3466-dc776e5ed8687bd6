import { type CSSProperties, useEffect, useId, useReducer, useRef, useState } from "react"
import { Box, Cursor, curve, Flight, front, Glow, Plate, Press, path, playSound, Ripple, Signal, type SoundName, useDemoTap, type Vec3 } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import { AGENT_LOGOS, type AgentLogo, PUSHARY_GLYPH, PUSHARY_ICON } from "../../logos/agent-logos"
import "./agent-relay.css"

export const meta = {
  slug: "agent-relay",
  title: "Agent relay",
  industry: "deeptech",
  level: 4,
  blurb: "Press run: six coding agents plan first and ask their one real question up front on the Mac's notch, and on the phone when you step away. Risky commands still ask. The board compares the time and money with and without Pushary.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Flight", "Ripple", "Cursor", "useDemoTap", "curve", "path", "front"],
  sounds: ["cascade", "relay", "notify", "whoosh", "success", "error", "toggle", "beep", "complete"],
} satisfies FigureMeta

type Fork = { question: string; options: readonly [string, string] }
type Agent = { id: AgentLogo; name: string; label: string; project: string; fork: Fork; commands: readonly [string, string, string] | null }
type Kind = "round" | "gate"
type Ask = { kind: Kind; tier: number }
type Phase = "idle" | "working" | "asking" | "retrying" | "waiting" | "done"
type Where = "notch" | "phone" | "terminal"
type Via = "ask" | "push"
type Verdict = "picked" | "changed" | "approved" | "steered" | "denied" | "gave-up"
type Reply = "first" | "second" | "approve" | "steer" | "deny"
type Event = "idle" | "run" | "ask" | "push" | "open" | "presence" | "timeout" | "answer" | "finish"
type Answer = { tier: number; verdict: Verdict; where: Where; seconds: number }
type Tally = { withSeconds: number; withUsd: number; withStops: number; withoutSeconds: number; withoutUsd: number; withoutStops: number }
type TierState = "off" | "plan" | "work" | "wait" | "retry" | "done"
type State = {
  away: boolean
  phase: Phase
  run: number
  started: number
  at: number
  moved: number
  since: number
  via: Via
  doneAt: number
  asked: number
  tries: number
  pushed: boolean
  opened: boolean
  finished: number
  resumed: readonly number[]
  wasted: number
  auto: number
  autoAt: number
  tally: Tally
  beat: number
  event: Event
  latest: "event" | "complete"
  doneTier: number
  last: Answer | null
}
type Action =
  | { type: "run"; now: number }
  | { type: "auto"; now: number }
  | { type: "complete"; tier: number; now: number }
  | { type: "ask"; now: number }
  | { type: "open"; now: number }
  | { type: "presence"; now: number }
  | { type: "timeout"; now: number }
  | { type: "answer"; reply: Reply; from: Where; now: number }
  | { type: "finish"; now: number }

const AGENTS: readonly Agent[] = [
  { id: "opencode", name: "OpenCode", label: "OPENCODE", project: "api", fork: { question: "Migration?", options: ["New table", "Alter in place"] }, commands: ["migrate up", "migrate --dry", "prisma diff"] },
  { id: "hermes", name: "Hermes", label: "HERMES", project: "infra", fork: { question: "Install with?", options: ["Homebrew", "pip"] }, commands: ["brew install", "pip install", "uv tool add"] },
  { id: "antigravity", name: "Antigravity CLI", label: "ANTIGRAVITY CLI", project: "site", fork: { question: "Deploy order?", options: ["Staging first", "Prod now"] }, commands: ["deploy prod", "deploy stage", "deploy dev"] },
  { id: "fx", name: "fx", label: "FX", project: "web", fork: { question: "Clean what?", options: ["dist only", "Every build"] }, commands: null },
  { id: "codex", name: "Codex", label: "CODEX", project: "backend", fork: { question: "Which app?", options: ["Both apps", "Dashboard only"] }, commands: ["git push", "gh pr create", "git push wip"] },
  { id: "claude-code", name: "Claude Code", label: "CLAUDE CODE", project: "pushary", fork: { question: "Rollout?", options: ["Behind the flag", "Straight to main"] }, commands: ["npm publish", "npm pack", "npm link"] },
]
const ALL_DONE = (1 << AGENTS.length) - 1
const ASK_ORDER = [5, 4, 2, 3, 1, 0] as const
const ASKS = 3
const GATE_ORDER = ASK_ORDER.filter((tier) => AGENTS[tier]?.commands)
const RUN_ASKS: readonly (readonly Ask[])[] = ASK_ORDER.map((lead, k) => {
  const gates: Ask[] = []
  for (let step = 0; gates.length < ASKS - 1 && step < GATE_ORDER.length; step++) {
    const tier = GATE_ORDER[(k + 1 + step) % GATE_ORDER.length] ?? 0
    if (tier !== lead) gates.push({ kind: "gate", tier })
  }
  return [{ kind: "round", tier: lead }, ...gates]
})
const PLAN = { steps: 7, facts: 5, forks: 3 }
const MAX_TRIES = 2

const HAND_BACK_S: Readonly<Record<Kind, number>> = { round: 55 + 55, gate: 20 + 60 }
const CHECK_BACK_MIN = 37
const WRONG_GUESS_ODDS = 0.5
const OPUS_PER_MILLION = { input: 5, output: 25, cacheWrite: 1.25, cacheRead: 0.1 }
const CONTEXT_TOKENS = 100_000
const TURN_TOKENS = { fresh: 10_000, output: 6_000 }
const WARM_RESUME_USD = (CONTEXT_TOKENS * OPUS_PER_MILLION.input * OPUS_PER_MILLION.cacheRead) / 1_000_000
const COLD_RESUME_USD = (CONTEXT_TOKENS * OPUS_PER_MILLION.input * OPUS_PER_MILLION.cacheWrite) / 1_000_000
const TURN_USD = WARM_RESUME_USD + (TURN_TOKENS.fresh * OPUS_PER_MILLION.input + TURN_TOKENS.output * OPUS_PER_MILLION.output) / 1_000_000
const RERUN_TURNS = 6

const BASE = { x: 0, y: 0, z: 0, w: 302, d: 158, h: 8 }
const RACK = { x: 10, y: 22, w: 66, d: 54 }
const POST = 6
const HEAD = { x: RACK.x, y: RACK.y, z: BASE.h, w: RACK.w, d: RACK.d, h: 10 }
const Z0 = HEAD.z + HEAD.h
const PITCH = 13.5
const NODE = { x: RACK.x + POST, y: RACK.y + 1, w: RACK.w - 2 * POST, d: RACK.d - 3, h: 12 }
const CAP = { x: RACK.x, y: RACK.y, z: Z0 + AGENTS.length * PITCH, w: RACK.w, d: RACK.d, h: 4 }
const LEFT = { x: RACK.x, y: RACK.y, z: Z0, w: POST, d: RACK.d, h: CAP.z - Z0 }
const RIGHT = { ...LEFT, x: RACK.x + RACK.w - POST }
const LID = { x: 100, y: 12, z: 10, w: 114, d: 4, h: 78 }
const DECK = { x: 100, y: 16, z: BASE.h, w: 114, d: 64, h: 5 }
const HUB = { x: 96, y: 98, z: BASE.h, w: 32, d: 32, h: 12 }
const STAND = { x: 240, y: 24, z: BASE.h, w: 62, d: 30, h: 5 }
const PHONE = { x: 244, y: 34, z: STAND.z + STAND.h, w: 54, d: 5, h: 108 }
const FOOT = { x: 194, y: 118, z: BASE.h, w: 82, d: 16, h: 3 }
const BOARD = { x: 196, y: 123, z: FOOT.z + FOOT.h, w: 78, d: 4, h: 40 }
const RUN_KEY = { x: 24, y: 104, z: BASE.h, w: 48, d: 17, h: 6 }
const SWITCH = { x: 30, y: 128, z: BASE.h, w: 54, d: 15, h: 5 }
const SLIDER = { x: SWITCH.x + 3, y: SWITCH.y + 2.5, z: SWITCH.z + SWITCH.h, w: 24, d: 10, h: 4 }
const NOTCH = { x: LID.w / 2, y: 3 }
const CARD = { w: 92, round: 43, gate: 40 }
const PILL = { w: 76, h: 9.4 }
const NOTE = { x: 3, y: 38, w: 48, h: 21 }
const MENU = { x: 3, y: 61.5, w: 48, row: 8.5, icon: 7.8, label: 12.6 }
const SHEET = { x: 2, y: 2, w: 50, h: 104, option: 42 }
const PROMPT = { x: 13, y: 62, w: 88, h: 6.4 }
const SCREEN = { x: 3, y: 8.4, w: BOARD.w - 6, h: BOARD.h - 11.4 }
const ARMATURE = { x: 18.2, y: 29.4, w: 6 }

const HUB_TOP: Vec3 = [HUB.x + HUB.w / 2, HUB.y + HUB.d / 2, HUB.z + HUB.h]
const NOTCH_AT: Vec3 = [LID.x + NOTCH.x, LID.y + LID.d, LID.z + LID.h - 6]
const PHONE_AT: Vec3 = [PHONE.x + PHONE.w / 2, PHONE.y + PHONE.d, PHONE.z + PHONE.h - NOTE.y - 6]
const TRUNK: readonly Vec3[] = curve([RACK.x + RACK.w, 66, 13], [88, 66, BASE.h + 1.2], [88, 110, BASE.h + 1.2], [HUB.x + 1, HUB.y + 16, BASE.h + 4], 32)
const TO_NOTCH: readonly Vec3[] = curve(HUB_TOP, [HUB_TOP[0], HUB_TOP[1], 64], [NOTCH_AT[0], 44, 100], NOTCH_AT, 40)
const TO_PHONE: readonly Vec3[] = curve(HUB_TOP, [150, 106, 74], [246, 52, 132], PHONE_AT, 40)
const FROM_NOTCH = [...TO_NOTCH].reverse()
const FROM_PHONE = [...TO_PHONE].reverse()
const FROM_HUB = [...TRUNK].reverse()

const HOP_MS = 380
const ARRIVE_MS = 2 * HOP_MS
const HOLD_MS = 10000
const PLAN_MS = 2600
const NEXT_ASK_MS = 1900
const FLY_MS = 620
const RETRY_MS = 1400
const FINISH_MS = 900
const AUTO_MS = 480
const STAGGER_MS = 60
const RESUME_MS = 2 * HOP_MS
const SETTLE_MS = 1100
const LEAD_WORK_MS = 3800
const SOLO_DONE_MS = 3200
const SOLO_STEP_MS = 800

const NO_TALLY: Tally = { withSeconds: 0, withUsd: 0, withStops: 0, withoutSeconds: 0, withoutUsd: 0, withoutStops: 0 }
const NO_RESUMES: readonly number[] = AGENTS.map(() => 0)
const START: State = {
  away: false,
  phase: "idle",
  run: 0,
  started: 0,
  at: 0,
  moved: 0,
  since: 0,
  via: "ask",
  doneAt: 0,
  asked: 0,
  tries: 0,
  pushed: false,
  opened: false,
  finished: 0,
  resumed: NO_RESUMES,
  wasted: 0,
  auto: 0,
  autoAt: 0,
  tally: NO_TALLY,
  beat: 0,
  event: "idle",
  latest: "event",
  doneTier: 0,
  last: null,
}

const asksOf = (run: number): readonly Ask[] => RUN_ASKS[(run + RUN_ASKS.length - 1) % RUN_ASKS.length] ?? []
const askOf = (s: State): Ask => asksOf(s.run)[s.asked] ?? { kind: "gate", tier: 0 }
const agentAt = (tier: number): Agent => AGENTS[tier] ?? AGENTS[0]!
const commandOf = (agent: Agent, tries: number): string => (agent.commands ? (agent.commands[Math.min(tries, agent.commands.length - 1)] ?? agent.commands[0]) : "")
const isActive = (phase: Phase) => phase === "working" || phase === "asking" || phase === "retrying" || phase === "waiting"
const isDone = (s: State, tier: number) => (s.finished & (1 << tier)) !== 0
const isPlanning = (s: State) => s.phase === "working" && s.asked === 0
const shownAt = (s: State) => s.since + ARRIVE_MS
const realSeconds = (waited: number, kind: Kind) => {
  const shown = Math.min(HOLD_MS, Math.max(0, waited - ARRIVE_MS))
  return Math.max(1, Math.round((shown / HOLD_MS) * HAND_BACK_S[kind]))
}
const GLYPH_EM: ReadonlyMap<string, number> = new Map(
  Object.entries({ " ": 0.27, ijlI: 0.32, ".:'": 0.37, ft: 0.42, r: 0.48, "1-": 0.53, "sz?": 0.58, acekvxyFJL: 0.64, "04689BKPRSYZ": 0.74, ACDGUVX: 0.8, HNOQ: 0.85, wM: 0.93, "mW…": 1.03 }).flatMap(([glyphs, em]) => [...glyphs].map((glyph) => [glyph, em] as const)),
)
const widthOf = (text: string, size: number) => {
  let em = 0
  for (const glyph of text) em += GLYPH_EM.get(glyph) ?? 0.69
  return em * size
}
const ellipsize = (text: string, size: number, room: number) => {
  if (widthOf(text, size) <= room) return text
  let cut = text.length
  while (cut > 1 && widthOf(`${text.slice(0, cut).trimEnd()}…`, size) > room) cut--
  return `${text.slice(0, cut).trimEnd()}…`
}
const usd = (value: number) => `$${value.toFixed(2)}`
const ms = (value: number) => `${value}ms`
const duration = (seconds: number) => {
  if (seconds < 90) return `${Math.round(seconds)}s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
const baselineOf = (kind: Kind) => {
  const stops = kind === "round" ? PLAN.forks : 1
  return { stops, seconds: stops * CHECK_BACK_MIN * 60, usd: stops * COLD_RESUME_USD + (kind === "round" ? WRONG_GUESS_ODDS * RERUN_TURNS * TURN_USD : 0) }
}

function settle(s: State, seconds: number, from: Where): Tally {
  const base = baselineOf(askOf(s).kind)
  return {
    withSeconds: s.tally.withSeconds + seconds,
    withUsd: s.tally.withUsd + (from === "terminal" ? COLD_RESUME_USD : WARM_RESUME_USD),
    withStops: s.tally.withStops + 1,
    withoutSeconds: s.tally.withoutSeconds + base.seconds,
    withoutUsd: s.tally.withoutUsd + base.usd,
    withoutStops: s.tally.withoutStops + base.stops,
  }
}

function advance(s: State, a: Action): State {
  const next = (patch: Partial<State>, event: Event): State => ({ ...s, ...patch, event, latest: "event", beat: s.beat + 1 })
  const ask = askOf(s)
  switch (a.type) {
    case "run":
      if (isActive(s.phase)) return s
      return next(
        {
          phase: "working",
          run: s.run + 1,
          started: a.now,
          at: a.now,
          autoAt: a.now,
          doneAt: a.now,
          asked: 0,
          tries: 0,
          pushed: false,
          opened: false,
          finished: 0,
          resumed: NO_RESUMES,
          wasted: 0,
          auto: 0,
          tally: NO_TALLY,
          last: null,
        },
        "run",
      )
    case "auto":
      return isActive(s.phase) ? { ...s, auto: s.auto + 1, autoAt: a.now } : s
    case "complete":
      if (!isActive(s.phase) || isDone(s, a.tier)) return s
      return { ...s, finished: s.finished | (1 << a.tier), doneAt: a.now, doneTier: a.tier, latest: "complete" }
    case "ask":
      if (!((s.phase === "working" && s.asked < ASKS) || s.phase === "retrying")) return s
      return next({ phase: "asking", at: a.now, since: a.now, via: "ask", pushed: s.away, opened: false }, "ask")
    case "open":
      return s.phase === "asking" && s.pushed && ask.kind === "round" && !s.opened ? next({ opened: true }, "open") : s
    case "presence":
      if (!s.away && s.phase === "asking" && !s.pushed) return next({ away: true, moved: a.now, pushed: true, via: "push" }, "push")
      return next({ away: !s.away, moved: a.now }, "presence")
    case "timeout":
      if (s.phase !== "asking") return s
      return next({ phase: "waiting", at: a.now, pushed: false, opened: false, last: { tier: ask.tier, verdict: "gave-up", where: s.pushed ? "phone" : "notch", seconds: HAND_BACK_S[ask.kind] } }, "timeout")
    case "answer": {
      if (s.phase !== "asking" && s.phase !== "waiting") return s
      if (a.from === "phone" && !s.pushed) return s
      const from: Where = s.phase === "waiting" ? "terminal" : a.from
      const seconds = from === "terminal" ? CHECK_BACK_MIN * 60 : realSeconds(a.now - s.since, ask.kind)
      if (a.reply === "deny" && s.tries < MAX_TRIES) {
        return next({ phase: "retrying", at: a.now, tries: s.tries + 1, wasted: s.wasted + 1, pushed: false, opened: false, last: { tier: ask.tier, verdict: "denied", where: from, seconds } }, "answer")
      }
      const verdict: Verdict = ask.kind === "round" ? (a.reply === "first" ? "picked" : "changed") : a.reply === "steer" ? "steered" : a.reply === "deny" ? "denied" : "approved"
      const resumed = s.resumed.map((time, tier) => (tier === ask.tier ? a.now : time))
      return next({ phase: "working", at: a.now, asked: s.asked + 1, tries: 0, pushed: false, opened: false, resumed, tally: settle(s, seconds, from), last: { tier: ask.tier, verdict, where: from, seconds } }, "answer")
    }
    case "finish":
      return s.phase === "working" && s.asked === ASKS && s.finished === ALL_DONE ? next({ phase: "done", at: a.now }, "finish") : s
  }
}

function tierStateOf(s: State, tier: number): TierState {
  if (isDone(s, tier)) return "done"
  if (s.phase === "idle") return "off"
  if (s.phase === "done") return "done"
  const ask = askOf(s)
  if (tier === ask.tier && (s.phase === "asking" || s.phase === "waiting")) return "wait"
  if (tier === ask.tier && s.phase === "retrying") return "retry"
  if (tier === asksOf(s.run)[0]?.tier && s.asked === 0) return "plan"
  return "work"
}

function withCost(s: State) {
  return s.tally.withUsd + s.wasted * TURN_USD
}

function savedOf(s: State) {
  return { seconds: Math.max(0, s.tally.withoutSeconds - s.tally.withSeconds), usd: Math.max(0, s.tally.withoutUsd - withCost(s)) }
}

function hintOf(s: State, ask: Ask, agent: Agent): string {
  if (!isActive(s.phase)) return "Press run"
  if (s.phase === "waiting") return "Answer in the terminal"
  if (s.phase === "retrying") return `${agent.name} is trying another route`
  if (s.phase === "asking") return ask.kind === "round" ? "Pick an answer" : "Approve or deny"
  return s.away ? "Press desk to come back" : "Press away to step out"
}

function readoutOf(s: State): string {
  const ask = askOf(s)
  const agent = agentAt(ask.tier)
  const name = agent.name.toLowerCase()
  const command = commandOf(agent, s.tries)
  const last = s.last ? agentAt(s.last.tier) : agent
  const who = last.name.toLowerCase()
  const saved = savedOf(s)
  if (s.latest === "complete" && s.phase === "working") return `${agentAt(s.doneTier).name.toLowerCase()} done`
  switch (s.event) {
    case "idle":
      return `${AGENTS.length} agents · idle`
    case "run":
      if (!isPlanning(s)) return `${AGENTS.length} agents working`
      return s.auto ? `${name} plans · ${s.auto} lookup${s.auto === 1 ? "" : "s"} auto-approved` : `${name} plans first`
    case "presence":
      return s.away ? "away · asks go straight to your phone" : "at the desk · your phone stays quiet"
    case "push":
      return `away · ${name} sent to your phone`
    case "open":
      return "face id · question open in pushary"
    case "ask":
      if (ask.kind === "round") return `${name} asks 1 question up front`
      if (s.tries) return `${name} tries ${command} instead`
      return `${name} wants to run ${command}`
    case "timeout":
      return `no answer in ${s.last?.seconds ?? 0} s · back to the terminal`
    case "answer":
      if (!s.last) return "answered"
      if (s.last.verdict === "picked") return `${last.fork.options[0].toLowerCase()} · ${who} goes ahead`
      if (s.last.verdict === "changed") return "plan changed before a token was spent"
      if (s.last.verdict === "denied") return `denied · ${who} tries another route`
      if (s.last.verdict === "steered") return `denied with a note · ${who} adjusts`
      if (s.last.where === "terminal") return `approved ${CHECK_BACK_MIN} min later · ${who} resumes`
      return `approved in ${s.last.seconds} s · ${who} keeps going`
    case "finish":
      return `done · saved ${duration(saved.seconds)} and ${usd(saved.usd)}`
  }
}

function Tile({ id, x, y, size, clip }: { id: AgentLogo; x: number; y: number; size: number; clip: string }) {
  return <image href={AGENT_LOGOS[id]} x={x} y={y} width={size} height={size} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
}

function Glyph({ x, y, height, mask, className }: { x: number; y: number; height: number; mask: string; className: string }) {
  return <rect className={className} x={x} y={y} width={height * PUSHARY_GLYPH.aspect} height={height} mask={`url(#${mask})`} />
}

function Check({ x, y }: { x: number; y: number }) {
  return <path className="check" d={`M${x - 1.8} ${y}l1.3 1.4 2.6-3`} />
}

export default function AgentRelay() {
  const [s, dispatch] = useReducer(advance, START)
  const [touched, setTouched] = useState(false)
  const timers = useRef<number[]>([])
  const stops = useRef<Array<() => void>>([])
  const audible = useRef(false)
  const relayed = useRef("")
  const ids = useId().replace(/:/g, "")
  const tile = `${ids}-tile`
  const glyph = `${ids}-glyph`

  useEffect(() => {
    const now = performance.now()
    const at = (when: number, act: () => void) => timers.current.push(window.setTimeout(act, Math.max(0, when - now)))
    const send = (type: "ask" | "timeout" | "finish" | "auto") => () => dispatch({ type, now: performance.now() })
    const tell = (when: number, name: SoundName) => {
      if (audible.current && when > now - 120) at(when, () => stops.current.push(playSound(name)))
    }
    const asks = asksOf(s.run)
    const lookup = `${s.run}:${s.auto}`
    if (isPlanning(s) && s.auto > 0 && relayed.current !== lookup) {
      relayed.current = lookup
      tell(s.autoAt, "relay")
    }
    if (isActive(s.phase)) {
      if (isPlanning(s) && s.auto < PLAN.facts) at(s.autoAt + AUTO_MS, send("auto"))
      AGENTS.forEach((_, tier) => {
        if (isDone(s, tier)) return
        const role = asks.findIndex((entry) => entry.tier === tier)
        const resumed = s.resumed[tier] ?? 0
        const complete = () => dispatch({ type: "complete", tier, now: performance.now() })
        if (role < 0) at(s.started + SOLO_DONE_MS + tier * SOLO_STEP_MS, complete)
        else if (resumed) at(resumed + RESUME_MS + (role === 0 ? LEAD_WORK_MS : SETTLE_MS), complete)
      })
    }
    if (s.phase === "working") {
      if (s.asked < ASKS) at(s.at + (s.asked === 0 ? PLAN_MS : NEXT_ASK_MS), send("ask"))
      else if (s.finished === ALL_DONE) at(s.doneAt + FINISH_MS, send("finish"))
    }
    if (s.phase === "retrying") at(s.at + RETRY_MS, send("ask"))
    if (s.phase === "asking") {
      at(shownAt(s) + HOLD_MS, send("timeout"))
      if (s.event === "ask") tell(shownAt(s), "notify")
      if (s.event === "push") {
        tell(s.moved, "whoosh")
        tell(s.moved + FLY_MS, "notify")
      }
    }
    if (s.event === "timeout") tell(s.at, "beep")
    if (s.event === "finish") tell(s.at, "complete")
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      timers.current = []
    }
  }, [s])
  useEffect(
    () => () => {
      for (const stop of stops.current) stop()
    },
    [],
  )

  const hush = () => {
    for (const stop of stops.current) stop()
    stops.current = []
  }
  const play = (name: SoundName, options?: Parameters<typeof playSound>[1]) => {
    if (audible.current) stops.current.push(playSound(name, options))
  }
  const start = () => {
    hush()
    play("cascade", { count: AGENTS.length, stagger: STAGGER_MS / 1000 })
    dispatch({ type: "run", now: performance.now() })
  }
  const demo = useDemoTap(
    () => {
      if (s.phase === "idle") start()
    },
    { delay: 900 },
  )
  const reader = () => {
    demo.dismiss()
    setTouched(true)
    audible.current = true
  }
  const run = () => {
    reader()
    start()
  }
  const answer = (reply: Reply, from: Where) => {
    reader()
    hush()
    play(reply === "deny" ? "error" : reply === "steer" || reply === "second" ? "toggle" : "success")
    dispatch({ type: "answer", reply, from, now: performance.now() })
  }
  const open = () => {
    reader()
    hush()
    dispatch({ type: "open", now: performance.now() })
  }
  const step = () => {
    reader()
    hush()
    play("toggle")
    dispatch({ type: "presence", now: performance.now() })
  }

  const ask = askOf(s)
  const agent = agentAt(ask.tier)
  const command = commandOf(agent, s.tries)
  const runHot = !isActive(s.phase)
  const card = `${s.run}-${s.asked}-${s.tries}`
  const arrive = s.via === "ask" ? ARRIVE_MS : FLY_MS
  const receipt = s.event === "answer" || s.event === "timeout" ? s.last : null
  const surface = { s, agent, ask, command, card, arrive, receipt, clip: tile, frame: ids, answer, open }

  return (
    <Plate
      {...demo.plate}
      fig="Deep tech"
      name="Agent relay"
      hint={hintOf(s, ask, agent)}
      readout={readoutOf(s)}
      className="fig-agent-relay"
      style={{ "--lamp-step": ms(STAGGER_MS) } as CSSProperties}
      data-phase={s.phase}
      data-away={s.away}
      fit={[BASE, { x: RACK.x, y: RACK.y, z: 0, w: RACK.w, d: RACK.d, h: CAP.z + CAP.h }, { ...PHONE, z: 0, h: PHONE.z + PHONE.h }, { ...LID, z: 0, h: LID.z + LID.h }, [NOTCH_AT[0], 44, 100]]}
      aspect={1.35}
      label="Six coding agents in a rack, a Pushary relay, a MacBook with a notch, an iPhone on a stand and a board comparing this run with no Pushary. Press run: the lead agent plans first, settles facts with lookups the relay auto-approves, then asks one question up front on the notch. At the desk your phone stays quiet; step away and the question goes to your phone too, and the first answer wins. Risky commands still ask, and one nobody answers goes back to the agent's own terminal prompt."
    >
      <defs>
        <clipPath id={tile} clipPathUnits="objectBoundingBox">
          <rect width={1} height={1} rx={0.225} ry={0.225} />
        </clipPath>
        <clipPath id={`${ids}-note`}>
          <rect x={NOTE.x} y={NOTE.y} width={NOTE.w} height={NOTE.h} rx={5} />
        </clipPath>
        <clipPath id={`${ids}-menu`}>
          <rect x={MENU.x} y={MENU.y} width={MENU.w} height={MENU.row * 3} rx={4.4} />
        </clipPath>
        <clipPath id={`${ids}-sheet`}>
          <rect x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} rx={8} />
        </clipPath>
        <clipPath id={`${ids}-board`}>
          <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.4} />
        </clipPath>
        <mask id={glyph} maskContentUnits="objectBoundingBox" style={{ maskType: "alpha" }}>
          <image href={PUSHARY_GLYPH.href} width={1} height={1} preserveAspectRatio="none" />
        </mask>
      </defs>
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={7} />
              <text className="ik-label switch-word" data-on={!s.away} x={SWITCH.x + 4} y={SWITCH.y + SWITCH.d + 6}>
                DESK
              </text>
              <text className="ik-label switch-word" data-on={s.away} x={SWITCH.x + SWITCH.w - 4} y={SWITCH.y + SWITCH.d + 6} textAnchor="end">
                AWAY
              </text>
            </>
          }
        />

        <Box {...HEAD} r={3} />
        <Box {...LEFT} r={1.5} front={<RackHoles />} />
        {AGENTS.map((a, tier) => (
          <Tier key={a.id} agent={a} tier={tier} state={tierStateOf(s, tier)} clip={tile} />
        ))}
        <Box {...RIGHT} r={1.5} front={<RackHoles />} />
        <Box {...CAP} r={3} top={<rect className="ik-detail" x={8} y={8} width={RACK.w - 16} height={RACK.d - 16} rx={4} />} />
        <path className="ik-line" d={path(TRUNK)} />
        <g key={`trunk-${s.beat}-${s.auto}`}>
          {isPlanning(s) && s.auto ? <Signal className="auto-pulse" points={TRUNK} duration={300} /> : null}
          {s.event === "ask" ? <Signal points={TRUNK} duration={HOP_MS} /> : null}
          {s.event === "answer" && s.last ? <Signal points={FROM_HUB} delay={s.last.where === "terminal" ? 0 : HOP_MS} duration={HOP_MS} /> : null}
        </g>

        <Box {...LID} r={2} front={<Screen {...surface} glyph={glyph} />} />
        <Box
          {...DECK}
          r={4}
          top={
            <>
              <rect className="ik-well" x={10} y={8} width={DECK.w - 20} height={30} rx={2} />
              {[14, 20, 26, 32].map((y) => (
                <path key={y} className="ik-detail" d={`M12 ${y}h${DECK.w - 24}`} />
              ))}
              {Array.from({ length: 14 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${18 + k * 6} 10v26`} />
              ))}
              <rect className="ik-detail" x={DECK.w / 2 - 20} y={42} width={40} height={18} rx={2} />
            </>
          }
          front={<path className="ik-detail" d={`M${DECK.w / 2 - 8} 1.4h16`} />}
        />

        <Box
          {...HUB}
          r={8}
          top={
            <>
              <circle className="ik-detail" cx={HUB.w / 2} cy={HUB.d / 2} r={12.5} />
              <circle key={`led-${s.auto}`} className="hub-led" data-on={isPlanning(s) && s.auto > 0} cx={HUB.w - 5} cy={HUB.d - 5} r={1.3} />
              <path className="ik-detail" d={`M${ARMATURE.x + ARMATURE.w - 0.6} ${ARMATURE.y - 1.8}v1.2`} />
              <g transform={`translate(${ARMATURE.x} ${ARMATURE.y})`}>
                <g key={`arm-${s.auto}`} className="armature" data-on={isPlanning(s) && s.auto > 0}>
                  <path className="ik-line" d={`M0 0h${ARMATURE.w}`} />
                </g>
                <circle className="ik-fill" r={0.7} />
              </g>
              <Glyph className="glyph" x={HUB.w / 2 - 6.4 * PUSHARY_GLYPH.aspect} y={HUB.d / 2 - 6.4} height={12.8} mask={glyph} />
            </>
          }
          front={
            <text className="ik-label hub-word" x={HUB.w / 2} y={8} textAnchor="middle">
              PUSHARY
            </text>
          }
        />

        <Box {...STAND} r={7} top={<rect className="ik-well" x={4} y={8} width={STAND.w - 8} height={9} rx={3.5} />} />
        <Box {...PHONE} r={4} front={<LockScreen {...surface} />} side={<path className="ik-detail" d="M2 22v8M2 34v8" />} />

        <Box {...FOOT} r={4} />
        <Box {...BOARD} r={2.2} front={<Savings s={s} glyph={glyph} clip={`${ids}-board`} />} />

        <g key={`air-${s.beat}`}>
          {s.event === "ask" ? <Signal points={TO_NOTCH} delay={HOP_MS} duration={HOP_MS} /> : null}
          {s.event === "ask" && s.pushed ? <Signal points={TO_PHONE} delay={HOP_MS} duration={HOP_MS} /> : null}
          {s.event === "answer" && s.last && s.last.where !== "terminal" ? <Signal points={s.last.where === "phone" ? FROM_PHONE : FROM_NOTCH} duration={HOP_MS} /> : null}
          {s.event === "push" ? (
            <Flight from={HUB_TOP} to={PHONE_AT} duration={FLY_MS} lift={30}>
              <AskChip at={HUB_TOP} agent={agent} clip={tile} />
            </Flight>
          ) : null}
        </g>

        {!touched && runHot && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...RUN_KEY} r={6} /> : null}
        <Press label={s.phase === "done" ? "Run the agents again" : "Run the agents"} material="plastic" onPress={run} disabled={!runHot} data-hot={runHot}>
          <g>
            <Box
              {...RUN_KEY}
              r={6}
              top={
                <>
                  <text className="ik-label key" x={8} y={12}>
                    RUN
                  </text>
                  <path className="ik-detail ik-thick play" d="M0 0l5 3.2L0 6.4z" transform={`translate(${RUN_KEY.w - 14} 5.3)`} />
                </>
              }
            />
          </g>
        </Press>
        <Press label={s.away ? "Come back to the desk" : "Step away from the desk"} material="plastic" onPress={step}>
          <g>
            <Box {...SWITCH} r={5} top={<rect className="ik-well" x={3} y={2.5} width={SWITCH.w - 6} height={SWITCH.d - 5} rx={4} />} />
            <g className="slider">
              <Box {...SLIDER} r={4} top={<path className="ik-detail" d={`M${SLIDER.w / 2 - 4} ${SLIDER.d / 2}h8`} />} />
            </g>
          </g>
        </Press>
        <Cursor at={[RUN_KEY.x + RUN_KEY.w / 2, RUN_KEY.y + RUN_KEY.d / 2, RUN_KEY.z + RUN_KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}

function RackHoles() {
  return (
    <>
      {Array.from({ length: 17 }, (_, k) => (
        <circle key={k} className="ik-fill" cx={POST / 2} cy={4 + k * 4.8} r={0.6} />
      ))}
    </>
  )
}

function Tier({ agent, tier, state, clip }: { agent: Agent; tier: number; state: TierState; clip: string }) {
  return (
    <g className="tier" data-state={state} style={{ "--i": tier } as CSSProperties}>
      <Box
        {...NODE}
        z={Z0 + tier * PITCH}
        r={2}
        front={
          <>
            <Tile id={agent.id} x={2.4} y={1.8} size={8.4} clip={clip} />
            <text className="ik-label tier-name" x={13.4} y={6.6}>
              {agent.label}
            </text>
            <path className="ik-detail" d="M13.4 9.2h28" />
            <path className="ik-detail work ik-loop" d="M13.4 9.2h28" pathLength={100} />
            <Glow on={state === "plan" || state === "work" || state === "wait" || state === "retry"} className="lamp-glow">
              <circle className="lamp ik-loop" cx={NODE.w - 4.2} cy={6} r={1.6} />
            </Glow>
            <Check x={NODE.w - 4.2} y={6.5} />
          </>
        }
      />
    </g>
  )
}

function AskChip({ at, agent, clip }: { at: Vec3; agent: Agent; clip: string }) {
  return (
    <g transform={front(at[0] - 15, at[1], at[2] + 5)}>
      <rect className="isle" width={30} height={9} rx={3} />
      <Tile id={agent.id} x={2} y={1.8} size={5.4} clip={clip} />
      <circle className="isle-dot" cx={22} cy={4.5} r={1} />
      <path className="chip-line" d="M9.6 4.5h8" />
    </g>
  )
}

function Savings({ s, glyph, clip }: { s: State; glyph: string; clip: string }) {
  const { tally } = s
  const asked = tally.withoutStops > 0
  const saved = savedOf(s)
  const spent = withCost(s)
  const share = asked ? Math.max(0.03, Math.min(1, spent / tally.withoutUsd)) : 0
  const left = SCREEN.x + 3.4
  const bar = SCREEN.w - 6.8
  return (
    <>
      <Glyph className="board-glyph" x={4} y={2.4} height={4.2} mask={glyph} />
      <text className="ik-label board-title" x={8.6} y={6}>
        {`VS NO PUSHARY · ${CHECK_BACK_MIN} MIN A STOP`}
      </text>
      <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.4} />
      <g clipPath={`url(#${clip})`}>
        <g key={`saved-${s.run}-${tally.withStops}-${s.wasted}`} className="ik-enter">
          <text className="ik-screen-text" x={left} y={15.6} fontSize={3.8}>
            <tspan className="meter-dim">saved </tspan>
            <tspan className="board-value" fontSize={5.6}>
              {asked ? `${duration(saved.seconds)} · ${usd(saved.usd)}` : "–"}
            </tspan>
          </text>
          <text className="ik-screen-text" x={left} y={22.6} fontSize={3.8}>
            <tspan className="meter-dim">without </tspan>
            {asked ? `${duration(tally.withoutSeconds)} · ${usd(tally.withoutUsd)}` : `${CHECK_BACK_MIN}m a stop`}
          </text>
          <text className="ik-screen-text" x={left} y={30.6} fontSize={3.8}>
            <tspan className="meter-dim">pushary </tspan>
            {asked ? `${duration(tally.withSeconds)} · ${usd(spent)}` : "seconds"}
          </text>
        </g>
        <rect className="bar-track" x={left} y={24} width={bar} height={1.6} rx={0.8} />
        <rect className="bar-without" data-on={asked} x={left} y={24} width={bar} height={1.6} rx={0.8} />
        <rect className="bar-track" x={left} y={32} width={bar} height={1.6} rx={0.8} />
        <rect className="bar-with" data-on={asked} x={left} y={32} width={bar} height={1.6} rx={0.8} style={{ "--share": share } as CSSProperties} />
      </g>
    </>
  )
}

type SurfaceProps = { s: State; agent: Agent; ask: Ask; command: string; card: string; arrive: number; receipt: Answer | null; clip: string; frame: string; answer: (reply: Reply, from: Where) => void; open: () => void }

const PILL_WORDS: Readonly<Record<Verdict, string>> = {
  picked: "Answered",
  changed: "Answered",
  approved: "Approved",
  steered: "Denied",
  denied: "Denied",
  "gave-up": "Withdrawn",
}

function Screen({ s, agent, ask, command, card, receipt, clip, answer, glyph }: SurfaceProps & { glyph: string }) {
  const onNotch = s.phase === "asking"
  const waiting = s.phase === "waiting"
  const lead = agentAt(asksOf(s.run)[0]?.tier ?? 0)
  return (
    <>
      <rect className="ik-screen mac" x={3} y={3} width={LID.w - 6} height={LID.h - 6} rx={3} />
      <g className="desktop">
        <path className="menubar" d={`M3 9.5h${LID.w - 6}`} />
        <Glyph className="menu-glyph" x={LID.w - 9.6} y={4.4} height={3.8} mask={glyph} />
        <rect className="window" x={10} y={16} width={LID.w - 20} height={55} rx={2.5} />
        <path className="menubar" d={`M10 21.5h${LID.w - 20}`} />
        {[0, 1, 2].map((k) => (
          <circle key={k} className="dot" cx={14 + k * 3.6} cy={18.8} r={1} />
        ))}
        {[28, 33, 38, 43, 48, 53].map((y, k) => (
          <path key={y} className="log" d={`M15 ${y}h${[56, 38, 64, 30, 48, 42][k] ?? 30}`} />
        ))}
      </g>
      {waiting ? (
        <Press className="ik-lift tap" material="glass" label={ask.kind === "round" ? `Answer ${agent.fork.question} in the terminal` : `Allow ${command} in the terminal`} onPress={() => answer(ask.kind === "round" ? "first" : "approve", "terminal")} data-hot={true}>
          <g key={`prompt-${card}`} className="prompt">
            <rect className="prompt-row ik-loop" x={PROMPT.x} y={PROMPT.y} width={PROMPT.w} height={PROMPT.h} rx={1.4} />
            <text className="ui-mono prompt-text" x={PROMPT.x + 2.4} y={PROMPT.y + 4.5} fontSize={3.8}>
              {ask.kind === "round" ? `? ${agent.fork.question} › ${agent.fork.options[0]}` : `? Allow bash: ${command} (y/n)`}
            </text>
          </g>
        </Press>
      ) : null}
      <path className="isle" d={islePath(16, 4.6, 2.2, 1.6)} />
      {onNotch ? (
        <DecisionCard key={`card-${card}`} agent={agent} ask={ask} command={command} clip={clip} answer={answer} />
      ) : waiting ? (
        <Pill key={`pill-${card}`} id={agent.id} clip={clip} name={agent.name} status="needs" />
      ) : isPlanning(s) ? (
        <Pill key={`plan-${s.run}`} id={lead.id} clip={clip} name={lead.name} status="working" />
      ) : receipt ? (
        <Pill key={`receipt-${s.beat}`} id={agentAt(receipt.tier).id} clip={clip} name={agentAt(receipt.tier).name} status={receipt.verdict} phone={receipt.where === "phone"} fade />
      ) : null}
    </>
  )
}

type PillStatus = "needs" | "working" | Verdict

function Pill({ id, clip, name, status, phone = false, fade = false }: { id: AgentLogo; clip: string; name: string; status: PillStatus; phone?: boolean; fade?: boolean }) {
  const nx = NOTCH.x
  const right = nx + PILL.w / 2 - 3.4
  const word = status === "needs" ? "Needs you" : status === "working" ? "Working" : PILL_WORDS[status]
  const mark = right - word.length * 2.45 - (phone ? 4.6 : 0) - 3.6
  return (
    <g className={fade ? "island pill receipt" : "island pill"}>
      <path className="isle" d={islePath(PILL.w, PILL.h, 2.2, 4)} />
      <Tile id={id} x={nx - PILL.w / 2 + 3.2} y={4.6} size={5.2} clip={clip} />
      <text className="isle-text strong" x={nx - PILL.w / 2 + 10.2} y={8.9} fontSize={3.6}>
        {name}
      </text>
      {status === "needs" ? <circle className="isle-dot ik-loop" cx={mark} cy={7.7} r={1} /> : null}
      {status === "working" ? <path className="isle-spin ik-loop" d={`M${mark + 1.3} ${7.7}a1.3 1.3 0 1 1 -1.3 -1.3`} /> : null}
      {status === "approved" || status === "picked" || status === "changed" ? (
        <g>
          <circle className="isle-check" cx={mark} cy={7.7} r={1.6} />
          <path className="isle-tick" d={`M${mark - 0.8} ${7.7}l.6.6 1.1-1.2`} />
        </g>
      ) : null}
      <text className="isle-text strong" x={right - (phone ? 4.6 : 0)} y={8.9} fontSize={3.6} textAnchor="end">
        {word}
      </text>
      {phone ? <rect className="isle-phone" x={right - 2.2} y={5.6} width={2.2} height={4} rx={0.6} /> : null}
    </g>
  )
}

function DecisionCard({ agent, ask, command, clip, answer }: { agent: Agent; ask: Ask; command: string; clip: string; answer: (reply: Reply, from: Where) => void }) {
  const left = NOTCH.x - CARD.w / 2 + 4
  const right = NOTCH.x + CARD.w / 2 - 4
  const height = ask.kind === "round" ? CARD.round : CARD.gate
  return (
    <g className="island card" style={{ "--arrive": ms(ARRIVE_MS) } as CSSProperties}>
      <path className="isle" d={islePath(CARD.w, height, 4, 8)} />
      <path className="isle-wash" d={islePath(CARD.w, 16, 4, 0)} />
      <g className="island-content">
        <Tile id={agent.id} x={left} y={8.2} size={7} clip={clip} />
        <text className="isle-text strong" x={left + 9.4} y={ask.kind === "round" ? 13.1 : 11.4} fontSize={3.9}>
          {`${agent.name} - ${agent.project}`}
        </text>
        {ask.kind === "gate" ? (
          <text className="isle-text muted" x={left + 9.4} y={15.4} fontSize={3}>
            {`Bash ${command}`}
          </text>
        ) : null}
        <rect className="isle-chip" x={right - 17} y={8.4} width={17} height={5.4} rx={1.6} />
        <text className="isle-chip-text" x={right - 8.5} y={12.2} fontSize={2.9} textAnchor="middle">
          Needs you
        </text>
        <text className="isle-text" x={left} y={22.4} fontSize={4.2}>
          {ask.kind === "round" ? agent.fork.question : `Allow bash: ${command}?`}
        </text>
        {ask.kind === "round" ? (
          agent.fork.options.map((option, k) => (
            <Press key={option} className="ik-lift tap" material="glass" label={`${option}, on the notch`} onPress={() => answer(k === 0 ? "first" : "second", "notch")} data-hot={k === 0}>
              <g>
                <rect className="isle-button quiet" x={left} y={25.2 + k * 8} width={right - left} height={6.6} rx={1.8} />
                <text className="isle-text" x={(left + right) / 2} y={29.6 + k * 8} fontSize={3.6} textAnchor="middle">
                  {option}
                </text>
              </g>
            </Press>
          ))
        ) : (
          <>
            <Press className="ik-lift tap" material="glass" label={`Deny ${command} for ${agent.name}`} onPress={() => answer("deny", "notch")}>
              <g>
                <rect className="isle-button quiet" x={left} y={25.4} width={(right - left) / 2 - 1.2} height={6.8} rx={1.8} />
                <text className="isle-text" x={left + (right - left) / 4 - 0.6} y={29.9} fontSize={3.7} textAnchor="middle">
                  Deny ⌃⌘N
                </text>
              </g>
            </Press>
            <Press className="ik-lift tap" material="glass" label={`Approve ${command} for ${agent.name}`} onPress={() => answer("approve", "notch")} data-hot={true}>
              <g>
                <rect className="isle-button approve" x={(left + right) / 2 + 1.2} y={25.4} width={(right - left) / 2 - 1.2} height={6.8} rx={1.8} />
                <text className="isle-text strong" x={right - (right - left) / 4 + 0.6} y={29.9} fontSize={3.7} textAnchor="middle">
                  Approve ⌃⌘Y
                </text>
              </g>
            </Press>
            <Press className="ik-lift tap" material="glass" label={`Deny ${command} with a reason`} onPress={() => answer("steer", "notch")}>
              <g>
                <rect className="link-hit" x={(left + right) / 2 - 16} y={33.4} width={32} height={4.6} />
                <text className="isle-text muted" x={(left + right) / 2} y={36.6} fontSize={2.9} textAnchor="middle">
                  Deny with a reason
                </text>
              </g>
            </Press>
          </>
        )}
      </g>
    </g>
  )
}

function islePath(w: number, h: number, fillet: number, r: number) {
  const x0 = NOTCH.x - w / 2
  const x1 = NOTCH.x + w / 2
  const y0 = NOTCH.y
  const y1 = NOTCH.y + h
  const bottom = Math.min(r, h / 2)
  return `M${x0 - fillet} ${y0}H${x1 + fillet}Q${x1} ${y0} ${x1} ${y0 + fillet}V${y1 - bottom}Q${x1} ${y1} ${x1 - bottom} ${y1}H${x0 + bottom}Q${x0} ${y1} ${x0} ${y1 - bottom}V${y0 + fillet}Q${x0} ${y0} ${x0 - fillet} ${y0}Z`
}

const GATE_ROWS: ReadonlyArray<{ label: string; reply: Reply; strong: boolean; destructive: boolean }> = [
  { label: "Approve", reply: "approve", strong: true, destructive: false },
  { label: "Deny", reply: "deny", strong: false, destructive: true },
  { label: "Deny with note", reply: "steer", strong: false, destructive: true },
]

const rowLabel = (reply: Reply, command: string) => (reply === "approve" ? `Approve ${command} from the phone` : reply === "deny" ? `Deny ${command} from the phone` : `Deny ${command} with a note`)

function LockScreen({ s, agent, ask, command, card, arrive, receipt, answer, open, frame }: SurfaceProps) {
  const onPhone = s.phase === "asking" && s.pushed
  const fromPhone = receipt?.where === "phone" ? receipt : null
  const awake = onPhone || fromPhone != null
  const unlock = s.event === "open" || (s.event === "answer" && fromPhone?.verdict === "approved")
  const sheet = onPhone && ask.kind === "round" && s.opened
  const cx = PHONE.w / 2
  return (
    <>
      <rect className="ik-screen phone-glass" x={2} y={2} width={PHONE.w - 4} height={PHONE.h - 4} rx={8} />
      <g className="lock" data-awake={awake}>
        <g className="status">
          {[0, 1, 2, 3].map((k) => (
            <rect key={k} className="status-ink" x={6.4 + k * 1.5} y={8.2 - k * 0.7} width={1} height={1.2 + k * 0.7} rx={0.3} />
          ))}
          <rect className="status-line" x={41.2} y={5.6} width={6.4} height={3} rx={0.9} />
          <rect className="status-ink" x={42} y={6.4} width={4.4} height={1.4} rx={0.4} />
          <rect className="status-ink" x={47.9} y={6.6} width={0.6} height={1} rx={0.3} />
        </g>
        <path className="status-line" d={`M${cx - 1.2} 13.4v-1a1.2 1.2 0 0 1 2.4 0v1`} />
        <rect className="status-ink" x={cx - 1.6} y={13.2} width={3.2} height={2.4} rx={0.5} />
        <text className="ui-text" x={cx} y={20.4} fontSize={3.1} textAnchor="middle">
          Monday 5 October
        </text>
        <Glow on={awake}>
          <text className="ui-text clock" x={cx} y={33.2} fontSize={13} textAnchor="middle">
            9:41
          </text>
        </Glow>
      </g>
      {onPhone && ask.kind === "gate" ? (
        <g key={`note-${card}`} className="note" style={{ "--arrive": ms(arrive) } as CSSProperties}>
          <NoteCard clip={`${frame}-note`} title={`${agent.name} is asking`} body={`Allow bash: ${command}?`} />
          <g className="menu" clipPath={`url(#${frame}-menu)`}>
            <rect className="menu-card" x={MENU.x} y={MENU.y} width={MENU.w} height={MENU.row * 3} rx={4.4} />
            <path className="menu-rule" d={`M${MENU.x} ${MENU.y + MENU.row}h${MENU.w}M${MENU.x} ${MENU.y + 2 * MENU.row}h${MENU.w}`} />
            {GATE_ROWS.map((row, k) => (
              <Press key={row.reply} className="ik-lift tap" material="glass" label={rowLabel(row.reply, command)} onPress={() => answer(row.reply, "phone")} data-hot={k === 0}>
                <g>
                  <rect className={k === 0 ? "menu-hit primary-row" : "menu-hit"} x={MENU.x} y={MENU.y + k * MENU.row} width={MENU.w} height={MENU.row} />
                  <text className={`ui-text menu-text${row.strong ? " strong" : ""}${row.destructive ? " destructive" : ""}`} x={MENU.label} y={MENU.y + k * MENU.row + 5.6} fontSize={3.6}>
                    {row.label}
                  </text>
                  {k === 0 ? <FaceIdMark x={MENU.icon} y={MENU.y + MENU.row / 2} /> : null}
                </g>
              </Press>
            ))}
          </g>
        </g>
      ) : null}
      {onPhone && ask.kind === "round" && !s.opened ? (
        <g key={`note-${card}`} className="note" style={{ "--arrive": ms(arrive) } as CSSProperties}>
          <Press className="ik-lift tap" material="glass" label={`Open ${agent.name}'s question on the phone`} onPress={open} data-hot={true}>
            <g>
              <NoteCard clip={`${frame}-note`} title={`${agent.name} - ${agent.project} is asking`} body={agent.fork.question} />
              <rect className="note-hit" x={NOTE.x} y={NOTE.y} width={NOTE.w} height={NOTE.h} rx={5} />
            </g>
          </Press>
        </g>
      ) : null}
      {sheet ? <AnswerSheet key={`sheet-${card}`} agent={agent} frame={frame} answer={answer} /> : null}
      <rect className="phone-island" x={cx - 8} y={4.2} width={16} height={4.8} rx={2.4} />
      {unlock ? (
        <g key={`face-${s.beat}`} className="face-id">
          <path className="face-line" d={`M${cx - 2} 5.4h-1v1M${cx + 2} 5.4h1v1M${cx - 2} 7.8h-1v-1M${cx + 2} 7.8h1v-1M${cx - 0.8} 7.2q.8.5 1.6 0`} />
        </g>
      ) : null}
      {sheet ? null : (
        <>
          <circle className="lock-button" cx={10.6} cy={PHONE.h - 11} r={4} />
          <path className="status-line" d={`M9.6 ${PHONE.h - 13}h2v1.2l-.5.8v2.4h-1v-2.4l-.5-.8z`} />
          <circle className="lock-button" cx={PHONE.w - 10.6} cy={PHONE.h - 11} r={4} />
          <rect className="status-line" x={PHONE.w - 12.4} y={PHONE.h - 12.4} width={3.6} height={2.6} rx={0.6} />
          <circle className="status-line" cx={PHONE.w - 10.6} cy={PHONE.h - 11.1} r={0.7} />
        </>
      )}
      <rect className="status-ink" x={cx - 9} y={PHONE.h - 4.6} width={18} height={1.2} rx={0.6} />
    </>
  )
}

function AnswerSheet({ agent, frame, answer }: { agent: Agent; frame: string; answer: (reply: Reply, from: Where) => void }) {
  const x = SHEET.x + 4
  return (
    <g className="sheet">
      <rect className="app-screen" x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} rx={8} />
      <g clipPath={`url(#${frame}-sheet)`}>
        <image href={PUSHARY_ICON} x={x} y={14} width={5.4} height={5.4} />
        <text className="ui-text strong" x={x + 7.4} y={18} fontSize={3.3}>
          Pushary
        </text>
        <text className="ui-text faint" x={x} y={28} fontSize={3}>
          {ellipsize(`${agent.name} - ${agent.project} is asking`, 3, SHEET.w - 8)}
        </text>
        <text className="ui-text strong" x={x} y={35} fontSize={4.4}>
          {agent.fork.question}
        </text>
        {agent.fork.options.map((option, k) => (
          <Press key={option} className="ik-lift tap" material="glass" label={`${option}, on the phone`} onPress={() => answer(k === 0 ? "first" : "second", "phone")} data-hot={k === 0}>
            <g>
              <rect className="sheet-option" x={x} y={SHEET.option + k * 11} width={SHEET.w - 8} height={8.6} rx={3} />
              <text className="ui-text sheet-option-text" x={SHEET.x + SHEET.w / 2} y={SHEET.option + 5.6 + k * 11} fontSize={3.6} textAnchor="middle">
                {option}
              </text>
            </g>
          </Press>
        ))}
      </g>
    </g>
  )
}

function FaceIdMark({ x, y }: { x: number; y: number }) {
  return <path className="menu-icon" d={`M${x - 2} ${y - 1.6}h-.8v.8M${x + 2} ${y - 1.6}h.8v.8M${x - 2} ${y + 1.6}h-.8v-.8M${x + 2} ${y + 1.6}h.8v-.8M${x - 0.7} ${y + 0.6}q.7.4 1.4 0`} />
}

function NoteCard({ title, body, clip }: { title: string; body: string; clip: string }) {
  const x = NOTE.x + 3
  return (
    <>
      <rect className="note-card" x={NOTE.x} y={NOTE.y} width={NOTE.w} height={NOTE.h} rx={5} />
      <g clipPath={`url(#${clip})`}>
        <image href={PUSHARY_ICON} x={x} y={NOTE.y + 2.8} width={5.4} height={5.4} />
        <text className="ui-text faint" x={x + 7.4} y={NOTE.y + 6.6} fontSize={2.9}>
          PUSHARY
        </text>
        <text className="ui-text faint" x={NOTE.x + NOTE.w - 3} y={NOTE.y + 6.6} fontSize={2.9} textAnchor="end">
          now
        </text>
        <text className="ui-text strong" x={x} y={NOTE.y + 13} fontSize={3.1}>
          {ellipsize(title, 3.1, NOTE.w - 6)}
        </text>
        <text className="ui-text" x={x} y={NOTE.y + 18} fontSize={2.9}>
          {ellipsize(body, 2.9, NOTE.w - 6)}
        </text>
      </g>
    </>
  )
}
