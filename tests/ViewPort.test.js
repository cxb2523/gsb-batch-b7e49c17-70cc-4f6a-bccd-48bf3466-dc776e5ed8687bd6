import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import {
  installThreeMocks,
  MockWebGLRenderer
} from './helpers/three-mock.js'
import { mockAnimationFrame } from './helpers/animation-frame.js'
import ViewPort from '@/components/ViewPort.vue'
import { useThreeStore } from '@/store'

installThreeMocks()

function mountViewPort(pinia) {
  const wrapper = mount(ViewPort, {
    attachTo: document.body,
    global: {
      plugins: [pinia]
    }
  })

  // Make the container dimensions controllable so resize behavior can be
  // exercised without a real browser layout engine.
  const el = wrapper.element
  el.dataset.width = '800'
  el.dataset.height = '600'
  Object.defineProperty(el, 'offsetWidth', {
    configurable: true,
    get() {
      return Number(el.dataset.width || 0)
    }
  })
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    get() {
      return Number(el.dataset.height || 0)
    }
  })

  return wrapper
}

function dispatchWindowResize() {
  window.dispatchEvent(new Event('resize'))
}

describe('ViewPort component', () => {
  let pinia
  let frames

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    MockWebGLRenderer.reset()
    frames = mockAnimationFrame()
    document.body.innerHTML = ''
  })

  it('mounts a canvas, starts the render loop and listens for resize', async () => {
    const store = useThreeStore()
    const resizeSpy = vi.spyOn(store, 'resize')
    const wrapper = mountViewPort(pinia)
    await flushPromises()

    expect(wrapper.element.querySelectorAll('canvas')).toHaveLength(1)
    expect(store.isAnimating).toBe(true)
    expect(frames.raf).toHaveBeenCalled()

    dispatchWindowResize()
    expect(resizeSpy).toHaveBeenCalledWith({ width: 800, height: 600 })

    wrapper.unmount()
  })

  it('removes the canvas, cancels rAF and removes the resize listener on unmount', async () => {
    const store = useThreeStore()
    const resizeSpy = vi.spyOn(store, 'resize')
    const disposeSpy = vi.spyOn(store, 'dispose')
    const wrapper = mountViewPort(pinia)
    await flushPromises()

    wrapper.unmount()

    expect(disposeSpy).toHaveBeenCalled()
    expect(store.isAnimating).toBe(false)
    expect(frames.caf).toHaveBeenCalled()
    // Canvas is gone both through renderer disposal and innerHTML clearing.
    expect(wrapper.element.querySelectorAll('canvas')).toHaveLength(0)

    const callsBefore = resizeSpy.mock.calls.length
    dispatchWindowResize()
    expect(resizeSpy.mock.calls.length).toBe(callsBefore)
  })

  it('can be mounted repeatedly without stacking canvases or scene objects', async () => {
    const store = useThreeStore()

    const first = mountViewPort(pinia)
    await flushPromises()
    expect(first.element.querySelectorAll('canvas')).toHaveLength(1)
    expect(store.pyramids).toHaveLength(500)
    expect(store.axisLines).toHaveLength(3)
    first.unmount()
    expect(first.element.querySelectorAll('canvas')).toHaveLength(0)

    const second = mountViewPort(pinia)
    await flushPromises()
    expect(second.element.querySelectorAll('canvas')).toHaveLength(1)
    expect(store.pyramids).toHaveLength(500)
    expect(store.axisLines).toHaveLength(3)
    expect(MockWebGLRenderer.instances).toHaveLength(2)
    // The first renderer was disposed when its instance was replaced by the
    // second mount; the second one is still live until its own unmount below.
    expect(MockWebGLRenderer.instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(MockWebGLRenderer.instances[1].dispose).not.toHaveBeenCalled()
    second.unmount()
    expect(MockWebGLRenderer.instances[1].dispose).toHaveBeenCalledTimes(1)
  })

  it('passes zero container dimensions through without producing NaN state', async () => {
    const store = useThreeStore()
    const wrapper = mountViewPort(pinia)
    await flushPromises()

    // Container is hidden: both dimensions read as 0.
    wrapper.element.dataset.width = '0'
    wrapper.element.dataset.height = '0'
    expect(() => dispatchWindowResize()).not.toThrow()
    expect(Number.isFinite(store.camera.aspect)).toBe(true)

    // Container becomes visible again: projection recovers.
    wrapper.element.dataset.width = '1024'
    wrapper.element.dataset.height = '768'
    dispatchWindowResize()
    expect(store.camera.aspect).toBe(1024 / 768)
    expect(store.renderer.setSize).toHaveBeenCalledWith(1024, 768)

    wrapper.unmount()
  })

  it('cleans up safely when unmounted before the async init resolves', async () => {
    const store = useThreeStore()
    const wrapper = mountViewPort(pinia)
    // Unmount immediately, before the init() promise continuation runs.
    wrapper.unmount()
    await flushPromises()

    expect(store.renderer).toBeNull()
    expect(store.controls).toBeNull()
    expect(store.isAnimating).toBe(false)
    expect(document.body.querySelectorAll('canvas')).toHaveLength(0)

    // No resize listener survived either.
    expect(() => dispatchWindowResize()).not.toThrow()
  })
})
