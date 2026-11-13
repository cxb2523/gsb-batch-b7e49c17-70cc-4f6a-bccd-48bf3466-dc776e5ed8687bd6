import { vi } from 'vitest'

/**
 * Lightweight in-memory stand-ins for the three.js classes used by the store.
 * Every resource-releasing call (dispose), DOM attachment and event listener
 * is recorded so tests can assert on the scene's full lifecycle.
 */

export class MockObject3D {
  constructor() {
    this.position = {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      }
    }
    this.rotation = {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      }
    }
    this.quaternion = {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
      set(x, y, z, w) {
        this.x = x
        this.y = y
        this.z = z
        this.w = w
      },
      identity() {
        this.x = 0
        this.y = 0
        this.z = 0
        this.w = 1
      }
    }
    this.up = {
      x: 0,
      y: 1,
      z: 0,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      }
    }
    this.children = []
    this.parent = null
    this.matrixAutoUpdate = true
    this.geometry = null
    this.material = null
  }

  add(...objects) {
    objects.forEach((object) => {
      this.children.push(object)
      object.parent = this
    })
  }

  remove(...objects) {
    objects.forEach((object) => {
      const index = this.children.indexOf(object)
      if (index !== -1) {
        this.children.splice(index, 1)
        object.parent = null
      }
    })
  }

  traverse(callback) {
    callback(this)
    this.children.slice().forEach((child) => child.traverse(callback))
  }

  updateMatrix() {}
}

export class MockScene extends MockObject3D {
  constructor() {
    super()
    this.background = null
    this.fog = null
  }
}

export class MockPerspectiveCamera extends MockObject3D {
  constructor(fov, aspect, near, far) {
    super()
    this.fov = fov
    this.aspect = aspect
    this.near = near
    this.far = far
    this.projectionUpdated = 0
  }

  updateProjectionMatrix() {
    this.projectionUpdated += 1
  }
}

export class MockWebGLRenderer {
  static instances = []
  static reset() {
    MockWebGLRenderer.instances = []
  }

  constructor(options = {}) {
    this.options = options
    this.setSize = vi.fn()
    this.setPixelRatio = vi.fn()
    this.render = vi.fn()
    this.dispose = vi.fn()
    this.domElement = document.createElement('canvas')
    // Tag the canvas so tests can tell renderer instances apart.
    this.domElement.dataset.rendererId = String(
      MockWebGLRenderer.instances.length
    )
    MockWebGLRenderer.instances.push(this)
  }
}

export class MockTrackballControls extends MockObject3D {
  static instances = []
  static reset() {
    MockTrackballControls.instances = []
  }

  constructor(camera, domElement) {
    super()
    this.camera = camera
    this.domElement = domElement
    this.target = new MockObject3D().position
    this.update = vi.fn()
    this.handleResize = vi.fn()
    this.dispose = vi.fn()
    this.listeners = {}
    MockTrackballControls.instances.push(this)
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(handler)
  }

  removeEventListener(type, handler) {
    if (!this.listeners[type]) {
      return
    }
    this.listeners[type] = this.listeners[type].filter(
      (registered) => registered !== handler
    )
  }

  dispatchEvent(type) {
    ;(this.listeners[type] || []).forEach((handler) => handler())
  }
}

export class MockDisposable {
  constructor() {
    this.dispose = vi.fn()
  }
}

export class MockColor {
  constructor(value) {
    this.value = value
  }
}

export class MockFogExp2 {
  constructor(color, density) {
    this.color = color
    this.density = density
  }
}

export class MockVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
}

export class MockBufferGeometry extends MockDisposable {
  constructor() {
    super()
    this.attributes = {}
  }

  setFromPoints(points) {
    this.points = points
  }
}

export class MockLine extends MockObject3D {
  constructor(geometry, material) {
    super()
    this.geometry = geometry
    this.material = material
  }
}

export class MockMesh extends MockObject3D {
  constructor(geometry, material) {
    super()
    this.geometry = geometry
    this.material = material
  }
}

export class MockLight extends MockObject3D {}

/**
 * Install the three.js / TrackballControls mocks into the module registry.
 * Call at the top of every test file that (transitively) imports the store.
 */
export function installThreeMocks() {
  vi.mock('three', () => ({
    Scene: MockScene,
    PerspectiveCamera: MockPerspectiveCamera,
    WebGLRenderer: MockWebGLRenderer,
    Color: MockColor,
    FogExp2: MockFogExp2,
    CylinderGeometry: MockBufferGeometry,
    MeshPhongMaterial: MockDisposable,
    Mesh: MockMesh,
    DirectionalLight: MockLight,
    AmbientLight: MockLight,
    LineBasicMaterial: MockDisposable,
    BufferGeometry: MockBufferGeometry,
    Vector3: MockVector3,
    Line: MockLine,
    Float32BufferAttribute: class MockFloat32BufferAttribute {}
  }))

  vi.mock('three/addons/controls/TrackballControls.js', () => ({
    TrackballControls: MockTrackballControls
  }))
}
