class BaseFilter {
  static filterId = "base";

  static deserialize(_data) {
    throw "Cannot deserialize filter!"
  }

  constructor(properties = {}) {
    this.properties = properties;
  }

  apply(canvas) {
    return canvas;
  }

  serialize() {
    return "{}";
  }
}

export default BaseFilter;