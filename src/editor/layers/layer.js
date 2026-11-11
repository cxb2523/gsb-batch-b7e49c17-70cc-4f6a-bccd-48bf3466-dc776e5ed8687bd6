import * as THREE from "three";
import { IMAGE_HEIGHT, IMAGE_LEGACY_HEIGHT, IMAGE_WIDTH, IMAGE_THUMBNAIL_WIDTH, IMAGE_THUMBNAIL_HEIGHT } from "../../constants.js";
import { imageToPreview } from "./layer_preview.js";
import Compositor from "./compositor.js";
import { clearLayer, getWatermarkData, mergeLayers, swapBodyOverlay, swapFrontBack, swapLeftRight } from "./texture_utils.js";
import convertLegacySkin from "./legacy_skin.js";
import thumbnailImport from "./thumbnail_import.js";
import { nonPolyfilledCtx } from "../../helpers.js";

class Layer extends EventTarget {
  constructor(id, texture) {
    super();

    this.id = id;
    this.texture = this._normaliseImageDimensions(texture);
    this.oldTexture = this.texture;
    this.compositor = new Compositor();

    this._setAttribution();
  }
  
  selected = false;
  visible = true;
  metadata = {};

  render(canvas = this.texture.image) {
    return this.compositor.render(canvas);
  }

  getBaseCanvas() {
    const img = this.texture.image;
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_WIDTH;
    canvas.height = IMAGE_HEIGHT;

    const ctx = nonPolyfilledCtx(canvas.getContext("2d"));
    ctx.drawImage(img, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    return canvas;
  }

  getBaseOffscreenCanvas() {
    const img = this.texture.image;
    const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    const ctx = nonPolyfilledCtx(canvas.getContext("2d"));
    ctx.drawImage(img, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    return canvas;
  }

  getBaseImageData() {
    return this.getBaseOffscreenCanvas().getContext("2d").getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  }

  isBlank() {
    const canvas = this.getBaseOffscreenCanvas();
    const ctx = nonPolyfilledCtx(canvas.getContext("2d"));

    return !ctx.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT).data.some(pixel => pixel !== 0);
  }

  flush() {
    this.oldTexture = this.texture;
  }

  replaceTexture(texture) {
    this.texture = this._normaliseImageDimensions(texture);
    this.dispatchEvent(new CustomEvent("layer-update"));
  }

  replaceMetadata(metadata) {
    this.metadata = metadata;
    this.dispatchEvent(new CustomEvent("layer-update"));
  }

  select(selected) {
    this.selected = selected;
    this.dispatchEvent(new CustomEvent("layer-select", {detail: {selected}}));
  }

  toPreview() {
    return imageToPreview(this.texture.image);
  }

  hasFilters() {
    return this.compositor.getFilters().length > 0;
  }

  findFilter(condition) {
    return this.compositor.getFilters().find(filter => condition(filter.properties));
  }
  
  serialize() {
    return {
      filters: this.compositor.serializeFilters(),
      data: this.getBaseCanvas().toDataURL(),
      metadata: this.metadata,
      selected: this.selected,
      visible: this.visible,
    }
  }

  swapBodyOverlayTexture(variant) {
    return swapBodyOverlay(this.getBaseOffscreenCanvas(), variant);
  }

  swapFrontBackTexture(variant) {
    return swapFrontBack(this.getBaseOffscreenCanvas(), variant);
  }

  swapLeftRightTexture(variant) {
    return swapLeftRight(this.getBaseOffscreenCanvas(), variant);
  }

  clearBase(variant) {
    return clearLayer(this.getBaseOffscreenCanvas(), variant, "base");
  }

  clearOverlay(variant) {
    return clearLayer(this.getBaseOffscreenCanvas(), variant, "overlay");
  }

  flattenOverlay(variant) {
    return mergeLayers(this.getBaseOffscreenCanvas(), "overlay", "base", variant);
  }

  readAttributionData() {
    return getWatermarkData(this.getBaseOffscreenCanvas());
  }

  _setAttribution() {
    const attribution = this.readAttributionData();

    if (!attribution) { return; }

    this.metadata.attribution = attribution;
  }

  _normaliseImageDimensions(texture) {
    const width = texture.image.width;
    const height = texture.image.height;

    if (width === IMAGE_WIDTH && height === IMAGE_HEIGHT) {
      return texture;
    } else if (width === IMAGE_WIDTH && height === IMAGE_LEGACY_HEIGHT) {
      const img = convertLegacySkin(texture.image);
      return new THREE.Texture(img);
    } else if (width === IMAGE_THUMBNAIL_WIDTH && height === IMAGE_THUMBNAIL_HEIGHT) {
      const img = thumbnailImport(texture.image);
      return new THREE.Texture(img);
    } else {
      const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
      nonPolyfilledCtx(canvas.getContext("2d")).drawImage(texture.image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

      return new THREE.Texture(canvas);
    }
  }
}

export default Layer;