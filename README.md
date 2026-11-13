# vue-threejs-demo

This is a Proof-Of-Concept integration of Vue.js and Three.js. I have converted the Three.js [Trackball Control Example](https://threejs.org/examples/?q=cont#misc_controls_trackball) to a Vue/Vuex application and added some additional UI sugar on top.

[See the demo here](https://vue-threejs-demo.pages.dev/)

## Stack

- **Vue 3** - Progressive JavaScript framework
- **Vite** - Fast build tool and dev server
- **Pinia** - State management for Vue 3
- **Three.js** - 3D graphics library
- **Vue Router 4** - Official router for Vue 3

## Project Setup

Install dependencies:
```bash
npm install
```

### Development Server

Run the development server with hot module replacement:
```bash
npm run dev
```

### Production Build

Build the application for production:
```bash
npm run build
```

### Preview Production Build

Preview the production build locally:
```bash
npm run preview
```

### Tests

The test suite uses [Vitest](https://vitest.dev/) +
[Vue Test Utils](https://test-utils.vuejs.org/) and runs in `jsdom` with an
in-memory Three.js mock (`tests/helpers/three-mock.js`), so no browser or
WebGL context is required.

Run all tests once:
```bash
npm test
```

Run them in watch mode while developing:
```bash
npm run test:watch
```

Covered paths:

- **Repeated mount / lifecycle** — mounting `ViewPort` twice never stacks
  canvases or doubles the 500 pyramids / 3 axis lines; unmounting removes the
  resize listener, cancels the `requestAnimationFrame` loop, disposes the
  renderer and `TrackballControls`, releases geometries/materials and empties
  the container. Unmounting before the async `init()` resolves is also covered.
- **Zero-size resize** — resizing to a width or height of `0` (hidden
  container) skips the camera aspect/projection update so no `NaN` or
  division-by-zero can occur; the next non-zero resize restores the correct
  aspect ratio. Mounting directly at `0 x 0` falls back to aspect `1`.
- **Hide / show consistency** — toggling pyramids or axis lines keeps the
  checkbox state (store visibility flags, rendered via `:checked`) and actual
  scene membership in sync in both directions, including repeated toggles and
  re-initialization.
- **Reset Camera** — restores camera position `(0, 0, 500)`, zero rotation,
  origin `controls.target`, and updates the panel's displayed coordinates
  synchronously.

### Linting

Run ESLint to check code quality:
```bash
npm run lint
```

## Helpful Links

- [Three.js Documentation](https://threejs.org/docs/)
- [Vue 3 Documentation](https://vuejs.org/)
- [Pinia Documentation](https://pinia.vuejs.org/)
- [Vite Documentation](https://vitejs.dev/)
