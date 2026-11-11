import * as THREE from "three"
import { ArmBasePart } from "./arm_base.js"

const UVMAP_BASE = {
  classic: {
    left: [40, 20, 4, 12],
    front: [44, 20, 4, 12],
    right: [48, 20, 4, 12],
    back: [52, 20, 4, 12],
    top: [44, 16, 4, 4],
    bottom: [48, 20, 4, -4],
  },
  slim: {
    left: [40, 20, 4, 12],
    front: [44, 20, 3, 12],
    right: [47, 20, 4, 12],
    back: [51, 20, 3, 12],
    top: [44, 16, 3, 4],
    bottom: [47, 20, 3, -4],
  }
}

const UVMAP_OVERLAY = {
  classic: {
    left: [40, 36, 4, 12],
    front: [44, 36, 4, 12],
    right: [48, 36, 4, 12],
    back: [52, 36, 4, 12],
    top: [44, 32, 4, 4],
    bottom: [48, 36, 4, -4],
  },
  slim: {
    left: [40, 36, 4, 12],
    front: [44, 36, 3, 12],
    right: [47, 36, 4, 12],
    back: [51, 36, 3, 12],
    top: [44, 32, 3, 4],
    bottom: [47, 36, 3, -4],
  }
}

class RightArmPart extends ArmBasePart {
  constructor(texture, variant) {
    super(texture, variant)
  }

  name() { return "arm_right" }
  
  position() {
    return new THREE.Vector3(-this.positionOffset(), -1.25, 0)
  }
}

export {RightArmPart}