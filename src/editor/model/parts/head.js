import * as THREE from "three"
import { BasePart } from "../base.js"

class HeadPart extends BasePart {
  constructor(texture, variant) {
    super(texture, variant)
  }

  name() { return "head" }

  position() {
    return new THREE.Vector3(0, 0, 0)
  }

  size() {
    return {
      base: [1, 1, 1],
      overlay: [1.125, 1.125, 1.125]
    }
  }
}

export {HeadPart}