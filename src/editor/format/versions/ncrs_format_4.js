import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../../../constants.js";
import { nonPolyfilledCtx } from "../../../helpers.js";
import BaseVersion from "../base_version.js";
import NCRSFormat3 from "./ncrs_format_3.js";
import validate from "./schemas/schema_4.js";

class NCRSFormat4 extends BaseVersion {
  static format = 4;

  static exportEditor(editor) {
    return {
      type: "application/vnd.needcoolershoes.ncrs+json",
      format: this.format,
      project: editor.project.get("project"),
      variant: editor.project.get("variant"),
      layers: editor.layers.serializeLayers(),
      blendPalette: editor.toolConfig.get("blend-palette"),
    };
  }
  
  static loadEditor(editor, data) {
    editor.resetProject();
    
    editor.setVariant(data.variant);
    editor.toolConfig.set("blend-palette", data.blendPalette);
    editor.project.set("project", data.project);

    async function loadLayers(layerData) {
      for (const data of layerData) {
        const layer = await editor.layers.deserializeLayer(data);
        editor.layers.addLayer(layer);
      }
    }

    loadLayers(data.layers);
  }

  constructor(data) {
    super(NCRSFormat3, data, NCRSFormat4.format);
  }

  // Convert data to version 4
  convert(data) {
    data.layers.forEach(layer => {
      layer.data = this._convertData(layer.data);
      layer.filters = layer.filters.map(filter => this._convertFilter(filter));
    });

    return data;
  }

  validateData(data) {
    return validate(data);
  }

  _convertData(dataStr) {
    const data = atob(dataStr);
    const array = Uint8ClampedArray.from([...data].map(ch => ch.charCodeAt()));
    const imgData = new ImageData(array, IMAGE_WIDTH, IMAGE_HEIGHT);
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_WIDTH;
    canvas.height = IMAGE_HEIGHT;

    const ctx = nonPolyfilledCtx(canvas.getContext("2d"));
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL();
  }

  _convertFilter(v3Filter) {
    switch (v3Filter.properties.name) {
      case "hue": return this._convertHueFilter(v3Filter);
      case "saturation": return this._convertSaturationFilter(v3Filter);
      case "brightness": return this._convertBrightnessFilter(v3Filter);
      case "alpha": return this._convertAlphaFilter(v3Filter);
    }
  }

  _convertHueFilter(v3Filter) {
    let value = v3Filter.properties.value - 0.5;
    if (value < 0) {
      value += 1;
    }

    value *= 360;

    return {id: "ncrs:hue", value, properties: {name: "ncrs:hue_slider"}}
  }

  _convertSaturationFilter(v3Filter) {
    return {id: "ncrs:saturation", value: v3Filter.properties.value * 200, properties: {name: "ncrs:saturation_slider"}}
  }
  
  _convertBrightnessFilter(v3Filter) {
    return {id: "ncrs:brightness", value: v3Filter.properties.value * 200, properties: {name: "ncrs:brightness_slider"}}
  }
  
  _convertAlphaFilter(v3Filter) {
    return {id: "ncrs:opacity", value: v3Filter.properties.value * 100, properties: {name: "ncrs:opacity_slider"}}
  }
}

export default NCRSFormat4;