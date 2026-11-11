import { type ReactNode, useEffect, useRef, useState } from "react"
import { playSound, useSoundEnabled } from "react-isokit"
import { href } from "../app/route-store"
import { figuresBySound, NO_FIGURES } from "../catalog/figure-registry"
import { SOUND_RULES, SOUNDS, type SoundDoc } from "../catalog/sound-docs"
import SoundBoard from "../figures/agents/sound-board"

function SoundRow({ sound, focused }: { sound: SoundDoc; focused: boolean }): ReactNode {
  const [playing, setPlaying] = useState(false)
  const playingTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(playingTimer.current), [])
  const play = () => {
    playSound(sound.name)
    setPlaying(true)
    window.clearTimeout(playingTimer.current)
    playingTimer.current = window.setTimeout(() => setPlaying(false), sound.seconds * 1000)
  }
  const figures = figuresBySound.get(sound.name) ?? NO_FIGURES
  return (
    <li id={`sound-${sound.name}`} className="sound-row" data-focused={focused || undefined}>
      <button type="button" className="sound-play" onClick={play} aria-pressed={playing} aria-label={`Play ${sound.name}`}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
        </svg>
      </button>
      <div>
        <h3>
          <code>{sound.name}</code> <span>{sound.seconds}s</span>
        </h3>
        <p>
          {sound.feel} {sound.when}
        </p>
        {figures.length ? (
          <ul className="chips">
            {figures.map((figure) => (
              <li key={figure.slug}>
                <a href={href("figures", figure.slug)}>{figure.title}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}

export function SoundPage({ focus }: { focus: string | undefined }): ReactNode {
  const [on, setOn] = useSoundEnabled()
  useEffect(() => {
    if (focus) document.getElementById(`sound-${focus}`)?.scrollIntoView({ block: "center" })
  }, [focus])
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Sound · {SOUNDS.length} sounds</p>
        <h1>Twenty sounds, no files.</h1>
        <p className="lede">Clicks shaped by what a part is made of, the ticks, latches, relays and motors of a mechanism, and the chimes of a result. Press a pad to listen. The browser makes each sound, so there are no audio files to load.</p>
        {on ? null : (
          <button type="button" className="pill" onClick={() => setOn(true)}>
            Sound is off · turn it on
          </button>
        )}
      </header>
      <div className="sound-stage">
        <SoundBoard />
      </div>
      <section className="figure-section" aria-labelledby="palette">
        <div className="section-head">
          <h2 id="palette">The palette</h2>
          <p>What each sound feels like, when to reach for it, and the figures that use it.</p>
        </div>
        <ol className="sound-list">
          {SOUNDS.map((sound) => (
            <SoundRow key={sound.name} sound={sound} focused={focus === sound.name} />
          ))}
        </ol>
      </section>
      <section className="figure-section" aria-labelledby="rules">
        <div className="section-head">
          <h2 id="rules">Four rules</h2>
        </div>
        <ul className="notes">
          {SOUND_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
