import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, project, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./ground-station.css"

export const meta = {
  slug: "ground-station",
  title: "Ground station",
  industry: "deeptech",
  level: 2,
  blurb: "Press link: pings climb from the dish to the satellite, its light comes on, the signal needle swings up and settles, and the telemetry lands on screen.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "project", "Callout"],
  sounds: ["process", "success", "whoosh"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 176, d: 136, h: 8 }
const FOOT = { x: 100, y: 20, z: 8, w: 48, d: 48, h: 6 }
const COLUMN = { x: 114, y: 34, z: 14, w: 20, d: 20, h: 26 }
const YOKES = [
  { x: 112, y: 32, z: 40, w: 24, d: 22, h: 5 },
  { x: 117, y: 27, z: 45, w: 24, d: 22, h: 5 },
] as const
const DISCS = [
  { cx: 133, cy: 27, z: 50, w: 28, h: 4 },
  { cx: 137, cy: 23, z: 54, w: 48, h: 4 },
  { cx: 141, cy: 19, z: 58, w: 68, h: 5 },
] as const
const DISH = { cx: 141, cy: 19, z: 63, r: 34 }
const FEED = { x: 145, y: 7, z: 86, w: 8, d: 8, h: 8 }
const STRUTS = [45, 165, 285].map((deg): Vec3 => {
  const a = (deg * Math.PI) / 180
  return [DISH.cx + 30 * Math.cos(a), DISH.cy + 30 * Math.sin(a), DISH.z]
})
const SAT = { x: 52, y: 12, z: 104, w: 16, d: 16, h: 14 }
const PANELS = [
  { x: 56, y: -24, z: 109, w: 8, d: 32, h: 2 },
  { x: 56, y: 32, z: 109, w: 8, d: 32, h: 2 },
] as const
const SHELTER = { x: 10, y: 84, z: 8, w: 96, d: 40, h: 40 }
const FAN = { x: 20, y: 92, z: 48, w: 30, d: 24, h: 7 }
const KEY = { x: 118, y: 100, z: 8, w: 46, d: 22, h: 5 }
const BEAM = curve([149, 11, 96], [146, 10, 120], [106, 16, 126], [70, 20, 112], 48)
const CABLE = path(curve([106, 96, 13], [116, 96, 9.5], [118, 82, 9.5], [118, 68, 11]))
const LIGHT = project(SAT.x + 12.6, SAT.y + SAT.d, SAT.z + SAT.h - 5.6)
const PINGS = [0, 150, 300] as const
const PING_MS = 540
const ARRIVE_MS = 300 + PING_MS
const METER = { x: 20, y: 21, idle: -48, locked: 30 }
const METER_TICKS = [-48, -24, 0, 15, 30].map((deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return `M${Math.cos(a) * 11.6} ${Math.sin(a) * 11.6}L${Math.cos(a) * 13.6} ${Math.sin(a) * 13.6}`
}).join("")

type Link = "idle" | "linked" | "dropped"

export default function GroundStation() {
  const [link, setLink] = useState<Link>("idle")
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState(false)
  const stop = useRef(() => {})
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const linked = link === "linked"
  const toggle = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    if (audible && !linked) {
      stop.current = playSound("process")
      timer.current = window.setTimeout(() => {
        stop.current()
        stop.current = playSound("success")
      }, ARRIVE_MS)
    }
    if (audible && linked) stop.current = playSound("whoosh")
    setLink(linked ? "dropped" : "linked")
    setStep(step + 1)
  }
  const demo = useDemoTap(() => {
    if (link === "idle") toggle(false)
  }, { delay: 600 })
  const press = () => {
    demo.dismiss()
    setTouched(true)
    toggle(true)
  }

  const readout = linked ? "linked · 12 ms" : link === "dropped" ? "dropped · idle" : "idle · no link"

  return (
    <Plate
      {...demo.plate}
      fig="Deep tech"
      name="Ground station"
      hint={linked ? "Press to drop the link" : "Press link"}
      readout={readout}
      className="fig-ground-station"
      style={{ "--arrive": `${ARRIVE_MS}ms` } as CSSProperties}
      data-link={linked}
      fit={[BASE, { x: DISH.cx - DISH.r, y: DISH.cy - DISH.r, z: 0, w: 2 * DISH.r, d: 2 * DISH.r, h: FEED.z + FEED.h }, ...PANELS, SAT]}
      aspect={1.3}
      label="A satellite ground station: a dish, an equipment shelter with a screen and a signal meter, and a satellite overhead. Press link to connect the dish to the satellite; press again to drop the link."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={7} />
              {[
                [14, 14],
                [BASE.w - 14, 14],
                [14, BASE.d - 14],
                [BASE.w - 14, BASE.d - 14],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.6} />
              ))}
            </>
          }
        />
        <Box
          {...FOOT}
          r={8}
          top={[
                [7, 7],
                [41, 7],
                [7, 41],
                [41, 41],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.5} />
              ))}
          front={<path className="ik-detail" d="M8 3h32" />}
        />
        <Box {...COLUMN} r={COLUMN.w / 2} />
        {YOKES.map((yoke) => (
          <Box key={yoke.z} {...yoke} r={3} side={<path className="ik-detail" d={`M4 3h${yoke.d - 8}`} />} />
        ))}
        {DISCS.map((disc, i) => (
          <Box
            key={disc.z}
            x={disc.cx - disc.w / 2}
            y={disc.cy - disc.w / 2}
            z={disc.z}
            w={disc.w}
            d={disc.w}
            h={disc.h}
            r={disc.w / 2}
            top={
              i === DISCS.length - 1 ? (
                <g transform={`translate(${disc.w / 2} ${disc.w / 2})`}>
                  <circle className="ik-well" r={30} />
                  {[0, 45, 90, 135].map((deg) => (
                    <path key={deg} className="ik-detail" d="M-30 0H30" transform={`rotate(${deg})`} />
                  ))}
                  {[21, 12].map((r) => (
                    <circle key={r} className="ik-detail" r={r} />
                  ))}
                  <circle className="ik-face ik-top" r={4} />
                </g>
              ) : null
            }
          />
        ))}
        {STRUTS.map((foot) => (
          <path key={foot.join()} className="ik-line" d={path([foot, [FEED.x + FEED.w / 2, FEED.y + FEED.d / 2, FEED.z]])} />
        ))}
        <Box {...FEED} r={FEED.w / 2} />

        <g className="ik-float ik-loop sat">
          <Box {...PANELS[0]} r={1} top={<PanelCells />} />
          <path className="ik-line" d={path([[60, 8, 110], [60, 12, 110]])} />
          <Box
            {...SAT}
            r={3}
            top={<path className="ik-detail" d="M8 4v8M4 8h8" />}
            front={
              <>
                <rect className="ik-detail" x={3} y={3} width={7} height={8} rx={1} />
                <Glow on={linked} className="sat-glow">
                  <circle className="sat-light" cx={12.6} cy={5.6} r={1.9} />
                </Glow>
              </>
            }
            side={<circle className="ik-detail" cx={8} cy={7} r={4} />}
          />
          <path className="ik-line" d={path([[60, 28, 110], [60, 32, 110]])} />
          <Box {...PANELS[1]} r={1} top={<PanelCells />} />
          <g key={`ring-${step}`} transform={`translate(${LIGHT[0]} ${LIGHT[1]})`}>
            {linked ? <circle className="arrive" r={3} /> : null}
          </g>
        </g>

        <g key={`beam-${step}`}>
          {linked ? PINGS.map((delay) => <Signal key={delay} points={BEAM} delay={delay} duration={PING_MS} />) : null}
        </g>

        <Box
          {...SHELTER}
          r={5}
          top={<rect className="ik-detail" x={4} y={4} width={SHELTER.w - 8} height={SHELTER.d - 8} rx={3} />}
          front={
            <>
              <rect className="ik-screen" x={6} y={6} width={74} height={22} rx={3} />
              <g key={`top-${step}`} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={11} y={14} fontSize={5.6}>
                  {linked ? "sat-04 · locked" : "sat-04 · el 38°"}
                </text>
              </g>
              <g key={`big-${step}`}>
                {linked ? (
                  <>
                    <text className="ik-screen-text acquire" x={11} y={23.6} fontSize={6.4}>
                      acquiring
                    </text>
                    <g className="ik-enter" style={{ animationDelay: `${ARRIVE_MS}ms` }}>
                      <text className="ik-screen-text" x={11} y={23.6} fontSize={6.4}>
                        12 ms · 4.2 Mb/s
                      </text>
                    </g>
                  </>
                ) : (
                  <g className="ik-enter">
                    <text className="ik-screen-text" x={11} y={23.6} fontSize={6.4}>
                      {link === "dropped" ? "link dropped" : "no link"}
                    </text>
                  </g>
                )}
              </g>
              {[0, 1, 2].map((k) => (
                <path key={k} className="ik-detail" d={`M${84 + k * 3.4} 8v18`} />
              ))}
              <path className="ik-detail" d="M6 33h40" />
              <rect className="ik-well" x={70} y={31} width={10} height={5} rx={1} />
            </>
          }
          side={
            <>
              <rect className="ik-well" x={5} y={5} width={30} height={19} rx={2} />
              <g transform={`translate(${METER.x} ${METER.y})`}>
                <path className="ik-detail" d={METER_TICKS} />
                <g className="needle" style={{ "--turn": `${linked ? METER.locked : METER.idle}deg` } as CSSProperties}>
                  <path className="ik-line" d="M0 0V-11" />
                </g>
                <circle className="ik-fill" r={1.2} />
              </g>
              {Array.from({ length: 3 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M6 ${29 + k * 3}h14`} />
              ))}
              <circle className="ik-well" cx={28} cy={32} r={2.4} />
            </>
          }
        />
        <Box
          {...FAN}
          r={3}
          top={
            <g transform={`translate(${FAN.w / 2} ${FAN.d / 2})`}>
              <circle className="ik-detail" r={9} />
              <path className="ik-detail" d="M-9 0h18M0-9v18" />
              <circle className="ik-fill" r={2} />
            </g>
          }
        />
        <path className="ik-line" d={CABLE} />

        {!touched && link === "idle" && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={6} /> : null}
        <Press label={linked ? "Drop the link" : "Link to the satellite"} material="rubber" onPress={press} data-hot={!linked}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label key" x={8} y={14}>
                    LINK
                  </text>
                  <g className="ik-detail ik-thick wave" transform={`translate(${KEY.w - 12} ${KEY.d / 2})`}>
                    <path d="M-1.5 2a2.5 2.5 0 0 1 3 0" />
                    <path d="M-4 -0.5a6 6 0 0 1 8 0" />
                    <path d="M-6.5 -3a9.5 9.5 0 0 1 13 0" />
                  </g>
                </>
              }
            />
          </g>
        </Press>
        <Callout at={[FEED.x + FEED.w, FEED.y, FEED.z + FEED.h]} dx={12} dy={-12} label="ka feed" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}

function PanelCells() {
  return <path className="ik-detail" d="M4 2v28M0 8h8M0 16h8M0 24h8" />
}

