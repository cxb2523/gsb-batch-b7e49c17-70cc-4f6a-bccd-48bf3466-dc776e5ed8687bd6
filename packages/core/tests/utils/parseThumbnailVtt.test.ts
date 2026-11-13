import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findThumbnailCue,
  parseThumbnailVtt,
  parseVttText,
  parseXywh,
} from '../../src/utils/parseThumbnailVtt'

// Self-contained, locally crafted VTT sample. It deliberately interleaves
// broken entries (malformed xywh, missing image line, NOTE/caption content)
// with valid cues to prove one bad cue never shifts the rest of the index.
const SAMPLE_VTT = `WEBVTT

NOTE
This is a note block and must not be parsed as thumbnails.

00:00:00.000 --> 00:00:10.000
thumbs/frame-0.jpg#xywh=0,0,160,90

00:00:10.000 --> 00:00:20.000
thumbs/frame-1.jpg#xywh=bad,0,160,90

00:00:20.000 --> 00:00:30.000
thumbs/frame-2.jpg#xywh=160,0

00:00:30.000 --> 00:00:40.000
thumbs/frame-3.jpg#xywh=0,0,160,Infinity

00:00:40.000 --> 00:00:50.000
thumbs/frame-4.jpg

00:00:50.000 --> 00:01:00.000

00:01:00.000 --> 00:01:10.000
thumbs/frame-5.jpg#xywh=320,90,160,90

1
00:01:10.000 --> 00:01:20.000
thumbs/frame-6.jpg#xywh=480,90,160,90

NOTE captions mixed into the index below

00:01:20 --> 00:01:30
This is caption text, not a thumbnail.

00:01:30.000 --> 00:01:40.000
thumbs/frame-7.jpg#xywh=0,180,160,90
`

describe('parseXywh', () => {
  it('parses a well-formed xywh fragment', () => {
    expect(parseXywh('xywh=0,0,160,90')).toEqual([0, 0, 160, 90])
    expect(parseXywh('xywh=320,90,160,90')).toEqual([320, 90, 160, 90])
  })

  it('returns null when there are fewer or more than four components', () => {
    expect(parseXywh('xywh=160,0')).toBeNull()
    expect(parseXywh('xywh=0,0,160')).toBeNull()
    expect(parseXywh('xywh=0,0,160,90,10')).toBeNull()
  })

  it('returns null when any component is not a finite number', () => {
    expect(parseXywh('xywh=bad,0,160,90')).toBeNull()
    expect(parseXywh('xywh=0,,160,90')).toBeNull()
    expect(parseXywh('xywh=0,0,160,NaN')).toBeNull()
    expect(parseXywh('xywh=0,0,160,Infinity')).toBeNull()
    expect(parseXywh('xywh=0,0,160,-Infinity')).toBeNull()
  })

  it('returns null for non-xywh fragments', () => {
    expect(parseXywh('t=0,10')).toBeNull()
    expect(parseXywh('')).toBeNull()
  })
})

