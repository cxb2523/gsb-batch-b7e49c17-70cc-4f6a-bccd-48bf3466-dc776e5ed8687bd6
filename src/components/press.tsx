import { type KeyboardEvent, type ReactNode, type SVGProps, useState } from "react"
import { classNames } from "../class-names"
import type { Material } from "../schema"
import { placeSound } from "../sound/sound-placement"
import { playSound } from "../sound/sound-player"

export type PressProps = {
  label: string
  onPress: () => void
  sound?: boolean
  material?: Material
  disabled?: boolean
  className?: string
  children: ReactNode
} & Omit<SVGProps<SVGGElement>, "onClick" | "onKeyDown" | "onKeyUp" | "children" | "className">

const isActivationKey = (event: KeyboardEvent): boolean => event.key === "Enter" || event.key === " "

export function Press({ label, onPress, sound = true, material = "plastic", disabled, className, children, onBlur, onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, ...rest }: PressProps): ReactNode {
  const [down, setDown] = useState(false)
  const pushDown = (part: Element) => {
    if (disabled) return
    setDown(true)
    if (sound) playSound("press", { material, ...placeSound(part) })
  }
  const letUp = (part: Element) => {
    setDown(false)
    if (sound) playSound("release", { material, ...placeSound(part) })
  }
  return (
    <g
      className={classNames("ik-press", className)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-down={down}
      onPointerDown={(event) => {
        if (event.button === 0) pushDown(event.currentTarget)
        onPointerDown?.(event)
      }}
      onPointerUp={(event) => {
        if (down) letUp(event.currentTarget)
        onPointerUp?.(event)
      }}
      onPointerLeave={(event) => {
        setDown(false)
        onPointerLeave?.(event)
      }}
      onPointerCancel={(event) => {
        setDown(false)
        onPointerCancel?.(event)
      }}
      onBlur={(event) => {
        setDown(false)
        onBlur?.(event)
      }}
      onClick={() => {
        if (!disabled) onPress()
      }}
      onKeyDown={(event) => {
        if (!isActivationKey(event)) return
        event.preventDefault()
        if (!event.repeat) pushDown(event.currentTarget)
      }}
      onKeyUp={(event) => {
        if (!isActivationKey(event) || !down) return
        event.preventDefault()
        letUp(event.currentTarget)
        if (!disabled) onPress()
      }}
      {...rest}
    >
      {children}
    </g>
  )
}
