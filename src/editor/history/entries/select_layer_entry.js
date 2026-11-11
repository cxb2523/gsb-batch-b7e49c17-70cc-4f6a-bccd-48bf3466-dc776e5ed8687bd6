import { BaseEntry } from "../base_entry.js";

class SelectLayerEntry extends BaseEntry {
  constructor(layers, params = {}) {
    super();
    
    this.layers = layers;
    this.layer = params.layer;
    this.index = params.index;
  }
  oldLayerIndex;
  stacking = true;

  onPerform() {
    this.oldLayerIndex = this.layers.selectedLayerIndex;
    
    if (this.index != undefined) {
      this._selectLayer(this.index);
    } else {
      this._selectLayer(this.layers.layerIndex(this.layer));
    }
  }

  onStack(entry) {
    if (entry.index != undefined) {
      this._selectLayer(entry.index);
    } else {
      this._selectLayer(this.layers.layerIndex(entry.layer));
    }
  }

  onRevert() {
    this.layers.selectLayer(this.oldLayerIndex);
  }

  _selectLayer(index) {    
    this.layers.selectLayer(index);
  }
}

export default SelectLayerEntry;