import * as THREE from "three";
import Color from "color";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../../constants.js";

class CanvasHelper {
  constructor() {
    this.canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this._refreshData();
  }

  imageData;
  data;

  drawImage(...params) {
    this.render();
    this.context.drawImage(...params);
    this._refreshData();
  }

  render() {
    // Mitigate issue with context filter polyfill merging
    // pixels with putImageData rather than replacing them
    this.context.clearRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    this.context.putImageData(this.imageData, 0, 0);
  }

  toTexture() {
    this.render();

    const texture = new THREE.Texture(this.canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;

    return texture;
  }

  getPixel(point) {
    const color = {};

    color.r = this.data[point.x * 4 + 0 + point.y * IMAGE_WIDTH * 4];
    color.g = this.data[point.x * 4 + 1 + point.y * IMAGE_WIDTH * 4];
    color.b = this.data[point.x * 4 + 2 + point.y * IMAGE_WIDTH * 4];
    const alpha = this.data[point.x * 4 + 3 + point.y * IMAGE_WIDTH * 4];

    return new Color(color).alpha(alpha / 255);
  }

  putPixel(point, color) {
    this.data[point.x * 4 + 0 + point.y * IMAGE_WIDTH * 4] = color.red();
    this.data[point.x * 4 + 1 + point.y * IMAGE_WIDTH * 4] = color.green();
    this.data[point.x * 4 + 2 + point.y * IMAGE_WIDTH * 4] = color.blue();
    this.data[point.x * 4 + 3 + point.y * IMAGE_WIDTH * 4] = color.alpha() * 255;
  }

  // https://zingl.github.io/bresenham.html
  putLine(color, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0);
    let sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let e2;

    while (true) {
      this.putPixel({ x: x0, y: y0 }, color);

      if (x0 == x1 && y0 == y1) {
        break;
      }
      e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  _refreshData() {
    this.imageData = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.data = this.imageData.data;
  }
}

export default CanvasHelper;
