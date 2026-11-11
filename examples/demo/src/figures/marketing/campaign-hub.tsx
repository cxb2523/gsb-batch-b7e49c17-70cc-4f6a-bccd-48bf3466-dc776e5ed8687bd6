import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./campaign-hub.css"

export const meta = {
  slug: "campaign-hub",
  title: "Campaign hub",
  industry: "marketing",
  level: 4,
  blurb: "Press launch: a relay clicks the on-air lamp on, one campaign runs down three cables and each channel wakes in its own format. Press a screen and the channel dial ticks over to it.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "Callout"],
  sounds: ["press", "release", "relay", "cascade", "whoosh", "tick"],
} satisfies FigureMeta

type Channel = "feed" | "search" | "video"
type Layout = { channel: Channel; name: string; format: string; x: number; w: number; h: number; screen: number; hubX: number; turn: number }
type Screen = Layout & { arrive: number; cable: Vec3[]; timing: CSSProperties }
type Guide = "fresh" | "launched" | "explored"

const BASE = { x: 0, y: 0, z: 0, w: 190, d: 132, h: 8 }
const STAND = { y: 18, d: 6 }
const HUB = { x: 47, y: 80, z: BASE.h, w: 96, d: 40, h: 26 }
const KEY = { x: 73, y: 90, z: BASE.h + HUB.h, w: 44, d: 20, h: 4 }
const GROUND = BASE.h + 0.6
const LAMP_MS = 90
const TRAVEL_MS = 300
const STAGGER_MS = 150
const DIAL = { x: 18, y: 13, r: 5, all: -60 }
const HUB_SCREEN = { x: 29, y: 5, w: 48, h: 16 }
const LAMP = { x: 84, y: 9.5 }
const RELAY = { x: 74, y: 13, w: 15, d: 12, arm: 8.4 }
const LAYOUT: readonly Layout[] = [
  { channel: "feed", name: "Social", format: "feed post", x: 8, w: 52, h: 60, screen: 46, hubX: 76, turn: -20 },
  { channel: "search", name: "Search", format: "search ad", x: 70, w: 58, h: 44, screen: 30, hubX: 95, turn: 20 },
  { channel: "video", name: "Video", format: "9:16 video", x: 140, w: 36, h: 66, screen: 53, hubX: 114, turn: 60 },
]

function cable(screen: Layout): Vec3[] {
  const center = screen.x + screen.w / 2
  const front = STAND.y + STAND.d
  return curve([screen.hubX, HUB.y, GROUND], [screen.hubX, HUB.y - 26, GROUND], [center, front + 26, GROUND], [center, front, GROUND])
}

function detent(turn: number, from: number, to: number) {
  const angle = (turn * Math.PI) / 180
  const [dx, dy] = [Math.sin(angle), -Math.cos(angle)]
  return `M${(dx * from).toFixed(3)} ${(dy * from).toFixed(3)}L${(dx * to).toFixed(3)} ${(dy * to).toFixed(3)}`
}

const SCREENS: readonly Screen[] = LAYOUT.map((layout, i) => {
  const arrive = LAMP_MS + TRAVEL_MS + i * STAGGER_MS
  return { ...layout, arrive, cable: cable(layout), timing: { "--arrive": `${arrive}ms` } as CSSProperties }
})
const BY_CHANNEL: ReadonlyMap<Channel, Screen> = new Map(SCREENS.map((screen) => [screen.channel, screen]))
const FIRST = SCREENS[0] as Screen
const DETENTS = SCREENS.map((screen) => detent(screen.turn, DIAL.r + 3.2, DIAL.r + 4.8)).join("")
const ALL_MARK = { cx: Math.sin((DIAL.all * Math.PI) / 180) * (DIAL.r + 4), cy: -Math.cos((DIAL.all * Math.PI) / 180) * (DIAL.r + 4) }
const PLATE_STYLE = { "--lamp": `${LAMP_MS}ms` } as CSSProperties
const RELAY_AT: Vec3 = [HUB.x + RELAY.x + 3, HUB.y + RELAY.y + RELAY.d - 3.2, HUB.z + HUB.h]

function Placement({ channel }: { channel: Channel }) {
  switch (channel) {
    case "feed":
      return (
        <>
          <circle className="ik-fill" cx={8} cy={9} r={2} />
          <path className="ik-detail" d="M12 9h14" />
          <rect className="ik-well" x={6} y={14} width={40} height={24} rx={1.5} />
          <path className="ik-detail" d="M7 37l10-9 7 6 6-5 15 8M6 42.5h30M6 46h20" />
        </>
      )
    case "search":
      return (
        <>
          <rect className="ik-fill" x={7} y={8} width={8} height={4.5} rx={1} />
          <path className="ik-detail" d="M18 10.3h20" />
          <rect className="ik-fill" x={7} y={15.5} width={40} height={4} rx={2} />
          <path className="ik-detail" d="M7 24.5h42M7 28.5h30" />
        </>
      )
    case "video":
      return (
        <>
          <rect className="ik-well" x={5} y={5} width={26} height={49} rx={2} />
          <path className="ik-line" d="M15 24l7 4.5-7 4.5z" />
          <path className="ik-detail" d="M8 46h14M8 49.5h10" />
        </>
      )
  }
}

