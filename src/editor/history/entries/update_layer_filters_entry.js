import { BaseEntry } from "../base_entry.js";

class UpdateLayerFiltersEntry extends BaseEntry {
  constructor(layers, layer, filters = [], stack = true) {
    super();

    this.layers = layers;
    this.layer = layer;
    this.filters = filters;
    this.stacking = stack;
  }
  oldFilters;

  onPerform() {
    this.oldFilters = this.oldFilters || this.layer.compositor.getFilters();
    this.layer.compositor.applyFilters(this.filters);
  }

  onStack(entry) {
    this.filters = entry.filters;
    this.onPerform();
  }

  onRevert() {
    this.layer.compositor.applyFilters(this.oldFilters);
  }
}

export default UpdateLayerFiltersEntry;