import { BaseEntry } from "../base_entry.js";
import ReplaceLayerMetadataEntry from "./replace_layer_metadata_entry.js";

class UpdateLayerAttributionEntry extends BaseEntry {
  constructor(layer) {
    super();

    this.layer = layer;
  }
  metadataEntry;

  onPerform() {
    this.metadataEntry = this.metadataEntry || this._createMetadataEntry();

    return this.metadataEntry.perform();
  }

  onRevert() {
    return this.metadataEntry.revert();
  }

  _createMetadataEntry() {
    let metadata = {...this.layer.metadata};
    const attribution = this.layer.readAttributionData();

    if (attribution) {
      metadata.attribution = attribution;
    }

    return new ReplaceLayerMetadataEntry(this.layer, metadata);
  }
}

export default UpdateLayerAttributionEntry;