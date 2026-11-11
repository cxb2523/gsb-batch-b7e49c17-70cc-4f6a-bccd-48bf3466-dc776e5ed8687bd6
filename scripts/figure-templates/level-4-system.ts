import { attribute, type FigureFiles, quoted, scope, type TemplateInput } from "./template-input.ts"

export function levelFourSystem(input: TemplateInput): FigureFiles {
  const tsx = `import { useEffect, useReducer, useRef } from "react"
import { Box, Cursor, Flight, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./${input.slug}.css"

export const meta = {
  slug: ${quoted(input.slug)},
  title: ${quoted(input.title)},
  industry: ${quoted(input.industry)},
  level: 4,
  blurb: ${quoted(input.blurb)},
  uses: ["Plate", "Box", "Press", "Flight", "Ripple", "Cursor", "useDemoTap"],
  sounds: ["press", "release", "toggle", "process", "done", "whoosh"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 180, d: 128, h: 10 }
const SOURCE = { x: 14, y: 14, z: 10, w: 48, d: 48, h: 14 }
const TARGET = { x: 118, y: 14, z: 10, w: 48, d: 48, h: 14 }
const ITEM = { w: 28, d: 28, h: 8 }
const LOAD_KEY = { x: 24, y: 88, z: 10, w: 52, d: 24, h: 7 }
const SEND_KEY = { x: 104, y: 88, z: 10, w: 52, d: 24, h: 7 }
const CAPACITY = 3
const FLIGHT_MS = 560
const itemOn = (pad: typeof SOURCE, level: number) => ({ x: pad.x + (pad.w - ITEM.w) / 2, y: pad.y + (pad.d - ITEM.d) / 2, z: pad.z + pad.h + level * ITEM.h, ...ITEM })

type Stage = "empty" | "loaded" | "moving"
type State = { stage: Stage; delivered: number; trip: number }
type Action = { type: "load" } | { type: "send" } | { type: "land" } | { type: "reset" }

const START: State = { stage: "empty", delivered: 0, trip: 0 }

function advance(state: State, action: Action): State {
  switch (action.type) {
    case "load":
      return state.stage === "empty" && state.delivered < CAPACITY ? { ...state, stage: "loaded" } : state
    case "send":
      return state.stage === "loaded" ? { ...state, stage: "moving", trip: state.trip + 1 } : state
    case "land":
      return state.stage === "moving" ? { ...state, stage: "empty", delivered: state.delivered + 1 } : state
    case "reset":
      return state.stage === "moving" ? state : { ...START, trip: state.trip }
  }
}

function readoutOf(state: State): string {
  if (state.stage === "moving") return "moving"
  if (state.stage === "loaded") return "loaded · press send"
  if (state.delivered === CAPACITY) return \`\${CAPACITY} of \${CAPACITY} · full · press load to reset\`
  return state.trip ? \`\${state.delivered} of \${CAPACITY} delivered\` : "empty · press load"
}

export default function ${input.componentName}() {
  const [state, dispatch] = useReducer(advance, START)
  const landing = useRef(0)
  const stopSound = useRef(() => {})
  useEffect(
    () => () => {
      window.clearTimeout(landing.current)
      stopSound.current()
    },
    [],
  )
  const play = (audible: boolean, sound: Parameters<typeof playSound>[0]) => {
    stopSound.current()
    stopSound.current = audible ? playSound(sound) : () => {}
  }
  const load = (audible: boolean) => {
    if (state.delivered === CAPACITY) {
      play(audible, "whoosh")
      dispatch({ type: "reset" })
      return
    }
    play(audible, "toggle")
    dispatch({ type: "load" })
  }
  const send = () => {
    play(true, "process")
    dispatch({ type: "send" })
    window.clearTimeout(landing.current)
    landing.current = window.setTimeout(() => {
      dispatch({ type: "land" })
      play(true, "done")
    }, FLIGHT_MS)
  }
  const demo = useDemoTap(() => load(false))
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const loadHot = state.stage === "empty"
  const sendHot = state.stage === "loaded"
  const loaded = itemOn(SOURCE, 0)
  const landed = itemOn(TARGET, state.delivered)
  return (
    <Plate
      {...demo.plate}
      fig="${attribute(input.industryTitle)}"
      name="${attribute(input.title)}"
      hint={sendHot ? "Press send" : "Press load"}
      readout={readoutOf(state)}
      className="fig-${input.slug}"
      fit={[BASE, { ...TARGET, h: TARGET.h + ITEM.h * CAPACITY + 30 }]}
      aspect={1.3}
      label="${attribute(input.label)}"
    >
      <g ref={demo.ref}>
        <Box {...BASE} r={10} />
        <Box {...SOURCE} r={8} top={<path className="ik-detail" d={\`M6 \${SOURCE.d - 6}h\${SOURCE.w - 12}\`} />} />
        <Box {...TARGET} r={8} top={<path className="ik-detail" d={\`M6 \${TARGET.d - 6}h\${TARGET.w - 12}\`} />} />
        {state.stage === "loaded" ? <Box {...loaded} r={4} /> : null}
        {Array.from({ length: state.delivered }, (_, level) => (
          <Box key={level} {...itemOn(TARGET, level)} r={4} />
        ))}
        {state.trip || aiming ? null : <Ripple {...LOAD_KEY} r={5} />}
        <Press label={state.delivered === CAPACITY ? "Reset the target" : "Load the source"} material="metal" onPress={() => { demo.dismiss(); load(true) }} disabled={state.stage === "moving"} data-hot={loadHot}>
          <g>
            <Box {...LOAD_KEY} r={5} top={<text className="ik-label" x={8} y={14}>LOAD</text>} />
          </g>
        </Press>
        <Press label="Send to the target" material="metal" onPress={() => { demo.dismiss(); send() }} disabled={!sendHot} data-hot={sendHot}>
          <g>
            <Box {...SEND_KEY} r={5} top={<text className="ik-label" x={8} y={14}>SEND</text>} />
          </g>
        </Press>
        {state.stage === "moving" ? (
          <Flight key={state.trip} from={[loaded.x, loaded.y, loaded.z]} to={[landed.x, landed.y, landed.z]} duration={FLIGHT_MS}>
            <Box {...loaded} r={4} />
          </Flight>
        ) : null}
        <Cursor at={[LOAD_KEY.x + LOAD_KEY.w / 2, LOAD_KEY.y + LOAD_KEY.d / 2, LOAD_KEY.z + LOAD_KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
`
  const css = `${scope(input)} .ik-label { font-size: 7px; }
`
  return { tsx, css }
}
