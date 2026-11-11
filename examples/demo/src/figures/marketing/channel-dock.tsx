import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, path, playSound, project, Ripple, Signal, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./channel-dock.css"

export const meta = {
  slug: "channel-dock",
  title: "Channel dock",
  industry: "marketing",
  level: 2,
  blurb: "Press a channel card: it drops into its slot, a catch latches it in, a signal reaches the screen and the next card lights up.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "path", "project"],
  sounds: ["press", "release", "latch", "done", "complete", "whoosh"],
} satisfies FigureMeta

type Channel = "meta" | "google" | "tiktok"
type Card = { channel: Channel; name: string; short: string; x: number; glyph: readonly string[] }
type Last = { channel: Channel; on: boolean; n: number }

const DOCK = { x: 0, y: 0, z: 0, w: 150, d: 72, h: 30 }
const CARD = { y: 14, w: 34, d: 6, h: 42 }
const HOVER = 18
const CARD_Z = DOCK.h + HOVER
const LIGHT_Y = CARD.y + CARD.d + 11
const CATCH = { y: CARD.y + CARD.d + 3, w: 10, d: 3, h: 2.5, travel: 2.5 }
const SEAT_MS = 420
const SIGNAL_MS = 240
const CARDS: readonly Card[] = [
  { channel: "meta", name: "Meta Ads", short: "META", x: 12, glyph: ["M7 5C5.5 2 1 2 1 5s4.5 3 6 0 6-3 6 0-4.5 3-6 0"] },
  { channel: "google", name: "Google Ads", short: "GOOGLE", x: 58, glyph: ["M3.6 8.6L7 1.8l3.6 6.8", "M3.4 8.8h.01"] },
  { channel: "tiktok", name: "TikTok Ads", short: "TIKTOK", x: 104, glyph: ["M7.4 1.2v6a2.4 2.4 0 1 1-2.4-2.4", "M7.4 1.2c.4 1.7 1.7 2.7 3.6 2.8"] },
]
const BY_CHANNEL: ReadonlyMap<Channel, Card> = new Map(CARDS.map((card) => [card.channel, card]))
const FIRST = CARDS[0] as Card
const [SLIDE_X, SLIDE_Y] = project(0, -CATCH.travel, 0)
const TIMING = {
  "--seat": `${SEAT_MS}ms`,
  "--arrive": `${SEAT_MS + SIGNAL_MS}ms`,
  "--drop": `${HOVER}px`,
  "--catch": `translate(${SLIDE_X.toFixed(3)}px, ${SLIDE_Y.toFixed(3)}px)`,
} as CSSProperties
const trace = (card: Card) => [[card.x + CARD.w / 2, LIGHT_Y, DOCK.h], [card.x + CARD.w / 2, DOCK.d - 4, DOCK.h]] as const
const guides = (card: Card) =>
  [card.x, card.x + CARD.w].map((x) => path([[x, CARD.y + CARD.d, DOCK.h], [x, CARD.y + CARD.d, CARD_Z]])).join("")

