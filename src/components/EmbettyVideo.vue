<template>
  <div :style="width === null ? `` : `width: ${width}px`" class="embetty-video">
    <div
      v-if="activated"
      class="wrapper"
      :class="{ 'default-height': height === null }"
      :style="height === null ? `` : `height: ${height}px`"
      v-html="iframe" />
    <template v-else>
      <button
        type="button"
        class="playbutton"
        :class="{ 'is-waiting': activating || (posterImageUrl && !posterLoaded) }"
        :disabled="!!error || activating"
        @click="activate">
        <svg
          v-if="!activating"
          xmlns="http://www.w3.org/2000/svg"
          width="72"
          height="72"
          viewBox="0 0 48 48"
          fill="#fff">
          <path d="M24 4C12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20S35.05 4 24 4zm-4 29V15l12 9-12 9z" />
        </svg>
        <span
          v-else
          class="loading-indicator"
          role="status"
          aria-live="polite">Loading…</span>
      </button>
      <div
        v-if="error"
        class="error-message"
        role="alert">
        <p>The video data could not be loaded.</p>
        <button type="button" class="retry-button" @click="retry">
          Retry
        </button>
      </div>
      <div
        :class="{
          'poster': true,
          'default-height': height === null,
          'contain': posterImageMode === 'contain',
          'is-loading': posterImageUrl && !posterLoaded
        }"
        :style="[
          posterLoaded && posterImageUrl ? { backgroundImage: `url(${posterImageUrl})` } : {},
          height === null ? {} : { height: `${height}px` }
        ]" />
      <a
        href="https://www.heise.de/embetty"
        target="_blank"
        rel="noopener"
        class="powered-by"
        title="embetty - displaying remote content without compromising your privacy.">
        powered by <span class="embetty-logo" v-html="embettyLogo" />
      </a>
    </template>
  </div>
</template>

<script>
import EmbettyEmbed from './EmbettyEmbed.vue';
import { numberProp, oneOfProp, oneOfTypesProp, stringProp } from 'vue-ts-types';

import { videoImplementations } from './video-impl/index';

