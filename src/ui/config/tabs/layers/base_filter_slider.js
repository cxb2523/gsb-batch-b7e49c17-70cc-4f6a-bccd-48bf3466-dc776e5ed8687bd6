import Slider from "../../../misc/slider.js";

class BaseFilterSlider extends EventTarget {
  constructor(layers, properties = {}) {
    super();
    this.layers = layers;
    this.name = properties.name;
    this.defaultValue = properties.default || 0.5;
    this.currentValue = this.defaultValue;
    this.slider = this._createSlider();

    const scope = this;
    this.filtersUpdateCallback = function () {
      scope._syncFromCurrentLayer();
    }

    this._setupEvents();
    this._syncFromCurrentLayer();
  }
  currentLayer;

  isDefault() {
    return this.getProgress() == this.defaultValue;
  }

  getProgress() {
    return this.slider.progress;
  }

  getFilterValue() {}

  getSliderValue(_filter) {}

  toFilter() {}

  reset() {
    this.slider.progress = this.defaultValue;
  }

  _createSlider() {
    const slider = new Slider();
    slider.addEventListener("slider-change", event => this._onSliderChange(event));
    slider.addEventListener("mousedown", event => this._onSliderMousedown(event));
    slider.progress = this.currentValue;

    return slider;
  }

  _onSliderChange(event) {
    if (event.detail.progress == this.currentValue) { return; }
    
    this.dispatchEvent(new CustomEvent("slider-change", event.detail));
  }

  _onSliderMousedown(event) {
    if (event.button == 1) {
      event.preventDefault();
      this.reset();
    }
  }

  _syncFromCurrentLayer() {
    const layer = this.layers.getSelectedLayer();
    
    this.currentValue = this.defaultValue;
    if (layer && layer.hasFilters()) {
      const filter = layer.findFilter(filter => filter.name == this.name);

      if (filter) {
        this.currentValue = this.getSliderValue(filter);
      }
    }

    this.slider.progress = this.currentValue;
  }

  _setupEvents() {
    this.layers.addEventListener("update-filters", () => {
      this._syncFromCurrentLayer();
    });

    this.layers.addEventListener("layers-select", () => {
      if (this.currentLayer) {
        this.currentLayer.compositor.removeEventListener("update-filters", this.filtersUpdateCallback);
      }
      this.currentLayer = this.layers.getSelectedLayer();
      this.currentLayer.compositor.addEventListener("update-filters", this.filtersUpdateCallback);

      this._syncFromCurrentLayer();
    });
  }
}

export default BaseFilterSlider;