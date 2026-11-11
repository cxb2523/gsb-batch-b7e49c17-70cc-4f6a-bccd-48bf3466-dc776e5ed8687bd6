import CssFilter from "./css_filter";

// Opacity Filter
// Value - number from 0+, representing a percentage

class OpacityFilter extends CssFilter {
  static filterId = "ncrs:opacity";

  static deserialize(data) {
    if (data.id != this.filterId) { throw "Cannot deserialize filter!"; }

    return new OpacityFilter(data.value, data.properties);
  }

  constructor(value, properties = {}) {
    super(`opacity(${value}%)`, properties);
    this.value = value;
  }

  serialize() {
    return {
      id: OpacityFilter.filterId,
      value: this.value,
      properties: this.properties,
    };
  }
}

export default OpacityFilter;