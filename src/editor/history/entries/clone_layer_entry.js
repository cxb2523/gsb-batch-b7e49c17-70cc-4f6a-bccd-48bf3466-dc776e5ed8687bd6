import { BaseEntry } from "../base_entry.js";

class CloneLayerEntry extends BaseEntry {
  constructor(layers, layer) {
    super();

    this.layers = layers;
    this.layer = layer;
  }
  clonedLayer;

  onPerform() {
    this.clonedLayer = this.clonedLayer || this.layers.createFromLayer(this.layer);

    const idx = this.layers.layerIndex(this.layer);
    this.layers.insertLayer(this.clonedLayer, idx + 1);
    this.layers.selectLayer(this.layers.layerIndex(this.clonedLayer));
  }

  onRevert() {
    this.layers.removeLayer(this.clonedLayer);
    this.layers.selectLayer(this.layers.layerIndex(this.layer));
  }
}

export default CloneLayerEntry;