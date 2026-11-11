import { BaseEntry } from "../base_entry.js";

class ReorderLayersEntry extends BaseEntry {
  constructor(layers, fromIndex, toIndex) {
    super();

    this.layers = layers;
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }

  onPerform() {
    this.layers.reorderLayers(this.fromIndex, this.toIndex);
  }

  onRevert() {
    this.layers.reorderLayers(this.toIndex, this.fromIndex);
  }
}

export default ReorderLayersEntry;