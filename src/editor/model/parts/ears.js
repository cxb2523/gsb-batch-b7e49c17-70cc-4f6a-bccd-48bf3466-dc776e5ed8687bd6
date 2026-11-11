import * as THREE from "three"
import { BasePart } from "../base.js"

class RightEarPart extends BasePart {
  constructor(texture, variant) {
    super(texture, variant)

    this.baseMeshVisible = false;
    this.overlayMeshVisible = false;
    this.updateMeshVisible();
  }

  name() { return "ears" }

  position() {
    return new THREE.Vector3(-0.625, 0.625, 0)
  }

  size() {
    return {
      base: [0.75, 0.75, 0.125],
      overlay: [0.75, 0.75, 0.125]
    }
  }
}

class LeftEarPart extends BasePart {
  constructor(texture, variant) {
    super(texture, variant)

    this.baseMeshVisible = false;
    this.overlayMeshVisible = false;
    this.updateMeshVisible();
  }

  name() { return "ears" }

  position() {
    return new THREE.Vector3(0.625, 0.625, 0)
  }

  size() {
    return {
      base: [0.75, 0.75, 0.125],
      overlay: [0.75, 0.75, 0.125]
    }
  }
}

export {RightEarPart, LeftEarPart}