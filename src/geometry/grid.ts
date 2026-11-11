import { project } from "./projection"
import { round3 } from "./round"

export type GridTile = { width: number; height: number; path: string }

export type ViewBoxRect = { x: number; y: number; width: number; height: number }

export function gridTile(step: number): GridTile {
  const width = round3(2 * project(step, 0, 0)[0])
  const height = round3(step)
  return { width, height, path: `M0 0L${width} ${height}M${width} 0L0 ${height}` }
}

export function viewBoxRect(viewBox: string): ViewBoxRect {
  const [x = 0, y = 0, width = 0, height = 0] = viewBox.trim().split(/[\s,]+/).map(Number)
  return { x, y, width, height }
}

export function gridSheet(viewBox: string): ViewBoxRect {
  const { x, y, width, height } = viewBoxRect(viewBox)
  return { x: x - width, y: y - height, width: width * 3, height: height * 3 }
}
