<script>
import EMBETTY_LOGO from '../assets/embetty.svg?raw';
import { stringProp } from 'vue-ts-types';

export default {
  name: 'EmbettyEmbed',
  props: {
    serverUrl: stringProp().nullable
  },
  /**
   * @returns {!object} Component's data.
   */
  data() {
    return {
      embettyLogo: EMBETTY_LOGO,

      fetched: false,
      data: undefined,
      /** @type {?Error} Set when the data request fails (network error, non-2xx status or invalid JSON). */
      error: null
    };
  },
  computed: {
    /**
     * Override this in child components!
     * @returns {string | undefined} The URL to query for data in this component.
     */
    url() {
      return undefined;
    },

    /**
     * @returns {!string} The server URL, either from this component's prop or the global config.
     */
    _serverUrl() {
      if (this.serverUrl) {
        return this.serverUrl;
      }

      if (!this._embettyVueOptions.serverUrl) {
        throw new Error(`serverUrl is neither set directly on the ${this.$vnode.tag} component nor globally.`);
      }

      return this._embettyVueOptions.serverUrl;
    }
  },
  watch: {
    url: {
      immediate: true,
      /**
       * Re-fetches whenever the requested URL changes (or becomes empty). Any
       * data from a previous request is reset immediately, and responses that
       * resolve after a newer request was started are discarded.
       * @param {?string} url The newly set URL.
       */
      handler(url) {
        this.fetchData(url);
      }
    }
  },
  /**
   * Initializes the internal fetch counter used to discard stale responses.
   * Runs before the immediate `url` watcher so the counter always exists.
   */
  beforeCreate() {
    this._fetchToken = 0;
  },
  methods: {
    /**
     * Calls the API of embetty-server using the url set in the calling (child) component.
     *
     * Invalidates any previously fetched data up front so a changed source can
     * never leave stale data on display. A per-request token ensures that an
     * older, slow response can never overwrite the result of a newer request.
     * On network errors, non-2xx status codes or invalid JSON, `error` is set
     * (exposed to the template) and `data`/`fetched` are not treated as success.
     * @param {?string} [requestUrl] The URL to fetch; defaults to `this.url`.
     */
    async fetchData(requestUrl = this.url) {
      // skip fetching in SSR
      if (typeof window === 'undefined') {
        return;
      }

      // invalidate the previous request's state immediately
      const token = ++this._fetchToken;
      this.fetched = false;
      this.data = undefined;
      this.error = null;

      if (!requestUrl) {
        return;
      }

      try {
        const response = await window.fetch(requestUrl);

        if (!response.ok) {
          throw new Error(`Request to ${requestUrl} failed with status ${response.status}`);
        }

        const data = await response.json();

        // a newer request has superseded this one; discard its response
        if (token !== this._fetchToken) {
          return;
        }

        this.data = data;
        this.fetched = true;
      } catch (caughtError) {
        // a newer request has superseded this one; leave its state untouched
        if (token !== this._fetchToken) {
          return;
        }

        this.data = undefined;
        this.fetched = false;
        this.error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
      }
    },

    /**
     * @param {?string} apiEndpoint The API endpoint of the embetty-server.
     * @returns {?string} The given URL, prepended with the embetty-server base URL.
     */
    _api(apiEndpoint) {
      return apiEndpoint ? (this._serverUrl + apiEndpoint) : undefined;
    }
  }
};
</script>
