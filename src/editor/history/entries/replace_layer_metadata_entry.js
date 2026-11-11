import { BaseEntry } from "../base_entry.js";

class ReplaceLayerMetadataEntry extends BaseEntry {
  constructor(layer, metadata) {
    super();

    this.layer = layer;
    this.metadata = metadata;
  }
  oldMetadata;

  onPerform() {
    this.oldMetadata = this.oldMetadata || this.layer.metadata || {};
    this.layer.replaceMetadata(this.metadata);
  }

  onRevert() {
    this.layer.replaceMetadata(this.oldMetadata);
  }
}

export default ReplaceLayerMetadataEntry;