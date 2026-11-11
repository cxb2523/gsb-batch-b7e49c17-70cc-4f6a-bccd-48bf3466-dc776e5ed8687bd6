import BaseVersion from "../base_version.js";
import { uvLookup } from "../../model/uv.js";
import { nonPolyfilledCtx } from "../../../helpers.js";

const IMAGE_WIDTH = 64, IMAGE_HEIGHT = 64

/*
  Welcome to the Legacy Version Importer!
  This converts the old .ncrs format to the modern format (at time of writing format 3).
  The old format was pretty bad, so this does some hacky bs.
*/

class NCRSLegacyVersion extends BaseVersion {
  static format = 2;

  constructor(data) {
    super(undefined, data);

    this.format = 2;
  }

  checkData(data) {
    return this.convert(data);
  }

  // Hard code version check to true, as old NCRS files are not consistent.
  versionCheck(_data) {
    return true;
  }

  // Make format always considered valid, errors will be fixed in conversion.
  validateData(_data) {
    return true;
  }

  convert(data) {
    const model = this._parseModel(data);
    const blendPalette = this._parseBlendPalette(data);
    const layers = this._parseLayers(data, model);

    return {
      format: this.format,
      variant: model,
      blendPalette: blendPalette,
      layers: layers,
    }
  }

  _parseModel(data) {
    switch (data.model) {
      case "skin": { return "classic"; }
      case "skinAlex": { return "slim"; }
      default: { return "classic"; }
    }
  }

  _parseBlendPalette(data) {
    if (!data.blendPalette) { return []; }

    const bp = JSON.parse(data.blendPalette);

    if (!(bp instanceof Array)) { return []; }
    if (bp < 1) { return []; }

    return bp.map(entry => {
      return "#" + entry.toString().toUpperCase();
    })
  }

  _parseLayers(data, variant) {
    let json;
    try {
      json = JSON.parse(data.data)
    } catch(_) {
      return [];
    }

    if (typeof json !== "object") { return []; }

    const layers = json.layers;
    if (typeof layers !== "object") { return []; }

    const unorderedLayers = Object.values(layers).map((layer, idx) => {
      return this._parseLayer(layer, idx, variant);
    }).filter(e => e);

    return unorderedLayers.sort((a, b) => a.order - b.order).map(e => e.layer);
  }

  _parseLayer(layer, idx, variant) {
    const visible = layer.visible || false;
    const selected = layer.selected || false;
    const order = layer.order || idx;
    const data = this._parseTextureData(layer.faces, variant);
    const attribution = layer.skinId || "";

    const layerData = {
      filters: [],
      data: data,
      metadata: {attribution},
      selected: selected,
      visible: visible,
    }

    return {order: order, layer: layerData}
  }

  _parseTextureData(textureData, variant) {
    const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    const ctx = nonPolyfilledCtx(canvas.getContext("2d"));

    if (!(textureData instanceof Array)) { return this._toBinString(ctx); }

    const layers = ["overlay", "base"];
    const parts = ["head", "torso", "arm_right", "arm_left", "leg_right", "leg_left"];
    const faces = ["right", "left", "top", "bottom", "front", "back"]

    let cursor = 0;

    function getColor(pixel) {
      if (pixel.r === 0 && pixel.g === 1 && pixel.b === 0) {
        return "transparent";
      }

      // Ancient THREE JS color conversion method
      const hex = ((255 * pixel.r) << 16 ^ ((255 * pixel.g) << 8) ^ (255 * pixel.b) << 0);
      const hexString = ("000000" + hex.toString(16)).slice(-6);

      return "#" + hexString;
    }

    // It aint pretty but it works
    layers.forEach(layer => {
      parts.forEach(part => {
        faces.forEach(face => {
          const faceUV = uvLookup(variant, layer, part, face);
          const width = faceUV[2];
          const height = faceUV[3];

          const x = faceUV[0];
          const y = faceUV[1];

          for(let idx = 0; idx < Math.abs(width * height); idx++) {
            const localX = idx % width;
            // Deal with negative uv stuff
            const localY = (idx / width) * (height < 0 ? -1 : 1);

            const xPos = x + Math.floor(localX);
            const yPos = y + (height < 0 ? Math.ceil(localY) - 1 : Math.floor(localY));

            const pixel = textureData[cursor];
            ctx.fillStyle = getColor(pixel);
            ctx.fillRect(xPos, yPos, 1, 1);

            cursor++;
          }
        })
      })
    });


    return this._toBinString(ctx);
  }

  _toBinString(ctx) {
    const imageData = ctx.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    const binString = String.fromCharCode(...imageData.data);
    return btoa(binString);
  }
}

export default NCRSLegacyVersion;