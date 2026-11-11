import { BasePart } from "../base.js";

const WIDTHS = {
  classic: 0.5,
  slim: 0.375,
}

const UV_WIDTHS = {
  classic: 4,
  slim: 3,
}

const POSITION_OFFSETS = {
  classic: 0.75,
  slim: 0.6875,
}

class ArmBasePart extends BasePart {
  constructor(texture, variant) {
    super(texture, variant);
  }

  size() {
    const width = WIDTHS[this.variant];

    return {
      base: [width, 1.5, 0.5],
      overlay: [width + 0.0625, 1.5625, 0.5625]
    }
  }

  positionOffset() {
    return POSITION_OFFSETS[this.variant];
  }

  uvWidth() {
    return UV_WIDTHS[this.variant];
  }
}

export {ArmBasePart}