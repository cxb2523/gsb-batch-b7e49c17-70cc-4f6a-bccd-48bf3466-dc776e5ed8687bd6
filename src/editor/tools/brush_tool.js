import Color from "color";
import { BaseTool } from "./base_tool.js";
import { getMirroredCoords, getUVFromCoords } from "../layers/texture_utils.js";
import { clamp } from "../../helpers.js";
import BRUSHES from "./brushes.js";

const TRANSPARENT_COLOR = new Color("#000000").alpha(0);

class BrushBaseTool extends BaseTool {
  constructor(config, properties) {
    super(config, properties);
  }

  cursor = { x: 0, y: 0 };
  lastPart;
  lastFace;
  reset = false;

  _getColor = () => { return this.config.getColor(); }
  _transparentColor = () => { return TRANSPARENT_COLOR; }

  up() {
    this.reset = true;
  }

  draw(texture, part, point, color, variant, line = true) {
    if (this.reset || part.object.id != this.lastPart || !part.normal.equals(this.lastFace)) {
      this.cursor = point;
      this.reset = false;
    }

    this.lastPart = part.object.id;
    this.lastFace = part.normal;

    const shape = this.config.get("shape", "square");
    const size = this.config.get("size", 1);

    const uv = getUVFromCoords(variant, point);
    const offsets = BRUSHES[shape][size];

    offsets.forEach(offset => {
      const maxX = uv.x + Math.abs(uv.width) - 1;
      const maxY = uv.y + Math.abs(uv.height) - 1;

      let startX = clamp(this.cursor.x + offset[0], uv.x, maxX);
      let startY = clamp(this.cursor.y + offset[1], uv.y, maxY);

      const endX = clamp(point.x + offset[0], uv.x, maxX);
      const endY = clamp(point.y + offset[1], uv.y, maxY);

      if (!line) {
        startX = endX;
        startY = endY;
      }

      if (typeof color === "function") {
        this.drawLine(
          texture,
          color({x: endX, y: endY, offsetX: offset[0], offsetY: offset[1]}),
          variant, {x: startX, y: startY}, {x: endX, y: endY}
        );
      } else {
        this.drawLine(texture, color, variant, {x: startX, y: startY}, {x: endX, y: endY});
      }
    })

    this.cursor = point;
  }

  drawLine(texture, color, variant, startPoint, endPoint) {
    texture.putLine(color, startPoint.x, startPoint.y, endPoint.x, endPoint.y);

    if (this.config.get("mirror", false) && !this.properties.disableMirror) {
      const mirroredStart = getMirroredCoords(variant, startPoint);
      const mirroredEnd = getMirroredCoords(variant, endPoint);

      texture.putLine(color, mirroredStart.x, mirroredStart.y, mirroredEnd.x, mirroredEnd.y);
    }
  }
}

export default BrushBaseTool;
