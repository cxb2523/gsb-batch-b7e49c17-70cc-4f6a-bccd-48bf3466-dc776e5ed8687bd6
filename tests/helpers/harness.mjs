// Test harness: loads the real .vue components through Vite (so the actual
// templates, watchers and lifecycle run) and mounts them with Vue 2.7's server
// renderer. Network access is replaced by controllable in-memory mocks for
// `window.fetch` and `window.Image`, allowing precise simulation of failures
// and out-of-order responses without any real HTTP server or browser.
import { createServer } from 'vite';
import Vue from 'vue/dist/vue.common.dev.js';
import { createRenderer } from 'vue-server-renderer';

export const SERVER_URL = 'http://embetty-server.test';

/**
 * A controllable fetch mock. Routes are matched by substring of the request URL.
 * Each route value is either a static response descriptor or a function
 * (requestUrl) => descriptor | Promise<descriptor>.
 */
export class MockFetch {
  constructor() {
    this.routes = [];
    this.calls = [];
    this.impl = this.impl.bind(this);
  }

  /**
   * @param {string} urlPart Substring that the request URL must contain.
   * @param {object|function} descriptor A response-like object, or a function.
   * @returns {MockFetch} This instance for chaining.
   */
  route(urlPart, descriptor) {
    this.routes.push({ urlPart, descriptor });
    return this;
  }

  /** Removes all registered routes and recorded calls. */
  reset() {
    this.routes = [];
    this.calls = [];
  }

  async impl(url) {
    this.calls.push(url);
    const match = this.routes.find((route) => url.includes(route.urlPart));

    if (!match) {
      throw new Error(`No mock route registered for URL: ${url}`);
    }

    const descriptor = typeof match.descriptor === 'function'
      ? await match.descriptor(url)
      : match.descriptor;

    if (descriptor.throwError) {
      throw descriptor.throwError;
    }

    return {
      ok: descriptor.ok ?? (descriptor.status >= 200 && descriptor.status < 300),
      status: descriptor.status ?? 200,
      json: async () => {
        if (descriptor.invalidJson) {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        }

        return descriptor.body;
      }
    };
  }
}

/**
 * A controllable Image mock. `resolve(url)` fires `onload` for a pending image
 * pointing at that URL; `reject(url)` fires `onerror` instead.
 */
export class MockImage {
  static pending = [];

  constructor() {
    this.onload = null;
    this.onerror = null;
    this._src = '';
  }

  set src(value) {
    this._src = value;
    MockImage.pending.push(this);
  }

  get src() {
    return this._src;
  }

  /** Fires `onload` on the most recent pending image whose src matches. */
  static resolve(urlPart) {
    const image = [...MockImage.pending].reverse().find((candidate) =>
      candidate.src.includes(urlPart)
    );

    if (!image) {
      throw new Error(`No pending image for URL part: ${urlPart}`);
    }

    image.onload?.();
    return image;
  }

  /** Fires `onerror` on the most recent pending image whose src matches. */
  static reject(urlPart) {
    const image = [...MockImage.pending].reverse().find((candidate) =>
      candidate.src.includes(urlPart)
    );

    if (!image) {
      throw new Error(`No pending image for URL part: ${urlPart}`);
    }

    image.onerror?.(new Error(`Failed to load image: ${image.src}`));
    return image;
  }

  static reset() {
    MockImage.pending = [];
  }
}

let viteServer;

/**
 * Starts the Vite SSR server used to compile and load the components.
 * @returns {Promise<object>} The loaded component module map.
 */
export async function loadComponents() {
  viteServer = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    ssr: { noExternal: ['vue-ts-types'] }
  });

  const [videoModule, embedModule, tweetModule] = await Promise.all([
    viteServer.ssrLoadModule('/src/components/EmbettyVideo.vue'),
    viteServer.ssrLoadModule('/src/components/EmbettyEmbed.vue'),
    viteServer.ssrLoadModule('/src/components/EmbettyTweet.vue')
  ]);

  return {
    EmbettyVideo: videoModule.default,
    EmbettyEmbed: embedModule.default,
    EmbettyTweet: tweetModule.default
  };
}

export async function closeVite() {
  await viteServer?.close();
}

/**
 * Installs the given mocks on the global `window` object (the components guard
 * all network access with `typeof window === 'undefined'`).
 */
export function installWindowMocks(fetchMock) {
  globalThis.window = {
    fetch: fetchMock.impl,
    Image: MockImage
  };
}

/** Flushes pending microtasks a few times so awaited fetch chains settle. */
export async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/**
 * Mounts an EmbettyVideo inside a reactive wrapper so that changing the
 * wrapper's `props` object triggers the component's prop watchers exactly as a
 * parent re-render would in a real app.
 *
 * The SFC is compiled by Vite for SSR, which renders via `renderToString`
 * rather than a real DOM; Vue's reactivity, computed properties, watchers and
 * lifecycle hooks all run normally, so component logic is fully exercised.
 * @param {object} EmbettyVideo The component constructor/options.
 * @param {object} initialProps Initial prop values.
 * @returns {object} { wrapper, video, setProps, render }
 */
export function mountVideo(EmbettyVideo, initialProps) {
  Vue.prototype._embettyVueOptions = { serverUrl: SERVER_URL };
  Vue.config.silent = true;

  const wrapper = new Vue({
    data() {
      return { props: { ...initialProps } };
    },
    render(h) {
      return h(EmbettyVideo, { props: this.props });
    }
  });

  // An initial SSR render performs the full mount (data, watchers, lifecycle)
  // without requiring a browser DOM.
  const renderer = createRenderer();
  renderer.renderToString(wrapper);
  const video = wrapper.$children[0];

  return {
    wrapper,
    video,
    /**
     * Updates props directly on the child. SSR-mounted trees have no render
     * watcher that would push parent prop changes down, but the child's props
     * are themselves reactive, so assigning them fires its own watchers and
     * recomputes its computed properties exactly like a real prop update.
     * Watcher callbacks run by the time `nextTick` resolves; any network
     * response is kept pending by the tests until they explicitly flush.
     */
    async setProps(newProps) {
      Object.assign(video, newProps);
      await Vue.nextTick();
    },
    async render() {
      // Render the child directly: the parent wrapper's data never changes
      // (props are assigned straight onto the child), so a parent re-render
      // would reuse the cached child subtree. The child is itself a root from
      // the renderer's point of view and always reflects its current state.
      return renderer.renderToString(video);
    }
  };
}

/**
 * Mounts an arbitrary component inside a reactive wrapper and renders it via
 * SSR, returning the child instance for direct inspection.
 * @param {object} Component The component options/constructor.
 * @param {object} initialProps Initial prop values.
 * @returns {object} { wrapper, child, render }
 */
export function mountComponent(Component, initialProps) {
  Vue.prototype._embettyVueOptions = { serverUrl: SERVER_URL };
  Vue.config.silent = true;

  const wrapper = new Vue({
    data() {
      return { props: { ...initialProps } };
    },
    render(h) {
      return h(Component, { props: this.props });
    }
  });

  const renderer = createRenderer();
  renderer.renderToString(wrapper);

  return {
    wrapper,
    child: wrapper.$children[0],
    async render() {
      return renderer.renderToString(wrapper.$children[0]);
    }
  };
}

/**
 * Creates a deferred promise together with its resolve/reject controls, so
 * tests can decide exactly when a mocked request or image load completes.
 * @returns {{ promise: Promise, resolve: Function, reject: Function }}
 */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Tiny assertion helper that throws with a readable message on failure. */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