export default {
  name: 'EmbettyVideo',
  extends: EmbettyEmbed,
  props: {
    width: numberProp().nullable,
    height: numberProp().nullable,
    type: stringProp((videoType) => {
      if (videoType in videoImplementations) {
        return undefined;
      }

      return `Expected one of: ${Object.keys(videoImplementations).join(', ')}`;
    }).required,
    videoId: stringProp((videoId) => {
      if (/^[a-zA-Z0-9_-]{6,}$/.test(videoId) || videoId.startsWith('http')) {
        return undefined;
      }

      return 'Expected a valid video ID';
    }).required,
    /** The number of seconds (or a string in the format `XXhXXmXXs`) to start playback after. */
    startAt: oneOfTypesProp([Number, String], (startAt) => {
      if (typeof startAt === 'number') {
        if (startAt % 1 === 0 && startAt >= 0) {
          return undefined;
        }

        return 'Expected a non-negative integer';
      }

      if (/^(?:(?:\d+h)?\d+m)?\d+s?$/.test(startAt)) {
        return undefined;
      }

      return 'Expected a valid time string';
    }).withDefault(0),
    posterImageMode: oneOfProp(['cover', 'contain']).nullable
  },
  emits: ['activated'],
  /**
   * @returns {!object} The component's data.
   */
  data() {
    return {
      activated: false,
      /** Whether the poster image of the current source has finished loading. */
      posterLoaded: false,
      /** Whether the user clicked play and the component is waiting for required data. */
      activating: false
    };
  },
  computed: {
    /**
     * @returns {!VideoImpl} The video implementation, based on the video type.
     * @throws {!Error} If there is no video implementation for the given type.
     */
    impl() {
      if (!(this.type in videoImplementations)) {
        throw new Error(`Could not find video implementation for type ${this.type}. Please specify a valid video type.`);
      }

      return videoImplementations[this.type];
    },

    /**
     * @returns {!string} The embetty-server URL for the video poster image.
     */
    posterImageUrl() {
      return this._api(this.impl.getPosterImageApiEndpoint(this.videoId));
    },

    /**
     * @returns {!string} The poster image mode.
     */
    _posterImageMode() {
      return this.posterImageMode || this._embettyVueOptions.posterImageMode || 'cover';
    },

    /**
     * @returns {!number} The number of seconds the video should start at.
     */
    _startAt() {
      if (typeof this.startAt === 'number') {
        return this.startAt;
      }

      const timeRegex = /^(?:(?:(\d+)h)?(\d+)m)?(\d+)s?$/;
      const timeMatch = this.startAt.match(timeRegex);

      if (timeMatch) {
        // '1m16s'    -> timeMatch = ['1m16s',    undefined, '1', '16']
        // '1h23m45s' -> timeMatch = ['1h23m45s', '1',       '2', '34']
        const timeNumbers = timeMatch.map(val => val === undefined ? 0 : parseInt(val));

        const hours = timeNumbers[1];
        const minutes = timeNumbers[2];
        const seconds = timeNumbers[3];

        return (hours * 3600) + (minutes * 60) + seconds;
      }

      return 0;
    },

    /**
     * @returns {!boolean} Whether this video type requires additional data from
     *                     the embetty-server before its iframe can be built.
     */
    _requiresData() {
      return !!this.impl.getVideoDataApiEndpoint(this.videoId);
    },

    /**
     * @override
     * @returns {?string} The embetty-server URL to fetch video data from, or undefined
     *                    if this video does not require additional data.
     */
    url() {
      return this._api(this.impl.getVideoDataApiEndpoint(this.videoId));
    },

    /**
     * @returns {!string} The HTML for the <iframe> this component renders upon activating.
     */
    iframe() {
      // Guard against building an iframe with missing data (e.g. a Facebook
      // video whose metadata has not been fetched yet), which would otherwise
      // produce URLs containing "undefined".
      if (this._requiresData && !this.fetched) {
        return '';
      }

      return this.impl.getIframe({
        width: this.width || 1600,
        height: this.height || 900,
        videoId: this.videoId,
        startAt: this._startAt,
        serverData: this.data
      });
    }
  },
  watch: {
    /**
     * A different video type means a different implementation; drop every piece
     * of state belonging to the previous source (poster, data, activation).
     */
    type() {
      this._resetForSourceChange();
    },

    /**
     * A different video ID means a different source; drop every piece of state
     * belonging to the previous source (poster, data, activation).
     */
    videoId() {
      this._resetForSourceChange();
    },

    /**
     * Preloads the poster image whenever its URL changes. The image is only
     * shown once it has fully loaded, so an old poster can never remain visible
     * while the new one is still loading. A token discards out-of-order loads.
     */
    posterImageUrl: {
      immediate: true,
      handler(url) {
        this._loadPoster(url);
      }
    },

    /**
     * Once a pending activation gets its required data, continue activation.
     * (The matching error case is handled by the `error` watcher.)
     */
    fetched(fetched) {
      if (fetched) {
        this._continueActivation();
      }
    },

    error(error) {
      if (this.activating && error) {
        // the request failed while the user was waiting to activate;
        // leave the component inactive and surface the error state
        this.activating = false;
      }
    }
  },
  /**
   * Initializes the internal poster counter used to discard stale poster loads.
   * Runs before the immediate `posterImageUrl` watcher so the counter exists.
   */
  beforeCreate() {
    this._posterToken = 0;
  },
  methods: {
    /**
     * Preloads the given poster image URL and only reveals it once loaded. The
     * previous poster is hidden immediately (`posterLoaded = false`), and a
     * per-request token ensures an out-of-order, older load can never reveal a
     * stale poster for the current source.
     * @param {?string} url The poster image URL to preload, or undefined.
     */
    _loadPoster(url) {
      const token = ++this._posterToken;
      this.posterLoaded = false;

      // skip loading in SSR or when this type has no poster image (e.g. native)
      if (typeof window === 'undefined' || !url) {
        return;
      }

      const image = new window.Image();
      image.onload = () => {
        if (token === this._posterToken) {
          this.posterLoaded = true;
        }
      };
      image.onerror = () => {
        // keep the placeholder visible; a stale/erroring poster is never shown
        if (token === this._posterToken) {
          this.posterLoaded = false;
        }
      };
      image.src = url;
    },

    /**
     * Resets all state that belongs to a previously displayed source so that an
     * old poster, old metadata or an activated iframe can never bleed into the
     * newly selected type / video ID.
     */
    _resetForSourceChange() {
      this.activated = false;
      this.activating = false;
      this.posterLoaded = false;
    },

    /**
     * Completes a previously requested activation once the data it was waiting
     * for is available. No-op unless activation is pending and the required
     * data has actually arrived, so it can never build an iframe from
     * `undefined` server data.
     */
    _continueActivation() {
      if (!this.activating || !this.fetched) {
        return;
      }

      this.activated = true;
      this.activating = false;
      this.$emit('activated');
    },

    /**
     * Activates the video, i.e. replaces the poster image and play button with
     * the iframe. If this type needs server data that has not arrived yet (or
     * failed to load), the component stays inactive and shows a loading or
     * error state instead of an iframe built from `undefined` data.
     */
    activate() {
      if (this.error || this.activated || this.activating) {
        return;
      }

      if (this._requiresData && !this.fetched) {
        // stay inactive; the `fetched`/`error` watchers continue from here
        this.activating = true;
        return;
      }

      this.activated = true;
      this.$emit('activated');
    },

    /**
     * Clears the error state and retries the data request and poster load.
     */
    retry() {
      this.error = null;
      this.fetched = false;
      this.data = undefined;
      this.fetchData();
      this._loadPoster(this.posterImageUrl);
    }
  }
};
</script>

