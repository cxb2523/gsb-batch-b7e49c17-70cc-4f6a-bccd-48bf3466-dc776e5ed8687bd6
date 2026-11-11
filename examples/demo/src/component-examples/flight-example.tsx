import { type CSSProperties, type ReactNode, useState } from "react"
import { Box, Flight, Plate, Press, playSound } from "react-isokit"

const COIN = { w: 24, d: 24, h: 4, step: 5 }
const LEFT_X = 0
const RIGHT_X = 70
const MOVE = { x: 20, y: 44, z: 0, w: 50, d: 16, h: 5 }
const FLIGHT_MS = 520
const STACK_SLOTS = [0, 1, 2, 3, 4, 5] as const
const FRAME = { x: 0, y: 0, z: 0, w: 94, d: 24, h: 60 }

function Coin({ x, slot, on, delay }: { x: number; slot: number; on: boolean; delay: number }): ReactNode {
  return (
    <g className="example-coin" data-on={on} style={{ "--t": `${delay}ms` } as CSSProperties}>
      <Box x={x} y={0} z={slot * COIN.step} w={COIN.w} d={COIN.d} h={COIN.h} r={COIN.w / 2} />
    </g>
  )
}

export function FlightExample(): ReactNode {
  const [left, setLeft] = useState(4)
  const [step, setStep] = useState(0)
  const [flying, setFlying] = useState(false)
  const right = STACK_SLOTS.length - left
  const move = () => {
    const canMove = left > 0
    setStep(step + 1)
    setFlying(canMove)
    setLeft(canMove ? left - 1 : STACK_SLOTS.length)
    playSound(canMove ? "done" : "whoosh", canMove ? { delay: FLIGHT_MS / 1000 } : undefined)
  }
  return (
    <Plate hint={left ? "Press move" : "Press to refill"} readout={`${left} left · ${right} right`} fit={[MOVE, FRAME]} aspect={1.6} label="Two stacks of coins. Press move and a coin flies from the left stack onto the right one.">
      {STACK_SLOTS.map((slot) => (
        <Coin key={`left-${slot}`} x={LEFT_X} slot={slot} on={slot < left} delay={0} />
      ))}
      {STACK_SLOTS.map((slot) => (
        <Coin key={`right-${slot}`} x={RIGHT_X} slot={slot} on={slot < right} delay={flying && slot === right - 1 ? FLIGHT_MS : 0} />
      ))}
      <Press label={left ? "Move a coin" : "Refill the left stack"} onPress={move} data-hot={step === 0}>
        <g>
          <Box
            {...MOVE}
            r={6}
            top={
              <text className="ik-label" x={6} y={11}>
                MOVE
              </text>
            }
          />
        </g>
      </Press>
      {flying ? (
        <Flight key={step} from={[LEFT_X, 0, left * COIN.step]} to={[RIGHT_X, 0, (right - 1) * COIN.step]} duration={FLIGHT_MS}>
          <Box x={LEFT_X} y={0} z={left * COIN.step} w={COIN.w} d={COIN.d} h={COIN.h} r={COIN.w / 2} />
        </Flight>
      ) : null}
    </Plate>
  )
}
