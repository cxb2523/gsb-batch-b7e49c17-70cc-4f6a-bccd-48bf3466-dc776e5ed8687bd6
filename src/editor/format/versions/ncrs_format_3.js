import BaseVersion from "../base_version.js";
import NCRSLegacyVersion from "./ncrs_legacy.js";
import validate from "./schemas/schema_3.js";

class NCRSFormat3 extends BaseVersion {
  static format = 3;

  static exportEditor(editor) {
    return {
      format: this.format,
      variant: editor.project.get("variant"),
      layers: editor.layers.serializeLayers(),
      blendPalette: editor.toolConfig.get("blend-palette"),
    };
  }

  static loadEditor(editor, data) {
    editor.resetProject();

    editor.setVariant(data.variant);
    editor.toolConfig.set("blend-palette", data.blendPalette);

    data.layers.forEach(layer => {
      const deserializedLayer = editor.layers.deserializeLayer(layer);
      editor.layers.addLayer(deserializedLayer);
    });
  }

  constructor(data) {
    super(NCRSLegacyVersion, data, NCRSFormat3.format);
  }

  checkData(data) {
    if (this.versionCheck(data)) {
      return data;
    } else if (!!data.format) {
      return this.convert(data);
    } else {
      const transformedData = this.transformData(data);
      return transformedData;
    }
  }

  convert(data) {
    data.format = this.format;

    return data;
  }

  validateData(data) {
    return validate(data);
  }

  loadEditor(editor) {
  }
}

export default NCRSFormat3;