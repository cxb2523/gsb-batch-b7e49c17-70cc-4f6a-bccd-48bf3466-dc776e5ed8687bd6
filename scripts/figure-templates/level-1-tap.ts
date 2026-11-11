import { attribute, type FigureFiles, quoted, scope, type TemplateInput } from "./template-input.ts"

export function levelOneTap(input: TemplateInput): FigureFiles {
  const tsx = `import { useState } from "react"
import { Box, Cursor, Plate, Press, Ripple, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./${input.slug}.css"

export const meta = {
  slug: ${quoted(input.slug)},
  title: ${quoted(input.title)},
  industry: ${quoted(input.industry)},
  level: 1,
  blurb: ${quoted(input.blurb)},
  uses: ["Plate", "Box", "Press", "Ripple", "Cursor", "useDemoTap"],
  sounds: ["press", "release"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 150, d: 116, h: 12 }
const BODY = { x: 0, y: 0, z: 12, w: 150, d: 46, h: 48 }
const KEY = { x: 48, y: 68, z: 12, w: 54, d: 32, h: 8 }
const SCREEN = { x: 12, y: 9, w: 126, h: 30 }

export default function ${input.componentName}() {
  const [presses, setPresses] = useState(0)
  const demo = useDemoTap(() => setPresses((count) => count + 1))
  const press = () => {
    demo.dismiss()
    setPresses(presses + 1)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"
  return (
    <Plate
      {...demo.plate}
      fig="${attribute(input.industryTitle)}"
      name="${attribute(input.title)}"
      hint="Press the key"
      readout={presses ? \`pressed \${presses}×\` : "ready"}
      className="fig-${input.slug}"
      fit={[BASE, BODY, KEY]}
      aspect={1.3}
      label="${attribute(input.label)}"
    >
      <g ref={demo.ref}>
        <Box {...BASE} r={10} />
        <Box
          {...BODY}
          r={8}
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={4} />
              <circle className={presses ? "ik-dot" : "ik-fill"} cx={SCREEN.x + SCREEN.w - 9} cy={SCREEN.y + 9} r={2.4} />
              <g key={presses} className="ik-enter">
                <text className="ik-screen-text" x={SCREEN.x + 8} y={SCREEN.y + 20} fontSize={13}>
                  {String(presses).padStart(4, "0")}
                </text>
              </g>
            </>
          }
          side={<path className="ik-detail" d="M8 12v24M12 12v24M16 12v24" />}
        />
        {presses || aiming ? null : <Ripple {...KEY} r={6} />}
        <Press label="Press the key" material="rubber" onPress={press} data-hot={presses === 0}>
          <g>
            <Box {...KEY} r={6} top={<path className="ik-detail" d={\`M10 \${KEY.d / 2}h\${KEY.w - 20}\`} />} />
          </g>
        </Press>
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
`
  const css = `${scope(input)} .ik-screen-text { letter-spacing: 0.08em; }
`
  return { tsx, css }
}
