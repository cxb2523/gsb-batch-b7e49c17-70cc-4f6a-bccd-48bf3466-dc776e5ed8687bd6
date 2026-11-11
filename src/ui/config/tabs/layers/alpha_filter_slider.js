import OpacityFilter from "../../../../editor/layers/filters/opacity_filter.js";
import BaseFilterSlider from "./base_filter_slider.js";

class AlphaFilterSlider extends BaseFilterSlider {
  constructor(layers) {
    super(layers, {
      name: "ncrs:opacity_slider",
      default: 1.0,
    });
  }

  getFilterValue() {
    return this.getProgress() * 100;
  }

  getSliderValue(filter) {
    return filter.value / 100;
  }

  toFilter() {
    return new OpacityFilter(this.getFilterValue(), {name: this.name});
  }
}

export default AlphaFilterSlider;