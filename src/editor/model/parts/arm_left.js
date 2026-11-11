import * as THREE from "three"
import { ArmBasePart } from "./arm_base.js"
import { getUVMap } from "../uv.js"

const UVMAP_BASE = {
  classic: {
    left: [32, 52, 4, 12],
    front: [36, 52, 4, 12],
    right: [40, 52, 4, 12],
    back: [44, 52, 4, 12],
    top: [36, 48, 4, 4],
    bottom: [40, 52, 4, -4],
  },
  slim: {
    left: [32, 52, 4, 12],
    front: [36, 52, 3, 12],
    right: [39, 52, 4, 12],
    back: [43, 52, 3, 12],
    top: [36, 48, 3, 4],
    bottom: [39, 52, 3, -4],
  }
}

const UVMAP_OVERLAY = {
  classic: {
    left: [48, 52, 4, 12],
    front: [52, 52, 4, 12],
    right: [56, 52, 4, 12],
    back: [60, 52, 4, 12],
    top: [52, 48, 4, 4],
    bottom: [56, 52, 4, -4],
  },
  slim: {
    left: [48, 52, 4, 12],
    front: [52, 52, 3, 12],
    right: [55, 52, 4, 12],
    back: [59, 52, 3, 12],
    top: [52, 48, 3, 4],
    bottom: [55, 52, 3, -4],
  }
}

class LeftArmPart extends ArmBasePart {
  constructor(texture, variant) {
    super(texture, variant)
  }

  name() { return "arm_left" }

  position() {
    return new THREE.Vector3(this.positionOffset(), -1.25, 0)
  }
}

export {LeftArmPart}