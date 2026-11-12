import { useMemo } from "react";
import * as THREE from "three";
import type { CityLayout } from "../lib/types";

// ─── Streets ───────────────────────────────────────────────────
// The road plan is radial: eight avenues out of downtown, three ring roads
// around it. Everything is instanced — the whole network is two draw calls
// (asphalt + lane markings) plus one per ring.

const ASPHALT = "#161c28";
const LANE = "#3a3524";

export function Roads({ layout }: { layout: CityLayout }) {
  const spokes = useMemo(() => layout.roads.filter((r) => r.kind === "spoke"), [layout.roads]);
  const rings = useMemo(() => layout.roads.filter((r) => r.kind === "ring"), [layout.roads]);

  const dashes = useMemo(() => {
    // count first so the buffer is allocated once
    const per = spokes.map((s) => Math.floor((s.to - s.from) / 15));
    const total = per.reduce((a, b) => a + b, 0);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: LANE, transparent: true, opacity: 0.55 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, total));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let i = 0;
    spokes.forEach((s) => {
      q.setFromAxisAngle(up, -s.at);
      for (let t = s.from + 8; t < s.to - 4 && i < total; t += 15) {
        p.set(Math.cos(s.at) * t, 0.09, Math.sin(s.at) * t);
        sc.set(6.5, 0.02, 0.45);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i++, m);
      }
    });
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }, [spokes]);

  const asphalt = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: ASPHALT });
    const mesh = new THREE.InstancedMesh(geo, mat, spokes.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    spokes.forEach((s, i) => {
      const len = s.to - s.from;
      const mid = (s.from + s.to) / 2;
      q.setFromAxisAngle(up, -s.at);
      p.set(Math.cos(s.at) * mid, 0.03, Math.sin(s.at) * mid);
      sc.set(len, 0.08, s.width);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }, [spokes]);

  return (
    <group>
      <primitive object={asphalt} />
      {rings.map((r, i) => (
        <mesh key={`ring-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[r.at - r.width / 2, r.at + r.width / 2, 128]} />
          <meshBasicMaterial color={ASPHALT} />
        </mesh>
      ))}
      <primitive object={dashes} />
    </group>
  );
}

// ─── Trees ─────────────────────────────────────────────────────
// Three instanced meshes: trunks, broadleaf crowns, conifers. Lit by a single
// hemisphere light, so the foliage picks up the sky at the top and the ground
// at the bottom without any extra passes.

export function Trees({ layout }: { layout: CityLayout }) {
  const groups = useMemo(() => {
    const broad = layout.trees.filter((t) => t.kind === 0);
    const pine = layout.trees.filter((t) => t.kind === 1);
    return { broad, pine };
  }, [layout.trees]);

  const trunks = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.34, 0.44, 1, 4, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: "#241d16" });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, layout.trees.length));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    layout.trees.forEach((t, i) => {
      const h = 3.6 * t.scale;
      p.set(t.x, 0.1, t.z);
      q.identity();
      sc.set(t.scale, h, t.scale);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = layout.trees.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }, [layout.trees]);

  const broadCrowns = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({});
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, groups.broad.length));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    groups.broad.forEach((t, i) => {
      const h = 3.6 * t.scale;
      const r = (1.9 + t.tint * 0.7) * t.scale;
      p.set(t.x, h + r * 0.55, t.z);
      q.setFromAxisAngle(up, t.rot);
      sc.set(r, r * 0.92, r);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      // depth green, slightly bluer in the shade
      c.setHSL(0.33 + t.tint * 0.035, 0.34, 0.16 + t.tint * 0.07);
      mesh.setColorAt(i, c);
    });
    mesh.count = groups.broad.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }, [groups.broad]);

  const pineCrowns = useMemo(() => {
    const geo = new THREE.ConeGeometry(1, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({});
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, groups.pine.length));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    groups.pine.forEach((t, i) => {
      const h = 3.2 * t.scale;
      const r = 1.75 * t.scale;
      const tall = 5.4 * t.scale;
      p.set(t.x, h, t.z);
      q.setFromAxisAngle(up, t.rot);
      sc.set(r, tall, r);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      c.setHSL(0.36 + t.tint * 0.03, 0.3, 0.12 + t.tint * 0.05);
      mesh.setColorAt(i, c);
    });
    mesh.count = groups.pine.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }, [groups.pine]);

  return (
    <group>
      <primitive object={trunks} />
      <primitive object={broadCrowns} />
      <primitive object={pineCrowns} />
    </group>
  );
}