<style lang="scss">
@import '../assets/element.scss';

.embetty-video {
  @include host();

  .poster, .wrapper {
    position: relative;
    overflow: hidden;
    background: no-repeat center black;
    background-size: cover;

    &.contain {
      background-size: contain;
    }

    &.default-height {
      height: 0;
      padding-top: 56.25%; // percentage values in padding refer to width; creates a 16:9 ratio
    }
  }

  .playbutton,
  .playbutton:active {
    box-sizing: border-box;
    display: block;
    position: absolute;
    z-index: 1;
    width: 100%;
    height: 100%;
    border: 0;
    padding: 0;
    outline: 0;
    opacity: 0.9;
    background: none;
    cursor: pointer;
    background-image: linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.8));
    transition: opacity 150ms;

    &:hover,
    &:focus {
      opacity: 1;
    }

    &.is-waiting,
    &:disabled {
      cursor: wait;
    }
  }

  .loading-indicator {
    display: inline-block;
    padding: .5em 1em;
    border-radius: .4em;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    font-size: 18px;
  }

  .error-message {
    box-sizing: border-box;
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .75em;
    padding: 1em;
    text-align: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.75);

    p {
      margin: 0;
      font-size: 16px;
    }

    .retry-button {
      padding: .5em 1.2em;
      border: 1px solid #fff;
      border-radius: .3em;
      color: #fff;
      background: transparent;
      cursor: pointer;
      font-size: 14px;

      &:hover,
      &:focus {
        color: #000;
        background: #fff;
      }
    }
  }

  .poster.is-loading {
    background-color: #000;
  }

  .powered-by {
    @include powered-by();

    -webkit-font-smoothing: antialiased;

    color: #fff;
    opacity: .6;
  }

  iframe,
  video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}
</style>