export default function CampaignHub() {
  const [live, setLive] = useState(false)
  const [focus, setFocus] = useState<Channel | null>(null)
  const [guide, setGuide] = useState<Guide>("fresh")
  const [launches, setLaunches] = useState(0)
  const stops = useRef<Array<() => void>>([])
  useEffect(
    () => () => {
      for (const stop of stops.current) stop()
    },
    [],
  )

  const launch = (audible: boolean) => {
    for (const stop of stops.current) stop()
    stops.current = []
    if (audible) {
      stops.current.push(playSound("relay"))
      if (focus) stops.current.push(playSound("tick"))
      stops.current.push(live ? playSound("whoosh") : playSound("cascade", { count: SCREENS.length, stagger: STAGGER_MS / 1000, delay: (LAMP_MS + TRAVEL_MS) / 1000 }))
    }
    if (!live) setLaunches(1 - launches)
    setLive(!live)
    setFocus(null)
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (!live) launch(false)
    },
    { delay: 600 },
  )
  const pressLaunch = () => {
    dismiss()
    setGuide(guide === "explored" ? "explored" : "launched")
    launch(true)
  }
  const pressScreen = (channel: Channel) => {
    dismiss()
    playSound("tick")
    setGuide("explored")
    setFocus(focus === channel ? null : channel)
  }

  const suggested = live && guide !== "explored" ? FIRST : null
  const hot = focus ?? suggested?.channel ?? null
  const focused = focus ? BY_CHANNEL.get(focus) : undefined
  const turn = focused ? focused.turn : DIAL.all
  const readout = focused ? `${focused.name.toLowerCase()} · ${focused.format} · ${live ? "live" : "ready"}` : live ? `live on ${SCREENS.length} channels` : `draft · ${SCREENS.length} channels`

  return (
    <Plate
      {...plate}
      fig="Marketing"
      name="Campaign hub"
      hint={live ? "Press a channel" : "Press launch"}
      readout={readout}
      className="fig-campaign-hub"
      style={PLATE_STYLE}
      data-live={live}
      data-lamp={live && hot === null}
      fit={[BASE, { x: 8, y: STAND.y, z: 0, w: 168, d: STAND.d, h: BASE.h + 66 }, { ...KEY, h: KEY.h + 2 }]}
      aspect={1.3}
      label="A campaign hub wired to three channel screens, with an on-air lamp on a relay and a channel dial. Press launch to send the campaign to every channel, or press a screen to turn the dial to it and see its format."
    >
      <g ref={demoAnchor}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              {SCREENS.map((screen) => (
                <rect key={screen.channel} className="ik-well" x={screen.x - 2} y={STAND.y - 2} width={screen.w + 4} height={STAND.d + 4} rx={2} />
              ))}
              {[
                [7, BASE.d - 7],
                [BASE.w - 7, BASE.d - 7],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.4} />
              ))}
            </>
          }
        />
        {SCREENS.map((screen) => (
          <Press
            key={screen.channel}
            label={focus === screen.channel ? "Show all channels" : `Show the ${screen.name.toLowerCase()} placement`}
            material="glass"
            onPress={() => pressScreen(screen.channel)}
            data-hot={hot === screen.channel}
          >
            <g>
              <Box
                x={screen.x}
                y={STAND.y}
                z={BASE.h}
                w={screen.w}
                d={STAND.d}
                h={screen.h}
                r={2.5}
                top={<path className="ik-detail" d={`M${screen.w / 2 - 6} ${STAND.d / 2}h12`} />}
                front={
                  <g style={screen.timing}>
                    <rect className="ik-screen" x={3} y={3} width={screen.w - 6} height={screen.screen} rx={2.5} />
                    {live ? (
                      <g key={launches} className="ik-enter ch-arrive">
                        <Placement channel={screen.channel} />
                      </g>
                    ) : (
                      <rect className="ik-dash" x={7} y={7} width={screen.w - 14} height={screen.screen - 8} rx={2} />
                    )}
                    <Glow on={live} className="ch-dot-glow">
                      <circle className="ch-dot" data-on={live} cx={screen.w - 7} cy={7} r={1.7} />
                    </Glow>
                    <text className="ik-label ch-name" x={screen.w / 2} y={screen.screen + 10.5} textAnchor="middle">
                      {screen.name.toUpperCase()}
                    </text>
                  </g>
                }
              />
            </g>
          </Press>
        ))}
        {SCREENS.map((screen) => (
          <g key={screen.channel} className="ch-wire" data-focus={focus === screen.channel} style={screen.timing}>
            <path className="ik-dash draft" d={path(screen.cable)} />
            <path className="ik-line solid" d={path(screen.cable)} />
          </g>
        ))}
        {live
          ? SCREENS.map((screen) => (
              <Glow key={`${launches}-${screen.channel}`}>
                <Signal points={screen.cable} delay={screen.arrive - TRAVEL_MS} duration={TRAVEL_MS} />
              </Glow>
            ))
          : null}
        <Box
          {...HUB}
          r={8}
          top={
            <>
              <rect className="ik-detail" x={4} y={4} width={HUB.w - 8} height={HUB.d - 8} rx={5} />
              <rect className="ik-well" x={RELAY.x} y={RELAY.y} width={RELAY.w} height={RELAY.d} rx={1.5} />
              <rect className="ik-detail" x={RELAY.x + 2.5} y={RELAY.y + 1.8} width={7} height={4} rx={0.8} />
              <path className="ik-detail" d={`M${RELAY.x + 4.5} ${RELAY.y + 1.8}v4M${RELAY.x + 6} ${RELAY.y + 1.8}v4M${RELAY.x + 7.5} ${RELAY.y + 1.8}v4`} />
              <path className="ik-detail" d={`M${RELAY.x + 3 + RELAY.arm + 1.2} ${RELAY.y + RELAY.d - 5}v3.6`} />
              <g transform={`translate(${RELAY.x + 3} ${RELAY.y + RELAY.d - 3.2})`}>
                <g className="ch-arm">
                  <path className="ik-line" d={`M0 0h${RELAY.arm}`} />
                </g>
                <circle className="ik-fill" r={0.9} />
              </g>
            </>
          }
          front={
            <>
              <g transform={`translate(${DIAL.x} ${DIAL.y})`}>
                <circle className="ik-detail" r={DIAL.r + 2} />
                <path className="ik-detail" d={DETENTS} />
                <circle className="ik-fill" cx={ALL_MARK.cx} cy={ALL_MARK.cy} r={0.9} />
                <g className="ch-dial" style={{ "--turn": `${turn}deg` } as CSSProperties}>
                  <circle className="ik-face" r={DIAL.r} />
                  <path className="ik-line ik-thick" d={`M0 -1.2V${-DIAL.r + 1}`} />
                </g>
              </g>
              <rect className="ik-screen" x={HUB_SCREEN.x} y={HUB_SCREEN.y} width={HUB_SCREEN.w} height={HUB_SCREEN.h} rx={3} />
              <g key={`${live}-${focus ?? "all"}`} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={HUB_SCREEN.x + 4} y={11} fontSize={4}>
                  {focused ? `${focused.name.toLowerCase()} · ${live ? "live" : "ready"}` : `campaign · ${live ? "live" : "draft"}`}
                </text>
                <Glow>
                  <text className="ik-screen-text" x={HUB_SCREEN.x + 4} y={18.4} fontSize={6}>
                    {focused ? focused.format : live ? "3 channels" : "ready"}
                  </text>
                </Glow>
              </g>
              <Glow on={live} className="ch-lamp-glow">
                <circle className="ch-lamp" data-on={live} cx={LAMP.x} cy={LAMP.y} r={2.2} />
              </Glow>
              <path className="ik-detail" d={`M${LAMP.x - 3} 15.5h6M${LAMP.x - 3} 18h6M${LAMP.x - 3} 20.5h6`} />
            </>
          }
          side={Array.from({ length: 6 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${7 + k * 3.4} 7v12`} />
          ))}
        />
        {suggested && phase !== "aim" && phase !== "press" ? <Ripple x={suggested.x - 2} y={STAND.y - 2} z={BASE.h} w={suggested.w + 4} d={STAND.d + 4} r={2} /> : null}
        {guide === "fresh" && !live && phase !== "aim" && phase !== "press" ? <Ripple {...KEY} r={5} /> : null}
        <Press label={live ? "Pause the campaign" : "Launch the campaign on every channel"} material="plastic" onPress={pressLaunch} data-hot={!live && !focus}>
          <g>
            <Box
              {...KEY}
              r={5}
              top={
                <text className="ik-label ch-key" x={5} y={12.6}>
                  {live ? "PAUSE" : "LAUNCH"}
                </text>
              }
            />
          </g>
        </Press>
        <Callout at={RELAY_AT} dx={26} dy={-10} label="relay" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
