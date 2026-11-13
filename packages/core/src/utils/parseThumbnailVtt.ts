import type { ThumbnailCue } from '../types/thumbnail'
import { parseTimecode } from './time'

function resolveUrl(base: string, url: string): string {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

/**
 * Parse the value of a "#xywh=x,y,w,h" fragment.
 *
 * Returns the four numeric components only when the fragment is well-formed
 * (exactly four finite numbers). Any other shape — too few/too many
 * components, empty components, NaN/Infinity — yields null, which callers
 * must treat as a full-image preview (no coordinates) rather than dropping
 * the cue.
 */
export function parseXywh(fragment: string): [number, number, number, number] | null {
  if (!fragment.startsWith('xywh=')) return null

  const parts = fragment.slice('xywh='.length).split(',')
  if (parts.length !== 4) return null
  if (parts.some((part) => part.trim() === '')) return null

  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return null

  return [nums[0], nums[1], nums[2], nums[3]]
}

const IMAGE_EXT_RE = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#]|$)/i

function isImageLine(line: string): boolean {
  return IMAGE_EXT_RE.test(line)
}

/**
 * A timing line must contain " --> " with a parseable timecode on both sides.
 * Plain caption text that happens to include "-->" without surrounding
 * spaces (or with broken timestamps) is therefore never mistaken for a cue.
 */
function isTimingLine(line: string): boolean {
  const arrowIdx = line.indexOf('-->')
  if (arrowIdx <= 0) return false

  const start = line.slice(0, arrowIdx).trim()
  const rest = line
    .slice(arrowIdx + 3)
    .trim()
    .split(/\s+/)[0]
  if (!start || !rest) return false

  return [start, rest].every((tc) => Number.isFinite(parseTimecode(tc)))
}

/**
 * Find the thumbnail cue covering `time` using half-open intervals:
 * a cue matches when `start <= time < end`. A time equal to a cue's end
 * therefore belongs to the next cue.
 */
export function findThumbnailCue(cues: ThumbnailCue[], time: number): ThumbnailCue | null {
  return cues.find((cue) => time >= cue.start && time < cue.end) ?? null
}

export async function parseThumbnailVtt(url: string): Promise<ThumbnailCue[]> {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const text = await res.text()
    return parseVttText(text, url)
  } catch {
    // Network failure, DNS error, missing file, etc. — no preview data,
    // but the player keeps working and the tooltip simply hides thumbnails.
    return []
  }
}

export function parseVttText(text: string, baseUrl = ''): ThumbnailCue[] {
  const cues: ThumbnailCue[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    // Blank lines, the WEBVTT header, NOTE blocks, cue identifiers and any
    // other non-thumbnail content are skipped until a real timing line.
    if (!line || !line.includes('-->') || !isTimingLine(line)) {
      i++
      continue
    }

    // ── Valid timing line: parse this cue in isolation ──
    const arrowIdx = line.indexOf('-->')
    const start = parseTimecode(line.slice(0, arrowIdx).trim())
    const endToken = line
      .slice(arrowIdx + 3)
      .trim()
      .split(/\s+/)[0]
    const end = parseTimecode(endToken)
    i++

    // The payload is everything up to the next blank line or the next
    // timing line, so a broken cue can never consume a later valid one.
    const payload: string[] = []
    while (i < lines.length) {
      const next = lines[i].trim()
      if (!next) break
      if (next.includes('-->') && isTimingLine(next)) break
      payload.push(next)
      i++
    }

    // A thumbnail cue needs an image line. Cues whose payload is plain
    // text (captions, chapter titles) or whose image line is missing are
    // skipped on their own.
    const imgLine = payload[0]
    if (!imgLine || !isImageLine(imgLine)) continue

    const hashIdx = imgLine.lastIndexOf('#')
    const rawUrl = hashIdx !== -1 ? imgLine.slice(0, hashIdx) : imgLine
    const fragment = hashIdx !== -1 ? imgLine.slice(hashIdx + 1) : ''

    if (!rawUrl) continue

    const cue: ThumbnailCue = { start, end, url: resolveUrl(baseUrl, rawUrl) }

    // Bad xywh → full-image preview. The cue is kept, but no partial
    // coordinate set is ever written onto it.
    const xywh = parseXywh(fragment)
    if (xywh) {
      ;[cue.x, cue.y, cue.w, cue.h] = xywh
    }

    cues.push(cue)
  }

  return cues
}
