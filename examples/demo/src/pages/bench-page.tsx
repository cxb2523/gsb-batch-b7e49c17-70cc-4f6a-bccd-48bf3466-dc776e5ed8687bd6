import { type DialConfig, DialRoot, useDialKit } from "dialkit"
import "dialkit/styles.css"
import { type CSSProperties, type ReactNode, useEffect, useState } from "react"
import { configureSound, playSound, type SoundName, SoundToggle } from "react-isokit"
import { useTheme } from "../app/theme-store"
import { block, type Declarations } from "../bench/bench-css"
import { LIGHT, LOOK_SEEDS, LOOKS, type Look, lightDeclarations, MOTION, materialTable, motionDeclarations, SOUND, seedDeclarations, tuneMaterials } from "../bench/bench-panels"
import { FIGURES, figureBySlug } from "../catalog/figure-registry"

const STAGE = {
  figure: { type: "select", options: FIGURES.map((figure) => figure.slug), default: "tally-counter" },
  look: { type: "select", options: ["default", ...LOOKS], default: "default" },
} satisfies DialConfig

const PERSIST = { persist: true } as const
const STAGE_SELECTOR = ".bench-stage .ik-plate"
const KIT_SELECTOR = ":where(.ik-plate)"
const RECIPE_OPTIONS: Partial<Record<SoundName, { duration?: number; count?: number }>> = { motor: { duration: 0.9 }, roll: { count: 3 } }
const RELEASE_AFTER_MS = 110

const isLook = (value: string): value is Look => (LOOKS as readonly string[]).includes(value)

const copy = (text: string) => navigator.clipboard?.writeText(text)

export function BenchPage(): ReactNode {
  const [copied, setCopied] = useState("")
  const [theme] = useTheme()
  const stage = useDialKit("Stage", STAGE, { id: "bench-stage", ...PERSIST })
  const motion = useDialKit("Motion", MOTION, { id: "bench-motion", ...PERSIST, onAction: () => announce(kitCss) })
  const light = useDialKit("Light and lines", LIGHT, { id: "bench-light", ...PERSIST })
  const seeds = useDialKit("Look seeds", LOOK_SEEDS, { id: "bench-looks", ...PERSIST, defaultCollapsed: true })
  const sound = useDialKit("Sound", SOUND, {
    id: "bench-sound",
    ...PERSIST,
    defaultCollapsed: true,
    onAction: (action) => {
      const [group, name] = action.split(".")
      if (action === "copy") return announce(materialTable())
      if (group === "recipes" && name) return void playSound(name as SoundName, RECIPE_OPTIONS[name as SoundName])
      if (name === "hear" && group) {
        playSound("press", { material: group as never })
        window.setTimeout(() => playSound("release", { material: group as never }), RELEASE_AFTER_MS)
      }
    },
  })

  useEffect(() => {
    tuneMaterials(sound as Record<string, unknown>)
    configureSound({ volume: Number(sound.volume) })
  }, [sound])

  const look = isLook(String(stage.look)) ? (String(stage.look) as Look) : undefined
  const kitDeclarations: Declarations = [...motionDeclarations(motion as never), ...lightDeclarations(light as never)]
  const kitCss = block(KIT_SELECTOR, kitDeclarations)
  const lookSeeds = look ? (seeds as Record<string, Parameters<typeof seedDeclarations>[0] | undefined>)[look] : undefined
  const lookDeclarations = lookSeeds ? seedDeclarations(lookSeeds) : []
  const lookCss = look ? block(`:where([data-look="${look}"])`, lookDeclarations) : ""
  const lookStyle = Object.fromEntries(lookDeclarations) as CSSProperties
  const entry = figureBySlug.get(String(stage.figure)) ?? FIGURES[0]

  function announce(text: string) {
    copy(text)
    setCopied(text)
  }

  return (
    <main className="page bench">
      <style>{block(STAGE_SELECTOR, kitDeclarations)}</style>
      <header className="page-head">
        <p className="eyebrow">isokit · Bench · development only</p>
        <h1>Tune the kit by hand.</h1>
        <p className="lede">Every dial writes the kit's --ik-* properties onto the figure below. Press it, listen, adjust, then copy the values into src/styles.css, src/themes.css or the material table. The header switches light and dark.</p>
        <SoundToggle />
      </header>
      <div className="bench-layout">
        <div className="bench-stage" data-look={look} style={lookStyle}>
          {entry && <entry.Figure key={entry.slug} />}
        </div>
        <aside className="bench-dials">
          <DialRoot mode="inline" theme={theme} />
        </aside>
      </div>
      <section className="bench-output" aria-label="Values to copy">
        <h2>Kit values</h2>
        <pre>
          <code>{kitCss}</code>
        </pre>
        {lookCss && (
          <>
            <h2>Look seeds</h2>
            <pre>
              <code>{lookCss}</code>
            </pre>
          </>
        )}
        {copied && <p className="bench-copied">Copied {copied.split("\n").length} lines to the clipboard.</p>}
      </section>
    </main>
  )
}

export default BenchPage
