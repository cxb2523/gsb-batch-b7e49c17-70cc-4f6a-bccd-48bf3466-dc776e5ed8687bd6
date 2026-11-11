import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../../../constants.js";
import BaseFilter from "./base_filter.js";

class CssFilter extends BaseFilter {
  static filterId = "css";

  static deserialize(data) {
    if (data.id != this.filterId) { throw "Cannot deserialize filter!"; }

    return new CssFilter(data.filter, data.properties);
  }

  constructor(filter, properties = {}) {
    super(properties);

    this.filter = filter;
  }

  apply(input) {
    const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    const ctx = canvas.getContext("2d");

    ctx.filter = this.filter;
    ctx.drawImage(input, 0, 0);

    return canvas;
  }

  serialize() {
    return {
      id: CssFilter.filterId,
      filter: this.filter,
      properties: this.properties,
    };
  }
}

export default CssFilter;