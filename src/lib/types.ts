import type { Blog, Catalog } from "../../shared/blogs";

export type { Blog, Catalog };

export interface CityBuilding {
  /** instance index in the instanced mesh */
  i: number;
  blog: Blog;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** fraction of windows that are lit */
  lit: number;
  /** window columns per face */
  cols: number;
  /** deterministic 0..1 seed for window flicker */
  seed: number;
  color: string;
}

export interface CityLayout {
  buildings: CityBuilding[];
  roads: CityRoad[];
  trees: CityTree[];
  /** radius of the downtown roundabout that keeps its middle clear */
  plaza: number;
  extent: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface CityRoad {
  /** "spoke" runs from the centre outwards, "ring" is a full circle */
  kind: "spoke" | "ring";
  /** radians for a spoke, radius for a ring */
  at: number;
  width: number;
  /** spokes only: radial extent */
  from: number;
  to: number;
}

export interface CityTree {
  x: number;
  z: number;
  scale: number;
  rot: number;
  /** 0 = broadleaf, 1 = conifer */
  kind: number;
  tint: number;
}
