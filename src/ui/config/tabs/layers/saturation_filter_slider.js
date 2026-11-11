import SaturationFilter from "../../../../editor/layers/filters/saturation_filter.js";
import BaseFilterSlider from "./base_filter_slider.js";

class SaturationFilterSlider extends BaseFilterSlider {
  constructor(layers) {
    super(layers, {
      name: "ncrs:saturation_slider",
      default: 0.5,
    });

    this.slider.unclamped = true;
  }

  getFilterValue() {
    return this.getProgress() * 200;
  }

  getSliderValue(filter) {
    return filter.value / 200;
  }

  toFilter() {
    return new SaturationFilter(this.getFilterValue(), {name: this.name});
  }
}

export default SaturationFilterSlider;