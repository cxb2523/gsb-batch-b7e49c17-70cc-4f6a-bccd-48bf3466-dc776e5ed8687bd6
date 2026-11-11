import * as THREE from "three";
import { createSkinGridBox } from "./grid.js";
import { getUVMap } from "./uv.js";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../../constants.js";

const FACES = {
  front: 4,
  back: 5,
  left: 1,
  right: 0,
  bottom: 3,
  top: 2,
};

function coordsToUVs(p0, p1, p2, p3, width, height) {
  //p0 p1
  //p2 p3
  var result = [];
  var p;
  p = { x: p0.x / width, y: 1 - p0.y / height };
  result.push(p);

  p = { x: p1.x / width, y: 1 - p1.y / height };
  result.push(p);

  p = { x: p2.x / width, y: 1 - p2.y / height };
  result.push(p);

  p = { x: p3.x / width, y: 1 - p3.y / height };
  result.push(p);

  return result;
}

function squareToUVs(x0, y0, sw, sh, my = false) {
  let x1 = x0 + sw;
  let y1 = y0 + sh;
  if (my) {
    let aux = y1;
    y1 = y0;
    y0 = aux;
  }
  // apperantely this is how three js stores uvs for each cube face
  // 0, 1
  // 1, 1
  // 0, 0
  // 1, 0
  return coordsToUVs(
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x0, y: y1 },
    { x: x1, y: y1 },
    IMAGE_WIDTH,
    IMAGE_HEIGHT
  );
}

function setFaceUVs(face, uvs, uvAttribute) {
  const faceNumber = FACES[face];
  const uv = squareToUVs(...uvs);

  uvAttribute.setXY(faceNumber * 4 + 0, uv[0].x, uv[0].y);
  uvAttribute.setXY(faceNumber * 4 + 1, uv[1].x, uv[1].y);
  uvAttribute.setXY(faceNumber * 4 + 2, uv[2].x, uv[2].y);
  uvAttribute.setXY(faceNumber * 4 + 3, uv[3].x, uv[3].y);
}

class BasePart {
  constructor(texture, variant) {
    this.texture = texture;
    this.variant = variant;

    this.textureMaterial = this._setupTextureMaterial();

    this.baseMesh = this._setupMesh(this.uvmap().base);
    this.baseGrid = this._setupGrid(this.uvmap().base, false);
    this.overlayMesh = this._setupMesh(this.uvmap().overlay, true);
    this.overlayGrid = this._setupGrid(this.uvmap().overlay, true);

    this.baseMeshVisible = true;
    this.overlayMeshVisible = true;
    this.updateMeshVisible();
  }
  isPart = true;

  name() {
    return "";
  }

  uvmap() {
    return {
      base: getUVMap(this.variant, this.name() + "_base"),
      overlay: getUVMap(this.variant, this.name() + "_overlay"),
    }
  }

  size() {
    return {};
  }

  position() {
    return {};
  }

  setBaseVisible(visible) {
    this.baseMeshVisible = visible;
    this.updateMeshVisible();
  }

  setOverlayVisible(visible) {
    this.overlayMeshVisible = visible;
    this.baseMeshVisible();
  }

  setVisible(visible) {
    this.baseMeshVisible = visible;
    this.overlayMeshVisible = visible;
    this.updateMeshVisible();
  }

  getSize(overlay) {
    return overlay ? this.size().overlay : this.size().base;
  }

  updateMeshVisible() {
    this.baseMesh.visible = this.baseMeshVisible;
    this.overlayMesh.visible = this.overlayMeshVisible;

    this.baseGrid.visible = this.baseMeshVisible;
    this.overlayGrid.visible  = this.overlayMeshVisible;
  }

  _setupGeometry(uvmap, overlay = false) {
    const size = this.getSize(overlay);

    const geometry = new THREE.BoxGeometry(...size);
    const uv = geometry.attributes.uv;

    // Base UVMAP
    for (let [face, map] of Object.entries(uvmap)) {
      setFaceUVs(face, map, uv);
    }

    return geometry;
  }

  _setupGridGeometry(uvmap, overlay = false) {
    const size = this.getSize(overlay);

    const geometry = new THREE.BoxGeometry(...size);
    const uv = geometry.attributes.uv.clone();

    // Base UVMAP
    for (let [face, map] of Object.entries(uvmap)) {
      setFaceUVs(face, map, uv);
    }

    geometry.setAttribute("grid", uv);

    return geometry;
  }

  _setupTextureMaterial() {
    return new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      side: THREE.FrontSide,
      alphaTest: 1e-5,
    });
  }

  _setupMesh(uvmap, overlay = false) {
    const mesh = new THREE.Mesh(this._setupGeometry(uvmap, overlay), this.textureMaterial);
    mesh.userData.part = this;
    mesh.position.copy(this.position());
    mesh.layers.set(overlay ? 2 : 1);

    return mesh;
  }

  _setupGrid(uvmap, overlay) {
    const dim = this.getSize().map(n => n * 8);
    const geometry = this._setupGridGeometry(uvmap, overlay, dim);
    // const geometry = new THREE.BoxGeometry(...this.getSize(overlay), ...dim);

    const gridColor = overlay ? new THREE.Color("#373737") : new THREE.Color("#575757");
    const grid = createSkinGridBox(geometry, this.texture, ...dim, gridColor);
    grid.position.add(this.position());
    grid.layers.set(overlay ? 2 : 1);

    return grid;
  }
}

export { BasePart };
