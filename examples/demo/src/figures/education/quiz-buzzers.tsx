import { type CSSProperties, useEffect, useId, useReducer, useRef } from "react"
import { Box, Cursor, Flight, Glow, Plate, Press, playSound, Ripple, type SoundName, type SoundOptions, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./quiz-buzzers.css"

export const meta = {
  slug: "quiz-buzzers",
  title: "Quiz buzzers",
  industry: "education",
  level: 4,
  blurb: "Press a buzzer: the lockout relay clicks and that team's lamp lights. Judge it right and the point flies from the question card to the team's stack while the scoreboard rolls over.",
  uses: ["Plate", "Box", "Press", "Glow", "Flight", "Ripple", "Cursor", "useDemoTap", "playSound", "Callout"],
  sounds: ["press", "release", "relay", "notify", "process", "roll", "done", "complete", "error", "whoosh"],
} satisfies FigureMeta

type Scores = readonly [number, number, number]
type Last = "fresh" | "buzz" | "right" | "wrong" | "reset"
type State = { scores: Scores; was: Scores; question: number; buzzed: number | null; team: number; last: Last; step: number }
type Action = { type: "buzz"; team: number } | { type: "right" } | { type: "wrong" } | { type: "reset" }

const BASE = { x: 0, y: 0, z: 0, w: 192, d: 146, h: 8 }
const BOARD = { x: 16, y: 8, z: BASE.h, w: 150, d: 12, h: 58 }
const CROWN = { x: 12, y: 6, z: BOARD.z + BOARD.h, w: 158, d: 16, h: 6 }
const TRAY = { x: 16, y: BOARD.y + BOARD.d, z: BASE.h, w: 150, d: 18, h: 5 }
const TRAY_TOP = TRAY.z + TRAY.h
const WELL_Y = TRAY.y + TRAY.d / 2
const WINDOW = { w: 34, h: 24, y: 12 }
const TOKEN = { w: 11, d: 11, h: 2.4 }
const LECTERN = { x: 72, y: 58, z: BASE.h, w: 46, d: 34, h: 12 }
const CARD = { x: 75, y: 61, z: LECTERN.z + LECTERN.h, w: 40, d: 28, h: 1.6 }
const CARD_TOKEN = { x: CARD.x + 24.5, y: CARD.y + 8.5, z: CARD.z + CARD.h, ...TOKEN }
const PAD = { x: 136, y: 58, z: BASE.h, w: 50, d: 42, h: 6 }
const RIGHT_KEY = { x: 139, y: 61, z: PAD.z + PAD.h, w: 44, d: 14, h: 5 }
const WRONG_KEY = { x: 139, y: 79, z: PAD.z + PAD.h, w: 44, d: 14, h: 5 }
const PODIUM = { y: 108, z: BASE.h, w: 44, d: 30, h: 10 }
const HOUSING = { w: 26, h: 5 }
const CAP = { w: 19, h: 4 }
const DOME = { w: 12, h: 2.5 }
const LAMP = { cx: PODIUM.w - 6, cy: 5, r: 1.4 }
const RELAY = { x: 4, y: 2.5, w: 15, h: 5, pivot: { x: 7, y: 5 }, arm: 9, contact: { x: 16.4, y: 2.6 } }
const TEAMS = [
  { letter: "A", x: 16 },
  { letter: "B", x: 74 },
  { letter: "C", x: 132 },
] as const
const HOT_TEAM = TEAMS[1]
const COLUMNS = [29, 75, 121] as const
const WIN = 5
const LEVELS = Array.from({ length: WIN }, (_, k) => k)
const BULBS = Array.from({ length: 17 }, (_, k) => ({ k, cx: 7 + k * 9, style: { "--i": Math.abs(k - 8) } as CSSProperties }))
const SCREWS = [
  [4, 4],
  [BOARD.w - 4, 4],
  [4, BOARD.h - 4],
  [BOARD.w - 4, BOARD.h - 4],
] as const
const FLY_MS = 640
const LAND_MS = FLY_MS
const RELAY_MS = 60
const DIGIT_STAGGER_MS = 50
const ms = (value: number) => `${value}ms`
const TIMING = { "--relay": ms(RELAY_MS), "--land": ms(LAND_MS) } as CSSProperties
const START: State = { scores: [2, 3, 1], was: [2, 3, 1], question: 7, buzzed: null, team: 1, last: "fresh", step: 0 }

const letterOf = (team: number) => TEAMS[team]?.letter ?? "A"
const wellX = (team: number) => BOARD.x + (COLUMNS[team] ?? 0)
const tokenAt = (team: number, level: number) => ({ x: wellX(team) - TOKEN.w / 2, y: WELL_Y - TOKEN.d / 2, z: TRAY_TOP + level * TOKEN.h, ...TOKEN })
const center = (podiumX: number) => ({ x: podiumX + PODIUM.w / 2, y: PODIUM.y + PODIUM.d / 2 })
const disc = (podiumX: number, z: number, part: { w: number; h: number }) => {
  const c = center(podiumX)
  return { x: c.x - part.w / 2, y: c.y - part.w / 2, z, w: part.w, d: part.w, h: part.h }
}
const HOUSING_Z = PODIUM.z + PODIUM.h
const CAP_Z = HOUSING_Z + HOUSING.h
const DOME_Z = CAP_Z + CAP.h
const isWon = (scores: Scores) => scores.some((score) => score >= WIN)
const points = (n: number) => `${n} point${n === 1 ? "" : "s"}`
const RELAY_AT: [number, number, number] = [HOT_TEAM.x + PODIUM.w, PODIUM.y + PODIUM.d - RELAY.pivot.x - 4, PODIUM.z + PODIUM.h - RELAY.pivot.y]

function scoreUp(scores: Scores, team: number): Scores {
  return [scores[0] + (team === 0 ? 1 : 0), scores[1] + (team === 1 ? 1 : 0), scores[2] + (team === 2 ? 1 : 0)]
}

function rollRanks(was: Scores, now: Scores): Scores {
  const turns = (team: 0 | 1 | 2) => (was[team] === now[team] ? 0 : 1)
  return [turns(1) + turns(2), turns(2), 0]
}

function quiz(state: State, action: Action): State {
  const step = state.step + 1
  const was = state.scores
  switch (action.type) {
    case "buzz":
      return state.buzzed === null && !isWon(state.scores) ? { ...state, was, buzzed: action.team, team: action.team, last: "buzz", step } : state
    case "right":
      return state.buzzed === null ? state : { ...state, was, scores: scoreUp(state.scores, state.buzzed), question: state.question + 1, buzzed: null, last: "right", step }
    case "wrong":
      return state.buzzed === null ? state : { ...state, was, buzzed: null, last: "wrong", step }
    case "reset":
      return isWon(state.scores) ? { ...START, was, scores: [0, 0, 0], question: 1, team: state.team, last: "reset", step } : state
  }
}

function readoutOf(state: State): string {
  const team = `team ${letterOf(state.team)}`
  const score = state.scores[state.team] ?? 0
  if (state.last === "buzz") return `${team} buzzed · judge it`
  if (state.last === "right") return isWon(state.scores) ? `${team} wins · ${points(score)}` : `${team} · ${points(score)}`
  if (state.last === "wrong") return `${team} · wrong · buzzers open`
  if (state.last === "reset") return "new game · question 1"
  return `question ${state.question} · buzzers open`
}

export default function QuizBuzzers() {
  const [state, dispatch] = useReducer(quiz, START)
  const clip = `qb-window${useId().replace(/[^\w-]/g, "")}`
  const timer = useRef(0)
  const sounds = useRef<(() => void)[]>([])
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      for (const stop of sounds.current) stop()
    },
    [],
  )

  const won = isWon(state.scores)
  const open = state.buzzed === null && !won
  const cut = () => {
    window.clearTimeout(timer.current)
    for (const stop of sounds.current) stop()
    sounds.current = []
  }
  const play = (name: SoundName, options?: SoundOptions) => {
    const stop = playSound(name, options)
    sounds.current.push(stop)
    return stop
  }
  const buzz = (team: number, audible: boolean) => {
    if (!open) return
    cut()
    if (audible) {
      play("relay")
      timer.current = window.setTimeout(() => play("notify"), RELAY_MS)
    }
    dispatch({ type: "buzz", team })
  }
  const right = () => {
    cut()
    if (won) {
      const turning = state.scores.filter((score) => score > 0).length
      play("whoosh")
      if (turning) play("roll", { count: turning, stagger: DIGIT_STAGGER_MS / 1000 })
      dispatch({ type: "reset" })
      return
    }
    if (state.buzzed === null) return
    const winning = (state.scores[state.buzzed] ?? 0) + 1 >= WIN
    play("relay")
    const flight = play("process")
    timer.current = window.setTimeout(() => {
      flight()
      play("roll")
      play(winning ? "complete" : "done")
    }, LAND_MS)
    dispatch({ type: "right" })
  }
  const wrong = () => {
    if (state.buzzed === null) return
    cut()
    play("relay")
    play("error")
    dispatch({ type: "wrong" })
  }
  const demo = useDemoTap(
    () => {
      if (state.step === 0) buzz(1, false)
    },
    { delay: 1700 },
  )
  const act = (then: () => void) => () => {
    demo.dismiss()
    then()
  }

  const flying = state.last === "right"
  const scored = state.team
  const reset = state.last === "reset"
  const judged = state.last === "right" || state.last === "wrong"
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const before = (state.scores[scored] ?? 1) - 1
  const ranks = rollRanks(state.was, state.scores)
  const hint = won ? "Press new for a new game" : state.buzzed !== null ? "Now judge it" : "Press a buzzer"
  const tokenStyle = (team: number, level: number): CSSProperties | undefined => {
    if (flying && team === scored && level === before) return { "--t": ms(LAND_MS) } as CSSProperties
    if (reset) return { "--i": WIN - 1 - level } as CSSProperties
    return undefined
  }

  return (
    <Plate
      {...demo.plate}
      fig="Education"
      name="Quiz buzzers"
      hint={hint}
      readout={readoutOf(state)}
      className="fig-quiz-buzzers"
      style={TIMING}
      fit={[BASE, CROWN, { ...BOARD, z: 0, h: CROWN.z + CROWN.h }]}
      aspect={1.3}
      label="A quiz table: a scoreboard for teams A, B and C with a tray of point tokens, a question card on a lectern, a judge's pad with right and wrong keys, and three buzzers. Press a buzzer, then judge; a right answer flies the point from the question card to that team."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={7} />
              <path className="ik-detail" d={`M12 ${PODIUM.y - 6}h${BASE.w - 24}`} />
            </>
          }
        />
        <Box
          {...BOARD}
          r={3}
          front={
            <>
              <defs>
                <clipPath id={clip}>
                  <rect width={WINDOW.w} height={WINDOW.h} rx={3} />
                </clipPath>
              </defs>
              {SCREWS.map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-detail" cx={cx} cy={cy} r={1.2} />
              ))}
              {COLUMNS.map((column, team) => {
                const score = state.scores[team] ?? 0
                const was = state.was[team] ?? 0
                const rolling = was !== score
                return (
                  <g key={column}>
                    <text className="ik-label qb-letter" x={column} y={WINDOW.y - 3} textAnchor="middle">
                      {letterOf(team)}
                    </text>
                    <rect
                      className="qb-window"
                      data-live={flying && team === scored}
                      x={column - WINDOW.w / 2}
                      y={WINDOW.y}
                      width={WINDOW.w}
                      height={WINDOW.h}
                      rx={3}
                    />
                    <g transform={`translate(${column - WINDOW.w / 2} ${WINDOW.y})`} clipPath={`url(#${clip})`}>
                      <Glow>
                        <g key={rolling ? `roll-${state.step}` : "steady"} style={{ "--t": ms(reset ? (ranks[team] ?? 0) * DIGIT_STAGGER_MS : LAND_MS) } as CSSProperties}>
                          {rolling ? <Digit value={was} className="qb-roll-out" /> : null}
                          <Digit value={score} className={rolling ? "qb-roll-in" : ""} />
                        </g>
                      </Glow>
                    </g>
                  </g>
                )
              })}
            </>
          }
          side={<path className="ik-detail" d={`M3 8v${BOARD.h - 16}`} />}
        />
        <Box
          {...CROWN}
          r={3}
          front={
            <>
              {BULBS.map((bulb) => (
                <circle key={bulb.k} className="qb-bulb" cx={bulb.cx} cy={3} r={1.2} />
              ))}
              {won || reset ? (
                <Glow key={`marquee-${won}`}>
                  {BULBS.map((bulb) => (
                    <circle key={bulb.k} className={won ? "qb-bulb-lit qb-bulb-on" : "qb-bulb-lit qb-bulb-off"} cx={bulb.cx} cy={3} r={1.2} style={bulb.style} />
                  ))}
                </Glow>
              ) : null}
            </>
          }
        />
        <Box
          {...TRAY}
          r={3}
          top={COLUMNS.map((column) => (
            <rect key={column} className="ik-well" x={column - 8} y={TRAY.d / 2 - 7} width={16} height={14} rx={7} />
          ))}
        />
        {COLUMNS.map((column, team) =>
          LEVELS.map((level) => (
            <g key={`${column}-${level}`} className="qb-token" data-on={level < (state.scores[team] ?? 0)} style={tokenStyle(team, level)}>
              <Token {...tokenAt(team, level)} />
            </g>
          )),
        )}

        <Box
          {...LECTERN}
          r={4}
          front={
            <>
              <text className="ik-label qb-team" x={6} y={8}>
                QUESTION
              </text>
              <circle className="ik-fill" cx={LECTERN.w - 6} cy={5.5} r={1.2} />
            </>
          }
          side={<path className="ik-detail" d="M4 3v6M7 3v6M10 3v6" />}
        />
        {flying ? (
          <g key={`card-was-${state.step}`} className="qb-card-out">
            <Card question={state.question - 1} live={false} withToken={false} />
          </g>
        ) : null}
        <g key={`card-${state.question}`} className={flying ? "qb-card-in" : undefined}>
          <Card question={state.question} live={state.last === "wrong" || reset} withToken />
        </g>

        <Box
          {...PAD}
          r={5}
          top={
            <>
              <path className="ik-detail" d={`M6 ${PAD.d - 4}h${PAD.w - 12}`} />
              <path className="ik-detail" d={`M${PAD.w - 14} ${PAD.d - 2.2}h2M${PAD.w - 10} ${PAD.d - 2.2}h2M${PAD.w - 6} ${PAD.d - 2.2}h2`} />
            </>
          }
        />
        <Press label={won ? "Start a new game" : "Judge the answer right"} material="rubber" onPress={act(right)} disabled={!won && state.buzzed === null}>
          <g>
            <Box
              {...RIGHT_KEY}
              r={4}
              top={
                <>
                  <text className="ik-label qb-key" x={6} y={9.4}>
                    {won ? "NEW" : "RIGHT"}
                  </text>
                  <path className="qb-mark" d={won ? "M-3 0a3 3 0 1 0 3 -3M0 -3l-1.6 -1.6M0 -3l-1.6 1.6" : "M-3.2 0.2l2 2.2l4.2 -4.6"} transform={`translate(${RIGHT_KEY.w - 7.5} 7)`} />
                </>
              }
            />
          </g>
        </Press>
        <Press label="Judge the answer wrong" material="rubber" onPress={act(wrong)} disabled={state.buzzed === null}>
          <g>
            <Box
              {...WRONG_KEY}
              r={4}
              top={
                <>
                  <text className="ik-label qb-key" x={6} y={9.4}>
                    WRONG
                  </text>
                  <path className="qb-mark" d="M-2.6 -2.6l5.2 5.2M2.6 -2.6l-5.2 5.2" transform={`translate(${WRONG_KEY.w - 7.5} 7)`} />
                </>
              }
            />
          </g>
        </Press>

        {TEAMS.map((team, t) => {
          const lit = state.last === "buzz" && state.buzzed === t
          const fading = judged && state.team === t
          return (
            <g key={team.letter}>
              <Box
                x={team.x}
                {...PODIUM}
                r={5}
                front={
                  <>
                    <text className="ik-label qb-team" x={6} y={7}>
                      TEAM {team.letter}
                    </text>
                    <circle className="ik-fill" {...LAMP} />
                    {lit ? (
                      <Glow key="lit">
                        <circle className="qb-lamp qb-lamp-on" {...LAMP} />
                      </Glow>
                    ) : fading ? (
                      <Glow key={`fade-${state.step}`}>
                        <circle className="qb-lamp qb-lamp-off" {...LAMP} />
                      </Glow>
                    ) : null}
                  </>
                }
                side={
                  <>
                    <rect className="ik-well" x={RELAY.x} y={RELAY.y} width={RELAY.w} height={RELAY.h} rx={1.2} />
                    <circle className="ik-fill" cx={RELAY.contact.x} cy={RELAY.contact.y} r={0.6} />
                    <g transform={`translate(${RELAY.pivot.x} ${RELAY.pivot.y})`}>
                      <g className="qb-armature" data-pulled={lit}>
                        <path className="ik-line" d={`M0 0h${RELAY.arm}`} />
                      </g>
                    </g>
                    <circle className="ik-fill" cx={RELAY.pivot.x} cy={RELAY.pivot.y} r={1} />
                  </>
                }
              />
              <Box {...disc(team.x, HOUSING_Z, HOUSING)} r={HOUSING.w / 2} />
              {t === 1 && state.step === 0 && !aiming ? <Ripple {...disc(team.x, CAP_Z, HOUSING)} r={HOUSING.w / 2} /> : null}
              <Press
                label={`Buzz in for team ${team.letter}`}
                material="plastic"
                onPress={act(() => buzz(t, true))}
                disabled={!open}
                className="qb-buzzer"
                data-hot={state.step === 0 && t === 1}
                data-lit={lit}
              >
                <g>
                  <Box {...disc(team.x, CAP_Z, CAP)} r={CAP.w / 2} />
                  <g className="qb-dome">
                    <Box {...disc(team.x, DOME_Z, DOME)} r={DOME.w / 2} />
                  </g>
                </g>
              </Press>
            </g>
          )
        })}

        <g key={`flight-${state.step}`}>
          {flying ? (
            <Flight from={[CARD_TOKEN.x, CARD_TOKEN.y, CARD_TOKEN.z]} to={[tokenAt(scored, before).x, tokenAt(scored, before).y, tokenAt(scored, before).z]} duration={FLY_MS} lift={30}>
              <Token {...CARD_TOKEN} />
            </Flight>
          ) : null}
        </g>
        <Cursor at={[center(HOT_TEAM.x).x, center(HOT_TEAM.x).y, DOME_Z + DOME.h]} phase={demo.phase} />
        <Callout at={RELAY_AT} dx={14} dy={16} label="lockout relay" />
      </g>
    </Plate>
  )
}

function Digit({ value, className }: { value: number; className: string }) {
  return (
    <text className={`ik-screen-text ${className}`} x={WINDOW.w / 2} y={18} fontSize={16} textAnchor="middle">
      {value}
    </text>
  )
}

function Token(box: { x: number; y: number; z: number; w: number; d: number; h: number }) {
  return <Box {...box} r={box.w / 2} top={<circle className="ik-detail" cx={box.w / 2} cy={box.d / 2} r={2.6} />} />
}

function Card({ question, live, withToken }: { question: number; live: boolean; withToken: boolean }) {
  return (
    <>
      <g className="qb-card" data-live={live}>
        <Box
          {...CARD}
          r={2}
          top={
            <>
              <text className="ik-label qb-q" x={4} y={9.5}>
                Q{question}
              </text>
              <path className="ik-detail" d="M4 15h17M4 19h13M4 23h18" />
            </>
          }
        />
      </g>
      {withToken ? <Token {...CARD_TOKEN} /> : null}
    </>
  )
}
