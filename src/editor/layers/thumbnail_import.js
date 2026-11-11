import { IMAGE_HEIGHT, IMAGE_THUMBNAIL_HEIGHT, IMAGE_THUMBNAIL_WIDTH, IMAGE_WIDTH } from "../../constants.js";
import { nonPolyfilledCtx } from "../../helpers.js";
import { getUV } from "./texture_utils.js";

const OPERATIONS = [
  // Head
  ["head_base_front", 4, 0],
  ["head_base_back", 24, 0],

  // Torso
  ["torso_base_front", 4, 8],
  ["torso_base_back", 24, 8],

  // Left Arm
  ["arm_left_base_front", 12, 8],
  ["arm_left_base_back", 20, 8],

  // Right Arm
  ["arm_right_base_front", 0, 8],
  ["arm_right_base_back", 32, 8],

  // Left Leg
  ["leg_left_base_front", 8, 20],
  ["leg_left_base_back", 24, 20],

  // Right Leg
  ["leg_right_base_front", 4, 20],
  ["leg_right_base_back", 28, 20],
]

function thumbnailImport(imgSource) {
  const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const ctx = nonPolyfilledCtx(canvas.getContext("2d"));

  const scaleWidth = IMAGE_THUMBNAIL_WIDTH / 5;
  const scaleHeight = IMAGE_THUMBNAIL_HEIGHT / 5;

  const scaleCanvas = new OffscreenCanvas(scaleWidth, scaleHeight);
  const scaleCtx = scaleCanvas.getContext("2d");

  scaleCtx.imageSmoothingEnabled = false;
  scaleCtx.drawImage(imgSource, 0, 0, scaleWidth, scaleHeight);

  OPERATIONS.forEach(op => {
    const uv = getUV("classic", op[0]);

    ctx.drawImage(scaleCanvas, op[1], op[2], uv.width, uv.height, uv.x, uv.y, uv.width, uv.height);
  });

  return canvas;
}

export default thumbnailImport;