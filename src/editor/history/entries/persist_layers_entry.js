import { BaseEntry } from "../base_entry.js";

// This class simply persists any changes made to layers over the course of this history event.
// Intended to be used with a GroupedEntry or on its own.
class PersistLayerChangesEntry extends BaseEntry {
  constructor(persistence, layers) {
    super();

    this.persistence = persistence;
    this.layers = layers;
  }

  onPerform() {
    this.persist();

    return true;
  }

  onRevert() {
    this.persist();

    return true;
  }

  persist() {
    this.persistence.set("layers", this.layers.serializeLayers());
  }
}

export default PersistLayerChangesEntry;