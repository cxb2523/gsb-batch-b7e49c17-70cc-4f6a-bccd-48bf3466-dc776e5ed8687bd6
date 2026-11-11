import HueFilter from "../../../../editor/layers/filters/hue_filter.js";
import BaseFilterSlider from "./base_filter_slider.js";

class HueFilterSlider extends BaseFilterSlider {
  constructor(layers) {
    super(layers, {
      name: "ncrs:hue_slider",
      default: 0.5,
    });

    this.slider.steps = 360;
    this.slider.max = 359;
  }

  getFilterValue() {
    let value = this.getProgress() - 0.5;
    if (value < 0) {
      value += 1;
    }

    return value * 360;
  }

  getSliderValue(filter) {
    let value = (filter.value / 360) + 0.5;
    if (value > 1) {
      value -= 1;
    }

    return value;
  }

  toFilter() {
    return new HueFilter(this.getFilterValue(), {name: this.name});
  }
}

export default HueFilterSlider;