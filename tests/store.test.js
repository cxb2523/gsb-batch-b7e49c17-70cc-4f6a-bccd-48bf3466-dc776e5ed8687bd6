import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  installThreeMocks,
  MockWebGLRenderer,
  MockTrackballControls
} from './helpers/three-mock.js'
import { mockAnimationFrame } from './helpers/animation-frame.js'

installThreeMocks()

// Import after the mocks are installed.
const { useThreeStore } = await import('../src/store.js')

function makeContainer() {
  const el = document.createElement('div')
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
  el.dataset.width = '800'
  el.dataset.height = '600'
  document.body.appendChild(el)
  return el
}

describe('three store', () => {
  let frames

  beforeEach(() => {
    setActivePinia(createPinia())
    MockWebGLRenderer.reset()
    MockTrackballControls.reset()
    frames = mockAnimationFrame()
  })

  describe('repeated mount / init lifecycle', () => {
    it('creates 500 pyramids and 3 axis lines on first init', async () => {
      const store = useThreeStore()
      const el = makeContainer()

      await store.init({ width: 800, height: 600, el })

      expect(store.pyramids).toHaveLength(500)
      expect(store.axisLines).toHaveLength(3)
      expect(el.querySelectorAll('canvas')).toHaveLength(1)
    })

    it('resets pyramids and axisLines so repeated init does not double them', async () => {
      const store = useThreeStore()
      const el = makeContainer()

      await store.init({ width: 800, height: 600, el })
      expect(store.pyramids).toHaveLength(500)
      expect(store.axisLines).toHaveLength(3)

      // Simulate leaving and re-entering the page: dispose, then init again.
      store.dispose()
      await store.init({ width: 800, height: 600, el })

      expect(store.pyramids).toHaveLength(500)
      expect(store.axisLines).toHaveLength(3)
    })

    it('disposes the renderer and controls and removes the canvas on cleanup', async () => {
      const store = useThreeStore()
      const el = makeContainer()

      await store.init({ width: 800, height: 600, el })
      const renderer = store.renderer
      const controls = store.controls
      store.animate()
      expect(frames.pendingCount()).toBe(1)

      store.dispose()

      expect(controls.dispose).toHaveBeenCalledTimes(1)
      expect(renderer.dispose).toHaveBeenCalledTimes(1)
      expect(el.querySelectorAll('canvas')).toHaveLength(0)
      expect(store.renderer).toBeNull()
      expect(store.controls).toBeNull()
      expect(store.scene).toBeNull()
      expect(store.camera).toBeNull()
      expect(store.pyramids).toEqual([])
      expect(store.axisLines).toEqual([])
      // The animation loop is stopped and its frame cancelled.
      expect(frames.caf).toHaveBeenCalled()
      expect(store.isAnimating).toBe(false)
    })

    it('stops the requestAnimationFrame loop and cancels its frame', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      store.animate()
      frames.flushFrames(2)
      expect(frames.raf).toHaveBeenCalledTimes(3) // initial + 2 reschedules

      const frameIdAtStop = store.animationFrameId
      store.stopAnimation()
      expect(frames.caf).toHaveBeenCalledWith(frameIdAtStop)
      expect(store.animationFrameId).toBeNull()
      const callsAfterStop = frames.raf.mock.calls.length
      frames.flushFrames(1)
      expect(frames.raf.mock.calls.length).toBe(callsAfterStop)
    })

    it('never runs two parallel animation loops', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      store.animate()
      store.animate()
      store.animate()
      expect(frames.raf).toHaveBeenCalledTimes(1)
    })

    it('a second init without dispose tears down the previous instance first', async () => {
      const store = useThreeStore()
      const el = makeContainer()

      await store.init({ width: 800, height: 600, el })
      const firstRenderer = store.renderer
      expect(MockWebGLRenderer.instances).toHaveLength(1)

      await store.init({ width: 400, height: 300, el })

      expect(firstRenderer.dispose).toHaveBeenCalledTimes(1)
      expect(MockWebGLRenderer.instances).toHaveLength(2)
      // Only the new renderer's canvas stays in the container.
      expect(el.querySelectorAll('canvas')).toHaveLength(1)
      expect(store.renderer).not.toBe(firstRenderer)
      expect(store.pyramids).toHaveLength(500)
    })

    it('releases shared geometries and materials via scene traversal', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      const scene = store.scene
      const disposableResources = []
      scene.traverse((object) => {
        if (object.geometry) disposableResources.push(object.geometry)
        if (object.material) disposableResources.push(object.material)
      })
      expect(disposableResources.length).toBeGreaterThan(0)

      store.dispose()

      const unique = new Set(disposableResources)
      unique.forEach((resource) => {
        expect(resource.dispose).toHaveBeenCalled()
      })
    })
  })

  describe('zero-size resize handling', () => {
    it('skips camera/renderer updates when width or height is zero', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      const aspectBefore = store.camera.aspect
      const projectionUpdatesBefore = store.camera.projectionUpdated
      const setSizeCallsBefore = store.renderer.setSize.mock.calls.length
      const handleResizeCallsBefore = store.controls.handleResize.mock.calls.length
      const renderCallsBefore = store.renderer.render.mock.calls.length

      store.resize({ width: 0, height: 600 })
      store.resize({ width: 800, height: 0 })
      store.resize({ width: 0, height: 0 })

      expect(store.camera.aspect).toBe(aspectBefore)
      expect(store.camera.projectionUpdated).toBe(projectionUpdatesBefore)
      expect(store.renderer.setSize.mock.calls.length).toBe(setSizeCallsBefore)
      expect(store.controls.handleResize.mock.calls.length).toBe(handleResizeCallsBefore)
      expect(store.renderer.render.mock.calls.length).toBe(renderCallsBefore)
      // No NaN/Infinity leaked into the camera state.
      expect(Number.isNaN(store.camera.aspect)).toBe(false)
      expect(Number.isFinite(store.camera.aspect)).toBe(true)
    })

    it('recovers a correct aspect ratio after a non-zero resize', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      // Container hidden, then shown at a different size.
      store.resize({ width: 0, height: 0 })
      expect(store.camera.aspect).toBe(800 / 600)

      store.resize({ width: 1024, height: 768 })

      expect(store.width).toBe(1024)
      expect(store.height).toBe(768)
      expect(store.camera.aspect).toBe(1024 / 768)
      expect(Number.isFinite(store.camera.aspect)).toBe(true)
      expect(store.camera.updateProjectionMatrix).toBeTruthy()
      expect(store.renderer.setSize).toHaveBeenCalledWith(1024, 768)
      expect(store.controls.handleResize).toHaveBeenCalledTimes(1)
    })

    it('falls back to aspect 1 instead of NaN when mounted at zero size', async () => {
      const store = useThreeStore()
      const el = makeContainer()

      await store.init({ width: 0, height: 0, el })

      expect(Number.isFinite(store.camera.aspect)).toBe(true)
      expect(store.camera.aspect).toBe(1)

      store.resize({ width: 400, height: 200 })
      expect(store.camera.aspect).toBe(2)
    })
  })

  describe('hide / show consistency', () => {
    it('removes pyramids from the scene and flips the visibility flag', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      expect(store.pyramidsVisible).toBe(true)
      store.hidePyramids()

      expect(store.pyramidsVisible).toBe(false)
      const pyramidSet = new Set(store.pyramids)
      store.scene.children.forEach((child) => {
        expect(pyramidSet.has(child)).toBe(false)
      })

      store.showPyramids()
      expect(store.pyramidsVisible).toBe(true)
      store.pyramids.forEach((pyramid) => {
        expect(store.scene.children).toContain(pyramid)
      })
    })

    it('removes axis lines from the scene and flips the visibility flag', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      expect(store.axisLinesVisible).toBe(true)
      store.hideAxisLines()

      expect(store.axisLinesVisible).toBe(false)
      store.axisLines.forEach((line) => {
        expect(store.scene.children).not.toContain(line)
      })

      store.showAxisLines()
      expect(store.axisLinesVisible).toBe(true)
      store.axisLines.forEach((line) => {
        expect(store.scene.children).toContain(line)
      })
    })

    it('repeated hide/show calls never desync the flag from scene membership', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      for (let i = 0; i < 3; i++) {
        store.hidePyramids()
        expect(store.pyramidsVisible).toBe(false)
        store.pyramids.forEach((pyramid) => {
          expect(store.scene.children).not.toContain(pyramid)
        })

        store.showPyramids()
        expect(store.pyramidsVisible).toBe(true)
        store.pyramids.forEach((pyramid) => {
          expect(store.scene.children).toContain(pyramid)
        })
      }
    })

    it('resets visibility flags to visible on every fresh init', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      store.hidePyramids()
      store.hideAxisLines()
      expect(store.pyramidsVisible).toBe(false)
      expect(store.axisLinesVisible).toBe(false)

      store.dispose()
      await store.init({ width: 800, height: 600, el })

      expect(store.pyramidsVisible).toBe(true)
      expect(store.axisLinesVisible).toBe(true)
      store.pyramids.forEach((pyramid) => {
        expect(store.scene.children).toContain(pyramid)
      })
    })
  })

  describe('reset camera', () => {
    it('restores position (0,0,500), zero rotation, origin target and panel state', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      // Move the camera and target away from the defaults.
      store.camera.position.set(123, -45, 789)
      store.camera.rotation.set(0.5, 0.2, 0.9)
      store.controls.target.set(10, 20, 30)
      store.syncCameraPosition()
      expect(store.cameraPosition).toEqual({ x: 123, y: -45, z: 789 })

      store.resetCamera()

      expect(store.camera.position).toMatchObject({ x: 0, y: 0, z: 500 })
      expect(store.camera.rotation).toMatchObject({ x: 0, y: 0, z: 0 })
      expect(store.camera.quaternion).toMatchObject({ x: 0, y: 0, z: 0, w: 1 })
      expect(store.controls.target).toMatchObject({ x: 0, y: 0, z: 0 })
      // Panel-facing state updates synchronously, no animation frame needed.
      expect(store.cameraPosition).toEqual({ x: 0, y: 0, z: 500 })
      expect(store.controls.update).toHaveBeenCalled()
      expect(store.renderer.render).toHaveBeenCalled()
    })
  })

  describe('animation loop camera sync', () => {
    it('updates the reactive camera position from inside the rAF loop', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      store.animate()
      store.camera.position.set(12.3456, -7.891, 500)
      frames.flushFrames(1)

      expect(store.cameraPosition).toEqual({
        x: 12.35,
        y: -7.89,
        z: 500
      })

      store.dispose()
    })

    it('does not schedule further frames after dispose mid-loop', async () => {
      const store = useThreeStore()
      const el = makeContainer()
      await store.init({ width: 800, height: 600, el })

      store.animate()
      store.dispose()
      const callsAtDispose = frames.raf.mock.calls.length
      frames.flushFrames(1)
      expect(frames.raf.mock.calls.length).toBe(callsAtDispose)
      expect(store.isAnimating).toBe(false)
    })
  })
})
