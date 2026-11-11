import { type Box3, project, type Vec2, type Vec3 } from "react-isokit"

export type Plan = { x: number; y: number }
export type Turn = { from: number; to: number }
export type Ellipse = { cx: number; cy: number; a: number; b: number }

export const NEAR: Turn = { from: -45, to: 135 }
export const FAR: Turn = { from: 135, to: 315 }
export const FACING = 45

const WIDE = Math.sqrt(1.5)
const TALL = Math.SQRT1_2
const DEGREES_PER_STEP = 6
const REACH = 1000

export const round = (value: number): number => Math.round(value * 1000) / 1000
const pair = ([x, y]: Vec2): string => `${round(x)} ${round(y)}`
const radians = (degrees: number): number => (degrees * Math.PI) / 180

export const rim = (axis: Plan, r: number, z: number, degrees: number): Vec3 => [axis.x + r * Math.cos(radians(degrees)), axis.y + r * Math.sin(radians(degrees)), z]

export function ellipseOf(axis: Plan, r: number, z: number): Ellipse {
  const [cx, cy] = project(axis.x, axis.y, z)
  return { cx, cy, a: r * WIDE, b: r * TALL }
}

export function ellipse(axis: Plan, r: number, z: number): string {
  const { cx, cy, a, b } = ellipseOf(axis, r, z)
  const radii = `${round(a)} ${round(b)}`
  return `M${pair([cx - a, cy])}A${radii} 0 1 0 ${pair([cx + a, cy])}A${radii} 0 1 0 ${pair([cx - a, cy])}Z`
}

export function wallEdge(axis: Plan, r: number, z: number, h: number): string {
  const lid = ellipseOf(axis, r, z + h)
  const foot = ellipseOf(axis, r, z)
  return `M${pair([lid.cx - lid.a, lid.cy])}L${pair([foot.cx - foot.a, foot.cy])}A${round(foot.a)} ${round(foot.b)} 0 0 0 ${pair([foot.cx + foot.a, foot.cy])}L${pair([lid.cx + lid.a, lid.cy])}`
}

export function nearArc(axis: Plan, r: number, z: number): string {
  const { cx, cy, a, b } = ellipseOf(axis, r, z)
  return `M${pair([cx - a, cy])}A${round(a)} ${round(b)} 0 0 0 ${pair([cx + a, cy])}`
}

export function seenThrough(axis: Plan, bore: number, z: number): string {
  const { cx, cy, a, b } = ellipseOf(axis, bore, z)
  return `M${pair([cx - REACH, cy])}L${pair([cx - a, cy])}A${round(a)} ${round(b)} 0 0 0 ${pair([cx + a, cy])}L${pair([cx + REACH, cy])}V${round(cy - REACH)}H${round(cx - REACH)}Z`
}

export const extentOf = (axis: Plan, r: number, z: number, h: number): Box3 => {
  const half = r * TALL
  return { x: axis.x - half, y: axis.y - half, z, w: half * 2, d: half * 2, h }
}

const unwrap = (degrees: number, middle: number): number => ((((degrees - middle) % 360) + 540) % 360) - 180 + middle

export function clip(turn: Turn, window: Turn): Turn | null {
  const middle = (window.from + window.to) / 2
  const center = unwrap((turn.from + turn.to) / 2, middle)
  const half = (turn.to - turn.from) / 2
  const from = Math.max(center - half, window.from)
  const to = Math.min(center + half, window.to)
  return from < to ? { from, to } : null
}

export const within = (degrees: number, window: Turn, margin = 0): boolean => {
  const angle = unwrap(degrees, (window.from + window.to) / 2)
  return angle > window.from + margin && angle < window.to - margin
}

export const spread = (turn: Turn, count: number): number[] => Array.from({ length: count }, (_, k) => turn.from + ((turn.to - turn.from) * (k + 0.5)) / count)

export const around = (count: number, phase = 0): number[] => Array.from({ length: count }, (_, k) => phase + (k * 360) / count)

const sweep = (turn: Turn): number[] => {
  const steps = Math.max(2, Math.ceil((turn.to - turn.from) / DEGREES_PER_STEP))
  return Array.from({ length: steps + 1 }, (_, k) => turn.from + ((turn.to - turn.from) * k) / steps)
}

export function band(axis: Plan, r: number, z: number, h: number, turn: Turn): string {
  const angles = sweep(turn)
  const upper = angles.map((degrees) => project(...rim(axis, r, z + h, degrees)))
  const lower = [...angles].reverse().map((degrees) => project(...rim(axis, r, z, degrees)))
  return `M${[...upper, ...lower].map(pair).join("L")}Z`
}

