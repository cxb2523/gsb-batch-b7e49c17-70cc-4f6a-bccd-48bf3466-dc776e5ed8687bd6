import type { Vec3 } from "../schema"
import { round3 } from "./round"

export type Vec2 = [number, number]

const COS_30 = Math.cos(Math.PI / 6)
const SIN_30 = Math.sin(Math.PI / 6)

export const project = (x: number, y: number, z: number): Vec2 => [(x - y) * COS_30, (x + y) * SIN_30 - z]

const axesOf = (u: Vec3, v: Vec3): string => [...project(...u), ...project(...v)].map(round3).join(" ")

const TOP_AXES = axesOf([1, 0, 0], [0, 1, 0])
const FRONT_AXES = axesOf([1, 0, 0], [0, 0, -1])
const SIDE_AXES = axesOf([0, -1, 0], [0, 0, -1])

const onPlane = (axes: string, x: number, y: number, z: number): string => {
  const [originX, originY] = project(x, y, z)
  return `matrix(${axes} ${round3(originX)} ${round3(originY)})`
}

export const top = (x: number, y: number, z: number): string => onPlane(TOP_AXES, x, y, z)

export const front = (x: number, y: number, z: number): string => onPlane(FRONT_AXES, x, y, z)

export const side = (x: number, y: number, z: number): string => onPlane(SIDE_AXES, x, y, z)

export const path = (points: readonly Vec3[]): string => (points.length < 2 ? "" : `M${points.map((point) => project(...point).map(round3).join(" ")).join("L")}`)