describe('parseVttText', () => {
  const cues = parseVttText(SAMPLE_VTT, 'https://cdn.example.com/thumbnails/index.vtt')

  it('parses every valid cue despite broken entries around them', () => {
    // frame-0, frame-1..4 (bad xywh/missing line handling), frame-5/6/7
    // = 8 thumbnail cues; the empty cue and the caption cue are excluded.
    expect(cues).toHaveLength(8)
    expect(cues.map((c) => c.url)).toEqual([
      'https://cdn.example.com/thumbnails/thumbs/frame-0.jpg',
      'https://cdn.example.com/thumbnails/thumbs/frame-1.jpg',
      'https://cdn.example.com/thumbnails/thumbs/frame-2.jpg',
      'https://cdn.example.com/thumbnails/thumbs/frame-3.jpg',
      'https://cdn.example.com/thumbnails/thumbs/frame-4.jpg',
      'https://cdn.example.com/thumbnails/thumbs/frame-5.jpg',
      'https://cdn.example.com/thumbnails/thumbs/frame-6.jpg',
      'https://cdn.example.com/thumbnails/thumbs/frame-7.jpg',
    ])
  })

  it('keeps valid sprite coordinates on healthy cues', () => {
    expect(cues[0]).toMatchObject({ start: 0, end: 10, x: 0, y: 0, w: 160, h: 90 })
    expect(cues[5]).toMatchObject({ start: 60, end: 70, x: 320, y: 90, w: 160, h: 90 })
    expect(cues[7]).toMatchObject({ start: 90, end: 100, x: 0, y: 180, w: 160, h: 90 })
  })

  it('degrades a bad xywh cue to a full-image cue without partial coordinates', () => {
    const badToken = cues[1]
    expect(badToken.url).toContain('frame-1.jpg')
    expect(badToken.x).toBeUndefined()
    expect(badToken.y).toBeUndefined()
    expect(badToken.w).toBeUndefined()
    expect(badToken.h).toBeUndefined()

    // too few components
    const tooFew = cues[2]
    expect(tooFew.url).toContain('frame-2.jpg')
    expect(tooFew.x).toBeUndefined()

    // non-finite component
    const infinite = cues[3]
    expect(infinite.url).toContain('frame-3.jpg')
    expect(infinite.h).toBeUndefined()
  })

  it('keeps cues whose image line has no fragment at all as full-image cues', () => {
    const plain = cues[4]
    expect(plain.url).toContain('frame-4.jpg')
    expect(plain).toMatchObject({ start: 40, end: 50 })
    expect(plain.x).toBeUndefined()
  })

  it('skips a cue with no image line but still parses every later valid cue', () => {
    // The 50–60 cue had an empty payload; frame-5 (60–70) must survive.
    expect(cues.some((c) => c.start === 50 && c.end === 60)).toBe(false)
    expect(cues[5]).toMatchObject({ start: 60, end: 70 })
  })

  it('ignores cue identifiers, NOTE blocks and non-thumbnail caption cues', () => {
    // Cue identifier "1" must not become an extra entry.
    expect(cues.filter((c) => c.url.includes('frame-6'))).toHaveLength(1)
    // The 80–90 caption payload is not an image.
    expect(cues.some((c) => c.start === 80 && c.end === 90)).toBe(false)
    // The last cue after the caption block still parses.
    expect(cues[7]).toMatchObject({ start: 90, end: 100 })
  })

  it('resolves relative image paths against the VTT URL (existing behaviour)', () => {
    const resolved = parseVttText(
      'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nassets/a.jpg#xywh=1,2,3,4\n',
      'https://host.test/path/index.vtt',
    )
    expect(resolved[0].url).toBe('https://host.test/path/assets/a.jpg')

    const absolute = parseVttText(
      'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nhttps://cdn.test/x.jpg\n',
      'https://host.test/index.vtt',
    )
    expect(absolute[0].url).toBe('https://cdn.test/x.jpg')
  })

  it('parses timestamps that omit milliseconds (existing behaviour)', () => {
    const noMs = parseVttText('WEBVTT\n\n00:01:20 --> 00:01:30\nthumbs/f.jpg\n')
    expect(noMs[0]).toMatchObject({ start: 80, end: 90 })
  })

  it('parses mm:ss timestamps as well as hh:mm:ss', () => {
    const short = parseVttText('WEBVTT\n\n01:00 --> 02:00\nthumbs/f.jpg\n')
    expect(short[0]).toMatchObject({ start: 60, end: 120 })
  })

  it('accepts image URLs carrying query strings before the fragment', () => {
    const withQuery = parseVttText(
      'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n' + 'thumbs/a.jpg?token=abc#xywh=1,2,3,4\n',
      'https://host.test/index.vtt',
    )
    expect(withQuery).toHaveLength(1)
    expect(withQuery[0].url).toBe('https://host.test/thumbs/a.jpg?token=abc')
    expect(withQuery[0]).toMatchObject({ x: 1, y: 2, w: 3, h: 4 })
  })

  it('handles CRLF line endings', () => {
    const crlf = parseVttText(
      'WEBVTT\r\n\r\n00:00:00.000 --> 00:00:05.000\r\nthumbs/a.jpg#xywh=0,0,10,10\r\n',
    )
    expect(crlf).toHaveLength(1)
    expect(crlf[0]).toMatchObject({ x: 0, y: 0, w: 10, h: 10 })
  })

  it('does not misalign when blank lines are missing between cues', () => {
    const packed = parseVttText(
      'WEBVTT\n' +
        '00:00:00.000 --> 00:00:05.000\nthumbs/a.jpg#xywh=x,0,10,10\n' +
        '00:00:05.000 --> 00:00:10.000\nthumbs/b.jpg#xywh=0,0,10,10\n',
    )
    expect(packed).toHaveLength(2)
    expect(packed[0].url).toContain('a.jpg')
    expect(packed[0].x).toBeUndefined()
    expect(packed[1].url).toContain('b.jpg')
    expect(packed[1]).toMatchObject({ x: 0, y: 0, w: 10, h: 10 })
  })

  it('returns an empty list for header-only or empty input', () => {
    expect(parseVttText('WEBVTT\n')).toEqual([])
    expect(parseVttText('')).toEqual([])
  })
})

