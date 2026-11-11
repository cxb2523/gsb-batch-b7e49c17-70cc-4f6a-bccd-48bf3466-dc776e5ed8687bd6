import * as THREE from "three"
import { BasePart } from "../base.js"

class TorsoPart extends BasePart {
  constructor(texture, variant) {
    super(texture, variant);

    const material = this.textureMaterial;
    material.polygonOffsetFactor = 2;
  }

  name() { return "torso" }

  position() {
    return new THREE.Vector3(0, -1.25, 0)
  }

  size() {
    return {
      base: [1, 1.5, 0.5],
      overlay: [1.0625, 1.5625, 0.5625]
    }
  }
}

export {TorsoPart}