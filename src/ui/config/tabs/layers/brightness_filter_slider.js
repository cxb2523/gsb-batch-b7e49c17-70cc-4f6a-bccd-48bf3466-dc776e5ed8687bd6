import BrightnessFilter from "../../../../editor/layers/filters/brightness_filter.js";
import BaseFilterSlider from "./base_filter_slider.js";

class BrightnessFilterSlider extends BaseFilterSlider {
  constructor(layers) {
    super(layers, {
      name: "ncrs:brightness_slider",
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
    return new BrightnessFilter(this.getFilterValue(), {name: this.name});
  }
}

export default BrightnessFilterSlider;