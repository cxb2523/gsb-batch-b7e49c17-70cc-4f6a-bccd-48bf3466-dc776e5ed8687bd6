import { type ReactNode, useState } from "react"
import { Box, Cursor, Plate, Press, Ripple, useDemoTap } from "react-isokit"
import { KEY, KEY_TOP } from "./example-key"

function DemoTapKey(): ReactNode {
  const [presses, setPresses] = useState(0)
  const [touched, setTouched] = useState(false)
  const demo = useDemoTap(() => setPresses((count) => count + 1), { delay: 400 })
  const press = () => {
    demo.dismiss()
    setTouched(true)
    setPresses(presses + 1)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"
  return (
    <Plate
      {...demo.plate}
      hint={touched ? "Your turn" : "Watch, then press"}
      readout={presses ? `pressed ${presses}× · ${touched ? "by you" : "by the demo"}` : "waiting for view"}
      fit={[KEY, [KEY.x + KEY.w, KEY.y + KEY.d, KEY.z + 30]]}
      aspect={1.6}
      label="A key that presses itself once when it first comes into view, then waits for you."
    >
      <g ref={demo.ref}>
        {touched || aiming ? null : <Ripple {...KEY} r={10} />}
        <Press label="Press the key" onPress={press} data-hot={!touched}>
          <g>
            <Box {...KEY} r={10} />
          </g>
        </Press>
        <Cursor at={KEY_TOP} phase={demo.phase} />
      </g>
    </Plate>
  )
}

export function DemoTapExample(): ReactNode {
  const [run, setRun] = useState(0)
  return (
    <div className="example-stack">
      <DemoTapKey key={run} />
      <button type="button" className="pill" onClick={() => setRun(run + 1)}>
        Replay the demo
      </button>
    </div>
  )
}
