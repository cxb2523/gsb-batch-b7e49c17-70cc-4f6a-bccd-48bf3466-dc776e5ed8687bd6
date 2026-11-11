import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../../constants.js";
import { nonPolyfilledCtx } from "../../helpers.js";
import { getUV } from "./texture_utils.js";

const OPERATIONS = [
  // Left Leg
  ["leg_right_base_right", 16, 52],
  ["leg_right_base_front", 20, 52],
  ["leg_right_base_left", 24, 52],
  ["leg_right_base_back", 28, 52],
  ["leg_right_base_top", 20, 48],
  ["leg_right_base_bottom", 24, 48],

  // Left Arm
  ["arm_right_base_right", 32, 52],
  ["arm_right_base_front", 36, 52],
  ["arm_right_base_left", 40, 52],
  ["arm_right_base_back", 44, 52],
  ["arm_right_base_top", 36, 48],
  ["arm_right_base_bottom", 40, 48],
]

function convertLegacySkin(imgSource) {
  const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const ctx = nonPolyfilledCtx(canvas.getContext("2d"));

  ctx.drawImage(imgSource, 0, 0);

  let notch_fix = true

  for (let x = 0; x < 64; x++) {
    for (let y = 0; y < 32; y++) {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      if (x >= 32 && pixel[3] < 128) {
        notch_fix = false
      }
    }
  }

  if (notch_fix) {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 32; y++) {
        ctx.clearRect(40, 0, 16, 8);
        ctx.clearRect(32, 8, 32, 8);
      }
    }
  }

  OPERATIONS.forEach(op => {
    const uv = getUV("classic", op[0]);

    const tempCanvas = new OffscreenCanvas(uv.width, uv.height);
    const tempCtx = tempCanvas.getContext("2d");

    tempCtx.scale(-1, 1);
    tempCtx.drawImage(imgSource, ...Object.values(uv), -uv.width, 0, uv.width, uv.height);

    ctx.drawImage(tempCanvas, ...op.slice(1));
  });

  return canvas;
}

export default convertLegacySkin;