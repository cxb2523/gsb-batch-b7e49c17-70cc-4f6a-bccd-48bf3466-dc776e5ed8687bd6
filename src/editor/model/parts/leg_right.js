import * as THREE from "three"
import { BasePart } from "../base.js"

class RightLegPart extends BasePart {
  constructor(texture, variant) {
    super(texture, variant);

    const material = this.textureMaterial;
    material.polygonOffsetFactor = 2.5;
  }

  name() { return "leg_right" }

  position() {
    return new THREE.Vector3(-0.25, -2.75, 0)
  }

  size() {
    return {
      base: [0.5, 1.5, 0.5],
      overlay: [0.5625, 1.5625, 0.5625]
    }
  }
}

export {RightLegPart}