import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import {
  installThreeMocks,
  MockWebGLRenderer,
  MockTrackballControls
} from './helpers/three-mock.js'
import ControlPanel from '@/components/ControlPanel.vue'
import { useThreeStore } from '@/store'

installThreeMocks()

function makeContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('ControlPanel component', () => {
  let store

  beforeEach(async () => {
    setActivePinia(createPinia())
    MockWebGLRenderer.reset()
    MockTrackballControls.reset()
    store = useThreeStore()
    await store.init({ width: 800, height: 600, el: makeContainer() })
  })

  it('renders checkboxes matching the store visibility flags', () => {
    const wrapper = mount(ControlPanel)

    const pyramidsBox = wrapper.find('input[name="pyramids"]').element
    const axisBox = wrapper.find('input[name="axis-lines"]').element

    expect(pyramidsBox.checked).toBe(true)
    expect(axisBox.checked).toBe(true)
  })

  it('unchecking pyramids hides them while checkbox state stays consistent', async () => {
    const wrapper = mount(ControlPanel)
    const box = wrapper.find('input[name="pyramids"]')

    expect(store.pyramidsVisible).toBe(true)
    await box.setValue(false)

    expect(store.pyramidsVisible).toBe(false)
    expect(box.element.checked).toBe(false)
    // Scene really no longer contains any pyramid.
    store.pyramids.forEach((pyramid) => {
      expect(store.scene.children).not.toContain(pyramid)
    })

    await box.setValue(true)
    expect(store.pyramidsVisible).toBe(true)
    expect(box.element.checked).toBe(true)
    store.pyramids.forEach((pyramid) => {
      expect(store.scene.children).toContain(pyramid)
    })
  })

  it('unchecking axis lines hides them while checkbox state stays consistent', async () => {
    const wrapper = mount(ControlPanel)
    const box = wrapper.find('input[name="axis-lines"]')

    await box.setValue(false)

    expect(store.axisLinesVisible).toBe(false)
    expect(box.element.checked).toBe(false)
    store.axisLines.forEach((line) => {
      expect(store.scene.children).not.toContain(line)
    })

    await box.setValue(true)
    expect(store.axisLinesVisible).toBe(true)
    expect(box.element.checked).toBe(true)
    store.axisLines.forEach((line) => {
      expect(store.scene.children).toContain(line)
    })
  })

  it('reflects store-driven visibility changes immediately in the checkbox', async () => {
    const wrapper = mount(ControlPanel)
    const box = wrapper.find('input[name="pyramids"]')

    store.hidePyramids()
    await nextTick()
    expect(box.element.checked).toBe(false)

    store.showPyramids()
    await nextTick()
    expect(box.element.checked).toBe(true)
  })

  it('Reset Camera restores defaults and updates the displayed coordinates immediately', async () => {
    const wrapper = mount(ControlPanel)

    store.camera.position.set(300, 200, 900)
    store.controls.target.set(5, 6, 7)
    store.syncCameraPosition()

    await wrapper.find('button').trigger('click')

    expect(store.camera.position).toMatchObject({ x: 0, y: 0, z: 500 })
    expect(store.camera.rotation).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(store.controls.target).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(store.cameraPosition).toEqual({ x: 0, y: 0, z: 500 })

    const text = wrapper.text()
    expect(text).toContain('X:0')
    expect(text).toContain('Y:0')
    expect(text).toContain('Z:500')
  })
})