export const verticals = (axis: Plan, r: number, z: number, h: number, angles: readonly number[]): string =>
  angles.map((degrees) => `M${pair(project(...rim(axis, r, z + h, degrees)))}L${pair(project(...rim(axis, r, z, degrees)))}`).join("")

export const onPlane = (r: number, degrees: number): Vec2 => [r * Math.cos(radians(degrees)), r * Math.sin(radians(degrees))]
const onFace = (r: number, degrees: number): string => pair(onPlane(r, degrees))

export function sector(turn: Turn, inner: number, outer: number): string {
  const large = turn.to - turn.from > 180 ? 1 : 0
  return `M${onFace(outer, turn.from)}A${outer} ${outer} 0 ${large} 1 ${onFace(outer, turn.to)}L${onFace(inner, turn.to)}A${inner} ${inner} 0 ${large} 0 ${onFace(inner, turn.from)}Z`
}

export const spokes = (angles: readonly number[], inner: number, outer: number): string => angles.map((degrees) => `M${onFace(inner, degrees)}L${onFace(outer, degrees)}`).join("")

export function slots(count: number, inner: number, outer: number, width: number, phase = 0): string {
  return around(count, phase)
    .map((degrees) => {
      const [cos, sin] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))]
      const corner = (along: number, across: number): string => pair([along * cos - across * sin, along * sin + across * cos])
      return `M${corner(inner, -width / 2)}L${corner(outer, -width / 2)}L${corner(outer, width / 2)}L${corner(inner, width / 2)}Z`
    })
    .join("")
}

export const nearness = (degrees: number, pitch: number): number => Math.round(Math.abs(unwrap(degrees - FACING, 0)) / pitch)

export type Coil = { copper: Turn; window: Turn; turns: number[]; step: number }

export const ringPhase = (count: number): number => FACING - 180 / count

export function coilsAround(count: number, fill: number, phase: number, turnsPerCoil: number): Coil[] {
  const pitch = 360 / count
  const half = (pitch * fill) / 2
  const margin = (pitch / 2 - half) * 0.2
  return around(count, phase).map((center) => ({
    copper: { from: center - half, to: center + half },
    window: { from: center + half + margin, to: center + pitch - half - margin },
    turns: spread({ from: center - half, to: center + half }, turnsPerCoil),
    step: nearness(center + pitch / 2, pitch),
  }))
}

export type Window = { x: number; y: number; step: number }

export const windowsAround = (count: number, fill: number, radius: number): Window[] =>
  coilsAround(count, fill, ringPhase(count), 0).map((coil) => {
    const [x, y] = onPlane(radius, (coil.window.from + coil.window.to) / 2)
    return { x, y, step: coil.step }
  })

export type CoilRingShape = {
  windows: { key: number; d: string; step: number }[]
  tops: string
  topTurns: string
  walls: string
  wallTurns: string
  boreWalls: string
  boreTurns: string
}

const WINDOW_INSET = 2.2
const TURN_MARGIN = 1.5
const TURN_INSET = 0.6

export function coilRing(axis: Plan, z: number, r: number, bore: number, h: number, depth: number, count: number, fill: number, turnsPerCoil: number): CoilRingShape {
  const coils = coilsAround(count, fill, ringPhase(count), turnsPerCoil)
  const faces = (radius: number, from: number, height: number, window: Turn): [string, string] => [
    coils.flatMap((coil) => {
      const part = clip(coil.copper, window)
      return part ? [band(axis, radius, from, height, part)] : []
    }).join(""),
    verticals(axis, radius, from + TURN_INSET, height - TURN_INSET * 2, coils.flatMap((coil) => coil.turns.filter((degrees) => within(degrees, window, TURN_MARGIN)))),
  ]
  const [walls, wallTurns] = faces(r, z, h, NEAR)
  const [boreWalls, boreTurns] = faces(bore, z + h - depth, depth, FAR)
  return {
    windows: coils.map((coil) => ({ key: coil.window.from, d: sector(coil.window, bore + WINDOW_INSET, r - WINDOW_INSET), step: coil.step })),
    tops: coils.map((coil) => sector(coil.copper, bore, r)).join(""),
    topTurns: spokes(coils.flatMap((coil) => coil.turns), bore + TURN_INSET, r - TURN_INSET),
    walls,
    wallTurns,
    boreWalls,
    boreTurns,
  }
}