export default function ChannelDock() {
  const [linked, setLinked] = useState<ReadonlySet<Channel>>(() => new Set())
  const [last, setLast] = useState<Last | null>(null)
  const [touched, setTouched] = useState(false)
  const timer = useRef(0)
  const stop = useRef(() => {})
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const total = CARDS.length
  const target = CARDS.find((card) => !linked.has(card.channel)) ?? null
  const toggle = (channel: Channel, audible: boolean) => {
    const on = !linked.has(channel)
    const next = new Set(on ? [...linked, channel] : [...linked].filter((c) => c !== channel))
    window.clearTimeout(timer.current)
    stop.current()
    stop.current = () => {}
    if (audible && on) {
      const result = next.size === total ? "complete" : "done"
      timer.current = window.setTimeout(() => {
        stop.current = playSound("latch")
        timer.current = window.setTimeout(() => {
          stop.current = playSound(result)
        }, SIGNAL_MS)
      }, SEAT_MS)
    }
    if (audible && !on) stop.current = playSound("whoosh")
    setLinked(next)
    setLast({ channel, on, n: last ? 1 - last.n : 0 })
  }
  const demo = useDemoTap(() => {
    if (!linked.has(FIRST.channel)) toggle(FIRST.channel, false)
  }, { delay: 500 })
  const press = (channel: Channel) => {
    demo.dismiss()
    setTouched(true)
    toggle(channel, true)
  }

  const shown = last ? BY_CHANNEL.get(last.channel) : undefined
  const name = shown ? shown.name.toLowerCase() : ""
  const count = linked.size
  const seated = last?.on ? shown : undefined
  const settled = target === null && seated !== undefined
  const readout = !last ? `0 of ${total} linked` : count === total ? "all channels live · ready" : `${name} ${last.on ? "linked" : "unlinked"} · ${count} of ${total}`

  return (
    <Plate
      {...demo.plate}
      fig="Marketing"
      name="Channel dock"
      hint="Press a card"
      readout={readout}
      className="fig-channel-dock"
      style={TIMING}
      data-live={count === total}
      fit={[DOCK, { x: 12, y: CARD.y, z: CARD_Z, w: 126, d: CARD.d, h: CARD.h }]}
      aspect={1.3}
      label="A dock with three ad-channel cards hovering over their slots. Press a card to drop it in, latch it and connect that channel."
    >
      <g ref={demo.ref}>
        <Box
          {...DOCK}
          r={10}
          top={
            <>
              <rect className="ik-detail" x={6} y={6} width={DOCK.w - 12} height={DOCK.d - 12} rx={6} />
              {CARDS.map((card) => {
                const on = linked.has(card.channel)
                return (
                  <g key={card.channel}>
                    <rect className="ik-well" x={card.x - 2} y={CARD.y - 2} width={CARD.w + 4} height={CARD.d + 4} rx={2} />
                    <path className="ik-detail" d={`M${card.x + CARD.w / 2} ${LIGHT_Y}V${DOCK.d - 6}`} />
                    <Glow on={on} className="cd-light-glow">
                      <circle className="cd-light" data-on={on} data-last={settled && shown?.channel === card.channel} cx={card.x + CARD.w / 2} cy={LIGHT_Y} r={1.8} />
                    </Glow>
                  </g>
                )
              })}
            </>
          }
          front={
            <>
              <rect className="ik-screen" x={8} y={6} width={100} height={19} rx={3} />
              <g key={last ? last.n : "rest"} className="ik-enter cd-text" data-seated={seated !== undefined}>
                <text className="ik-screen-text ik-dim" x={13} y={12.6} fontSize={5}>
                  {last ? `${name} · ${last.on ? "linked" : "unlinked"}` : "no channels yet"}
                </text>
                <Glow>
                  <text className="ik-screen-text" x={13} y={21.6} fontSize={7}>
                    {count === total ? "all channels live" : `${count} of ${total} linked`}
                  </text>
                </Glow>
              </g>
              {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                <path key={k} className="ik-detail" d={`M${117 + k * 3.4} 8v14`} />
              ))}
            </>
          }
          side={<rect className="ik-well" x={10} y={11} width={12} height={8} rx={1.4} />}
        />
        {seated && last ? (
          <Glow key={last.n}>
            <Signal points={trace(seated)} delay={SEAT_MS} duration={SIGNAL_MS} />
          </Glow>
        ) : null}
        {!touched && target && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple x={target.x - 2} y={CARD.y - 2} z={DOCK.h} w={CARD.w + 4} d={CARD.d + 4} r={2} /> : null}
        {CARDS.map((card) => (
          <path key={card.channel} className="ik-dash cd-guide" data-on={linked.has(card.channel)} d={guides(card)} />
        ))}
        {CARDS.map((card, i) => {
          const on = linked.has(card.channel)
          return (
            <Press
              key={card.channel}
              className="cd-seat"
              label={`${on ? "Disconnect" : "Connect"} ${card.name}`}
              material="plastic"
              onPress={() => press(card.channel)}
              data-on={on}
              data-hot={target?.channel === card.channel}
            >
              <g>
                <g className="cd-card">
                  <g className="cd-bob ik-loop" style={{ animationDelay: `${-i * 1.3}s` }}>
                    <Box
                      x={card.x}
                      y={CARD.y}
                      z={CARD_Z}
                      w={CARD.w}
                      d={CARD.d}
                      h={CARD.h}
                      r={2}
                      top={<path className="ik-detail" d={`M${CARD.w / 2 - 5} ${CARD.d / 2}h10`} />}
                      front={
                        <>
                          <g transform="translate(10 6)">
                            {card.glyph.map((stroke) => (
                              <path key={stroke} className="ik-line ik-thick cd-glyph" d={stroke} />
                            ))}
                          </g>
                          <text className="ik-label cd-name" x={CARD.w / 2} y={26} textAnchor="middle">
                            {card.short}
                          </text>
                          {[0, 1, 2, 3, 4].map((k) => (
                            <rect key={k} className="ik-fill cd-contact" x={7.2 + k * 4.2} y={33} width={2.2} height={5} rx={0.6} />
                          ))}
                        </>
                      }
                      side={<path className="ik-detail" d="M1.5 6v8M3 6v8M4.5 6v8" />}
                    />
                  </g>
                </g>
              </g>
            </Press>
          )
        })}
        {CARDS.map((card) => (
          <g key={card.channel} className="cd-catch" data-on={linked.has(card.channel)}>
            <Box
              x={card.x + CARD.w / 2 - CATCH.w / 2}
              y={CATCH.y}
              z={DOCK.h}
              w={CATCH.w}
              d={CATCH.d}
              h={CATCH.h}
              r={1}
              top={<path className="ik-detail" d={`M2.5 ${CATCH.d / 2}h${CATCH.w - 5}`} />}
            />
          </g>
        ))}
        <Cursor at={[FIRST.x + CARD.w / 2, CARD.y + CARD.d, CARD_Z + CARD.h / 2]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
