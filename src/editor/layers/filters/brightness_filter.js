import CssFilter from "./css_filter";

// Brightness Filter
// Value - number from 0+, representing a percentage

class BrightnessFilter extends CssFilter {
  static filterId = "ncrs:brightness";

  static deserialize(data) {
    if (data.id != this.filterId) { throw "Cannot deserialize filter!"; }

    return new BrightnessFilter(data.value, data.properties);
  }

  constructor(value, properties = {}) {
    super(`brightness(${value}%)`, properties);
    this.value = value;
  }

  serialize() {
    return {
      id: BrightnessFilter.filterId,
      value: this.value,
      properties: this.properties,
    };
  }
}

export default BrightnessFilter;