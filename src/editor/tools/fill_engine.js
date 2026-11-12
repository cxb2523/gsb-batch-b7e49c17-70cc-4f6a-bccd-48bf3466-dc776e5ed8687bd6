import { MODEL_MAP } from "../model/uv.js";

/**
 * Normalize a UV entry [x, y, width, height] into a positive-dimension
 * rectangle. Bottom faces use a negative height in the UV map.
 */
function normalizeRect(uv) {
  let [x, y, width, height] = uv;

  if (width < 0) {
    x += width;
    width = -width;
  }

  if (height < 0) {
    y += height;
    height = -height;
  }

  return { x, y, width, height };
}

function pointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

/**
 * Resolve the cube face rectangle (in texture pixels) that contains the
 * given point for the requested variant ("classic" / "slim").
 *
 * Returns null when the point lies outside every face of the variant's
 * cube layout, i.e. in unused space of the 64x64 skin texture.
 */
export function getFaceRectAtPoint(variant, point) {
  const uvMap = MODEL_MAP[variant];
  if (!uvMap) {
    return null;
  }

  for (const uv of Object.values(uvMap)) {
    const rect = normalizeRect(uv);

    if (pointInRect(point, rect)) {
      return rect;
    }
  }

  return null;
}

/**
 * Collect the pixels that a bucket fill must paint on a single cube face.
 *
 * The flood fill starts at `point`, spreads through 4-neighbour pixels
 * (up/down/left/right) and is hard-clipped to `rect`: it can never cross a
 * UV seam into another face or another model part.
 *
 * options.colorsMatch(c1, c2) decides whether two pixels count as the same
 * color. When options.replace is true every pixel of the face is collected
 * regardless of its current color ("replace" styles), while the fill still
 * cannot leave the face rectangle.
 */
export function computeFaceFill(texture, point, rect, { colorsMatch, replace = false } = {}) {
  const targetColor = texture.getPixel(point);
  const startKey = `${point.x},${point.y}`;
  const visited = new Set([startKey]);
  const queue = [point];
  const points = [];

  const inRect = (x, y) =>
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height;

  while (queue.length > 0) {
    const current = queue.shift();
    points.push(current);

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const next of neighbors) {
      const key = `${next.x},${next.y}`;

      if (visited.has(key) || !inRect(next.x, next.y)) {
        continue;
      }

      if (!replace && !colorsMatch(texture.getPixel(next), targetColor)) {
        continue;
      }

      visited.add(key);
      queue.push(next);
    }
  }

  return points;
}

/**
 * Cube-aware bucket fill based on the variant's real cube layout.
 *
 * Returns { rect, points } for the clicked face, or null when the click is
 * outside every face of the variant (in which case the caller must not
 * modify any pixel).
 */
export function computeCubeFaceFill(texture, variant, point, options = {}) {
  const rect = getFaceRectAtPoint(variant, point);

  if (!rect) {
    return null;
  }

  return {
    rect,
    points: computeFaceFill(texture, point, rect, options),
  };
}
