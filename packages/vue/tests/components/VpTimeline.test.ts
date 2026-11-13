// @vitest-environment happy-dom
import { parseVttText } from '@vue-player/core'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VpTimeline from '../../src/components/controls/VpTimeline.vue'

// Locally crafted thumbnail index: one broken-xywh cue and one
// missing-image cue sandwiched between healthy cues, plus adjacent
// cues sharing a boundary.
const VTT = `WEBVTT

00:00:00.000 --> 00:00:10.000
thumbs/a.jpg#xywh=0,0,160,90

00:00:10.000 --> 00:00:20.000
thumbs/b.jpg#xywh=broken

00:00:20.000 --> 00:00:30.000

00:00:30.000 --> 00:00:40.000
thumbs/c.jpg#xywh=320,90,160,90
`

const DURATION = 100

function mountTimeline(thumbnailCues?: ReturnType<typeof parseVttText>) {
  return mount(VpTimeline, {
    props: {
      currentTime: 0,
      duration: DURATION,
      buffered: 0,
      thumbnailCues,
    },
  })
}

// Hovering at clientX maps directly to a ratio because the stubbed
// track starts at 0 and is 1000px wide.
async function hoverAt(wrapper: ReturnType<typeof mountTimeline>, clientX: number) {
  await wrapper.find('.vp-timeline-track').trigger('mousemove', { clientX, clientY: 0 })
}

describe('vpTimeline thumbnail hover preview', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 10,
      width: 1000,
      height: 10,
      toJSON: () => ({}),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a sprite (background-position) for cues carrying xywh', async () => {
    const wrapper = mountTimeline(parseVttText(VTT, 'https://cdn.example.com/index.vtt'))

    await hoverAt(wrapper, 50) // 5s → cue 0–10

    const sprite = wrapper.find('.vp-thumbnail-sprite')
    expect(sprite.exists()).toBe(true)
    expect(sprite.attributes('style')).toContain('thumbs/a.jpg')
    expect(sprite.attributes('style')).toContain('background-position: 0px 0px')
    expect(sprite.attributes('style')).toContain('width: 160px')
    expect(sprite.attributes('style')).toContain('height: 90px')
    expect(wrapper.find('.vp-thumbnail-img').exists()).toBe(false)
  })

  it('falls back to a full-image <img> when the cue has bad xywh', async () => {
    const wrapper = mountTimeline(parseVttText(VTT, 'https://cdn.example.com/index.vtt'))

    await hoverAt(wrapper, 150) // 15s → cue 10–20 with "xywh=broken"

    expect(wrapper.find('.vp-thumbnail-sprite').exists()).toBe(false)
    const img = wrapper.find('.vp-thumbnail-img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('https://cdn.example.com/thumbs/b.jpg')
  })

  it('keeps matching later valid cues after a bad xywh cue and a missing-image cue', async () => {
    const wrapper = mountTimeline(parseVttText(VTT, 'https://cdn.example.com/index.vtt'))

    // 35s → the 30–40 cue; the skipped 20–30 entry must not shift it.
    await hoverAt(wrapper, 350)

    const sprite = wrapper.find('.vp-thumbnail-sprite')
    expect(sprite.exists()).toBe(true)
    expect(sprite.attributes('style')).toContain('thumbs/c.jpg')
    expect(sprite.attributes('style')).toContain('background-position: -320px -90px')
  })

  it('hits cues half-open: start inclusive, end belongs to the next cue', async () => {
    const wrapper = mountTimeline(parseVttText(VTT, 'https://cdn.example.com/index.vtt'))

    // t = 10 (start of the second cue) → b.jpg, not a.jpg
    await hoverAt(wrapper, 100)
    expect(wrapper.find('.vp-thumbnail-img').attributes('src')).toContain('b.jpg')
    expect(wrapper.find('.vp-thumbnail-sprite').exists()).toBe(false)

    // t = 30 (end of the skipped cue, start of the last cue) → c.jpg
    await hoverAt(wrapper, 300)
    expect(wrapper.find('.vp-thumbnail-sprite').attributes('style')).toContain('c.jpg')

    // t = 40 is past every cue → no thumbnail rendered, no error thrown
    await hoverAt(wrapper, 400)
    expect(wrapper.find('.vp-thumbnail-preview').exists()).toBe(false)
  })

  it('renders no thumbnail preview when cues are missing or the index failed to load', () => {
    // parseThumbnailVtt resolves to [] on 404/network failure — simulate
    // both the "prop omitted" and "empty array" shapes.
    const withoutProp = mountTimeline()
    expect(withoutProp.find('.vp-thumbnail-preview').exists()).toBe(false)

    const emptyIndex = mountTimeline([])
    expect(emptyIndex.find('.vp-thumbnail-preview').exists()).toBe(false)

    // The time tooltip itself still works.
    expect(withoutProp.find('.vp-timeline-tooltip').exists()).toBe(false) // only shown while hovering
  })

  it('still shows the time tooltip without throwing when hovering with an empty index', async () => {
    const wrapper = mountTimeline([])

    await expect(hoverAt(wrapper, 250)).resolves.toBeUndefined()
    expect(wrapper.find('.vp-thumbnail-preview').exists()).toBe(false)
    expect(wrapper.find('.vp-timeline-tooltip').exists()).toBe(true)
    expect(wrapper.text()).toContain('0:25')
  })
})
