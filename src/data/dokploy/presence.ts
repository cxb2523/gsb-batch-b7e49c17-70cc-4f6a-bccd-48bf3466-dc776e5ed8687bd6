/**
 * Presence tracking for the container nodes a compose service is split into.
 *
 * A container can briefly drop out of Dokploy's listing without being gone for good:
 *  - it restarts and `docker ps` momentarily omits it
 *  - a Swarm task gets a new name (`app.1.<new task id>`; the task id is stripped below)
 *  - one sampled `docker ps` response simply misses it
 *
 * Removing the node on the first such miss would make it reappear with a fresh identity:
 * selection, CPU history and network rate would be lost, and the activity feed would cry
 * "new node". So a key is only forgotten after CONTAINER_GRACE_SAMPLES consecutive samples
 * without it. Between the miss and the eviction the node stays in place, showing its last
 * metrics with an `idle` status (the collector adds an `error` override when the service
 * itself is in error).
 */

/** Node id of one container of a service; main containers keep the bare service id (see collector). */
export const containerNodeId = (serviceId: string, key: string) => `${serviceId}::${key}`;

/** A node whose id encodes a per-container key (as opposed to a service's own node id). */
export const isContainerNodeId = (id: string) => id.includes('::');

/** Swarm tasks are named `app.1.<task id>`; drop the task id so the node survives redeploys. */
export const containerKey = (name: string) => name.replace(/^(.+\.\d+)\.[a-z0-9]{10,}$/, '$1');

/**
 * How many *consecutive* container-list samples a key may be missing before its node is
 * removed. One miss is a sampling hiccup; two misses (i.e. absent on sample N, still absent
 * on N+1) already cover a normal restart window, so anything longer counts as really gone.
 * The list is sampled every 6th collector tick (30 s at a 5 s tick), see Collector.tick.
 */
export const CONTAINER_GRACE_SAMPLES = 2;

type State = {
  /** Number of consecutive samples that did not list this key; 0 while present. */
  misses: number;
};

/**
 * Container keys of one service, in a stable order, with grace-period bookkeeping.
 * `observe()` is called once per fetched container-list sample; `keys()` is what the
 * collector turns into nodes.
 */
export class ServiceContainers {
  private readonly byKey = new Map<string, State>();

  /**
   * Fold one observed sample in. Keys present in `presentKeys` reset their miss counter
   * (and new keys are appended at the end, so an earlier key never shifts position);
   * keys missing from the sample accumulate misses and are evicted after
   * CONTAINER_GRACE_SAMPLES in a row. Eviction closes the gap in the ordering.
   * Returns the keys evicted by this sample (empty unless the grace window ran out),
   * so the collector can release their retained metrics and history.
   */
  observe(presentKeys: readonly string[]): string[] {
    const seen = new Set(presentKeys);
    const evicted: string[] = [];
    for (const key of presentKeys) {
      const state = this.byKey.get(key);
      if (state) state.misses = 0;
      else this.byKey.set(key, { misses: 0 });
    }
    for (const [key, state] of this.byKey) {
      if (seen.has(key)) continue;
      if (++state.misses > CONTAINER_GRACE_SAMPLES) {
        this.byKey.delete(key);
        evicted.push(key);
      }
    }
    return evicted;
  }

  /** Keys in stable order; a key inside the grace window is still included. */
  keys(): string[] {
    return [...this.byKey.keys()];
  }

  /** Keys that were missing from the latest sample but survive within the grace window. */
  absentKeys(): string[] {
    return [...this.byKey].filter(([, s]) => s.misses > 0).map(([key]) => key);
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get size(): number {
    return this.byKey.size;
  }
}

/** Per-service presence trackers, keyed by Dokploy service id. */
export class ContainerPresence {
  private readonly services = new Map<string, ServiceContainers>();

  /** Fetch the (lazily created) tracker for one service. */
  for(serviceId: string): ServiceContainers {
    let sc = this.services.get(serviceId);
    if (!sc) {
      sc = new ServiceContainers();
      this.services.set(serviceId, sc);
    }
    return sc;
  }

  get(serviceId: string): ServiceContainers | undefined {
    return this.services.get(serviceId);
  }

  /** Drop trackers for services that no longer exist in the Dokploy structure. */
  prune(knownServiceIds: ReadonlySet<string>): void {
    for (const id of this.services.keys()) if (!knownServiceIds.has(id)) this.services.delete(id);
  }
}
