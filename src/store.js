import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  FogExp2,
  CylinderGeometry,
  MeshPhongMaterial,
  Mesh,
  DirectionalLight,
  AmbientLight,
  LineBasicMaterial,
  BufferGeometry,
  Vector3,
  Line
} from 'three'
import { TrackballControls } from 'three/addons/controls/TrackballControls.js'

export const DEFAULT_CAMERA_POSITION = Object.freeze({ x: 0, y: 0, z: 500 })

export const useThreeStore = defineStore('three', {
  state: () => ({
    width: 0,
    height: 0,
    camera: null,
    controls: null,
    scene: null,
    renderer: null,
    axisLines: [],
    pyramids: [],
    // Visibility flags are the single source of truth for the
    // ControlPanel checkboxes, so they can never drift from the scene.
    axisLinesVisible: true,
    pyramidsVisible: true,
    cameraPosition: { ...DEFAULT_CAMERA_POSITION },
    // rAF bookkeeping so the render loop can be stopped deterministically.
    animationFrameId: null,
    isAnimating: false,
    // Whether this store instance currently owns live three.js objects.
    isDisposed: true
  }),

  getters: {
  },

  actions: {
    setViewportSize({ width, height }) {
      this.width = width
      this.height = height
    },

    initializeRenderer(el) {
      this.renderer = markRaw(new WebGLRenderer({ antialias: true }))
      this.renderer.setPixelRatio(window.devicePixelRatio)
      this.renderer.setSize(this.width, this.height)
      el.appendChild(this.renderer.domElement)
    },

    initializeCamera() {
      // Guard against a zero-height/width container at mount time:
      // fall back to aspect 1 instead of producing NaN / Infinity.
      const aspect = this.height > 0 ? this.width / this.height : 1
      this.camera = markRaw(new PerspectiveCamera(
        // 1. Field of View (degrees)
        60,
        // 2. Aspect ratio
        aspect,
        // 3. Near clipping plane
        1,
        // 4. Far clipping plane
        1000
      ))
      this.camera.position.set(
        DEFAULT_CAMERA_POSITION.x,
        DEFAULT_CAMERA_POSITION.y,
        DEFAULT_CAMERA_POSITION.z
      )
      this.syncCameraPosition()
    },

    initializeControls() {
      this.controls = markRaw(new TrackballControls(
        this.camera,
        this.renderer.domElement
      ))
      this.controls.rotateSpeed = 1.0
      this.controls.zoomSpeed = 1.2
      this.controls.panSpeed = 0.8
      this.controls.noZoom = false
      this.controls.noPan = false
      this.controls.staticMoving = true
      this.controls.dynamicDampingFactor = 0.3
      this.controls.keys = [65, 83, 68]
    },

    updateControls() {
      if (this.controls) {
        this.controls.update()
      }
    },

    initializeScene() {
      // Reset every collection before populating it. Without this, a second
      // init() would push another 500 meshes / 3 lines into the same arrays
      // and they would accumulate across re-mounts.
      this.pyramids = []
      this.axisLines = []
      this.pyramidsVisible = true
      this.axisLinesVisible = true

      this.scene = markRaw(new Scene())
      this.scene.background = new Color(0xcccccc)
      this.scene.fog = new FogExp2(0xcccccc, 0.002)

      var geometry = markRaw(new CylinderGeometry(0, 10, 30, 4, 1))
      var material = markRaw(new MeshPhongMaterial({
        color: 0xffffff,
        flatShading: true
      }))

      for (var i = 0; i < 500; i++) {
        var mesh = markRaw(new Mesh(geometry, material))
        mesh.position.x = (Math.random() - 0.5) * 1000
        mesh.position.y = (Math.random() - 0.5) * 1000
        mesh.position.z = (Math.random() - 0.5) * 1000
        mesh.updateMatrix()
        mesh.matrixAutoUpdate = false
        this.pyramids.push(mesh)
      }
      this.scene.add(...this.pyramids)

      // lights
      var lightA = markRaw(new DirectionalLight(0xffffff))
      lightA.position.set(1, 1, 1)
      this.scene.add(lightA)

      var lightB = markRaw(new DirectionalLight(0x002288))
      lightB.position.set(-1, -1, -1)
      this.scene.add(lightB)

      var lightC = markRaw(new AmbientLight(0x222222))
      this.scene.add(lightC)

      // Axis Line 1 (Y-axis - Blue)
      var materialB = markRaw(new LineBasicMaterial({ color: 0x0000ff }))
      var geometryB = markRaw(new BufferGeometry())
      const pointsB = [
        new Vector3(0, 0, 0),
        new Vector3(0, 1000, 0)
      ]
      geometryB.setFromPoints(pointsB)
      var lineA = markRaw(new Line(geometryB, materialB))
      this.axisLines.push(lineA)

      // Axis Line 2 (X-axis - Green)
      var materialC = markRaw(new LineBasicMaterial({ color: 0x00ff00 }))
      var geometryC = markRaw(new BufferGeometry())
      const pointsC = [
        new Vector3(0, 0, 0),
        new Vector3(1000, 0, 0)
      ]
      geometryC.setFromPoints(pointsC)
      var lineB = markRaw(new Line(geometryC, materialC))
      this.axisLines.push(lineB)

      // Axis Line 3 (Z-axis - Red)
      var materialD = markRaw(new LineBasicMaterial({ color: 0xff0000 }))
      var geometryD = markRaw(new BufferGeometry())
      const pointsD = [
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 1000)
      ]
      geometryD.setFromPoints(pointsD)
      var lineC = markRaw(new Line(geometryD, materialD))
      this.axisLines.push(lineC)

      this.scene.add(...this.axisLines)
    },

    resize({ width, height }) {
      if (!this.camera || !this.renderer || !this.controls) {
        return
      }
      // A hidden/collapsed container reports 0. Skip the update entirely:
      // width / height would be NaN or Infinity and corrupt the projection
      // matrix. The next non-zero resize restores a correct aspect ratio.
      if (width === 0 || height === 0) {
        return
      }

      this.width = width
      this.height = height
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(width, height)
      this.controls.handleResize()
      this.renderScene()
    },

    setCameraPosition({ x, y, z }) {
      if (this.camera) {
        this.camera.position.set(x, y, z)
        this.syncCameraPosition()
      }
    },

    resetCameraRotation() {
      if (this.camera) {
        this.camera.rotation.set(0, 0, 0)
        this.camera.quaternion.set(0, 0, 0, 1)
        this.camera.up.set(0, 1, 0)
        if (this.controls) {
          this.controls.target.set(0, 0, 0)
        }
      }
    },

    // Full camera reset used by the "Reset Camera" button: position back to
    // (0, 0, 500), rotation zeroed, controls target back to the origin, and
    // the panel-facing cameraPosition state is updated synchronously.
    resetCamera() {
      if (!this.camera) {
        return
      }

      this.camera.position.set(
        DEFAULT_CAMERA_POSITION.x,
        DEFAULT_CAMERA_POSITION.y,
        DEFAULT_CAMERA_POSITION.z
      )
      this.camera.rotation.set(0, 0, 0)
      this.camera.quaternion.identity()
      this.camera.up.set(0, 1, 0)

      if (this.controls) {
        this.controls.target.set(0, 0, 0)
        this.controls.update()
      }

      this.syncCameraPosition()
      this.renderScene()
    },

    syncCameraPosition() {
      if (!this.camera) {
        return
      }
      this.cameraPosition = {
        x: Math.round(this.camera.position.x * 100) / 100,
        y: Math.round(this.camera.position.y * 100) / 100,
        z: Math.round(this.camera.position.z * 100) / 100
      }
    },

    renderScene() {
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera)
      }
    },

    handleControlChange() {
      this.renderScene()
    },

    hideAxisLines() {
      this.axisLinesVisible = false
      if (this.scene && this.axisLines.length > 0) {
        this.scene.remove(...this.axisLines)
      }
      this.renderScene()
    },

    showAxisLines() {
      this.axisLinesVisible = true
      if (this.scene && this.axisLines.length > 0) {
        this.scene.add(...this.axisLines)
      }
      this.renderScene()
    },

    hidePyramids() {
      this.pyramidsVisible = false
      if (this.scene && this.pyramids.length > 0) {
        this.scene.remove(...this.pyramids)
      }
      this.renderScene()
    },

    showPyramids() {
      this.pyramidsVisible = true
      if (this.scene && this.pyramids.length > 0) {
        this.scene.add(...this.pyramids)
      }
      this.renderScene()
    },

    async init({ width, height, el }) {
      // Defensive cleanup: a repeated init() without an intervening dispose()
      // (e.g. fast route re-entry) must never stack renderers or scenes.
      if (!this.isDisposed) {
        this.dispose()
      }
      this.isDisposed = false

      this.setViewportSize({ width, height })
      this.initializeRenderer(el)
      this.initializeCamera()
      this.initializeControls()
      this.initializeScene()

      // Initial scene rendering
      this.renderScene()

      // Re-render whenever the controls change. Keep a stable handler
      // reference so it can be removed again in dispose().
      this.controls.addEventListener('change', this.handleControlChange)
    },

    animate() {
      // Guard against starting multiple parallel rAF loops.
      if (this.isAnimating) {
        return
      }
      this.isAnimating = true

      const loop = () => {
        if (!this.isAnimating) {
          return
        }
        this.animationFrameId = window.requestAnimationFrame(loop)
        if (this.controls) {
          this.controls.update()
        }
        this.syncCameraPosition()
      }

      this.animationFrameId = window.requestAnimationFrame(loop)
    },

    stopAnimation() {
      this.isAnimating = false
      if (this.animationFrameId !== null) {
        window.cancelAnimationFrame(this.animationFrameId)
        this.animationFrameId = null
      }
    },

    // Tear down everything init()/animate() created. Safe to call more than
    // once and safe to call while the init() promise is still in flight.
    dispose() {
      this.stopAnimation()

      if (this.controls) {
        this.controls.removeEventListener('change', this.handleControlChange)
        this.controls.dispose()
        this.controls = null
      }

      if (this.scene) {
        this.disposeSceneResources(this.scene)
        this.scene = null
      }

      if (this.renderer) {
        const domElement = this.renderer.domElement
        if (domElement && domElement.parentNode) {
          domElement.parentNode.removeChild(domElement)
        }
        this.renderer.dispose()
        this.renderer = null
      }

      this.camera = null
      this.pyramids = []
      this.axisLines = []
      this.animationFrameId = null
      this.cameraPosition = { ...DEFAULT_CAMERA_POSITION }
      this.isDisposed = true
    },

    disposeSceneResources(scene) {
      const geometries = new Set()
      const materials = new Set()

      scene.traverse((object) => {
        if (object.geometry) {
          geometries.add(object.geometry)
        }
        if (object.material) {
          const materialsForObject = Array.isArray(object.material)
            ? object.material
            : [object.material]
          materialsForObject.forEach((material) => materials.add(material))
        }
      })

      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
    }
  }
})