describe('findThumbnailCue (half-open interval matching)', () => {
  const cues = parseVttText(SAMPLE_VTT)

  it('selects a cue at its start boundary', () => {
    expect(findThumbnailCue(cues, 0)?.url).toContain('frame-0.jpg')
    expect(findThumbnailCue(cues, 10)?.url).toContain('frame-1.jpg')
    expect(findThumbnailCue(cues, 60)?.url).toContain('frame-5.jpg')
  })

  it('assigns the end boundary to the next cue', () => {
    // 10 is frame-1's start, not frame-0 anymore.
    expect(findThumbnailCue(cues, 10)?.url).not.toContain('frame-0.jpg')
    // 70 belongs to frame-6 (70–80), never to frame-5 (60–70).
    expect(findThumbnailCue(cues, 70)?.url).toContain('frame-6.jpg')
    expect(findThumbnailCue(cues, 70)?.url).not.toContain('frame-5.jpg')
  })

  it('matches times strictly inside an interval', () => {
    expect(findThumbnailCue(cues, 9.999)?.url).toContain('frame-0.jpg')
    expect(findThumbnailCue(cues, 65.5)?.url).toContain('frame-5.jpg')
  })

  it('returns null outside all intervals', () => {
    expect(findThumbnailCue(cues, -1)).toBeNull()
    expect(findThumbnailCue(cues, 100)).toBeNull()
    expect(findThumbnailCue(cues, 55)).toBeNull() // skipped 50–60 cue
    expect(findThumbnailCue([] as ReturnType<typeof parseVttText>, 5)).toBeNull()
  })
})

describe('parseThumbnailVtt (fetch level)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves cues from a fetched VTT document', async () => {
    const body = 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nthumbs/a.jpg#xywh=0,0,10,10\n'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )

    const cues = await parseThumbnailVtt('https://cdn.example.com/index.vtt')
    expect(cues).toHaveLength(1)
    expect(cues[0].url).toBe('https://cdn.example.com/thumbs/a.jpg')
    expect(cues[0]).toMatchObject({ x: 0, y: 0, w: 10, h: 10 })
  })

  it('returns [] without throwing on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    )

    await expect(parseThumbnailVtt('https://cdn.example.com/missing.vtt')).resolves.toEqual([])
  })

  it('returns [] without throwing when the index file cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    )

    await expect(parseThumbnailVtt('https://cdn.example.com/missing.vtt')).resolves.toEqual([])
  })
})
