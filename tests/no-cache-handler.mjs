// Data Cache handler that stores nothing. The degradation test server uses
// it (via NEXT_NO_DATA_CACHE) so the GitHub stub's scenario switches take
// effect on every request instead of serving stale cached fetches.
export default class NoCacheHandler {
  async get() {
    return null;
  }

  async set() {}

  async revalidateTag() {}

  async resetRequestCache() {}
}
