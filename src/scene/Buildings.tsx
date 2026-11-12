import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { CityBuilding, CityLayout } from "../lib/types";

// ─── Instanced tower renderer ──────────────────────────────────
// One draw call for the whole city. A raw shader draws the pixel window grid
// procedurally (every tower shares the same floor height), so there is no
// texture atlas: columns, floors and lit windows are per-instance attributes.

const vertexShader = /* glsl */ `
  attribute vec3 aTint;
  attribute vec2 aWin;   // x = window columns, y = floors
  attribute float aLit;
  attribute float aSeed;

  varying vec3 vTint;
  varying vec2 vWin;
  varying float vLit;
  varying float vSeed;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying float vDepth;

  void main() {
    vTint = aTint;
    vWin = aWin;
    vLit = aLit;
    vSeed = aSeed;
    vLocal = position;

    // unit cube with y in [0,1]; instanceMatrix scales it to width/height/depth
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(instanceMatrix) * normal);
    vec4 mv = modelViewMatrix * world;
    vDepth = -mv.z;

    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uWindowWarm;
  uniform vec3 uWindowCool;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uTime;

  varying vec3 vTint;
  varying vec2 vWin;
  varying float vLit;
  varying float vSeed;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying float vDepth;

  float hash21(vec2 p, float s) {
    p = fract(p * vec2(127.31, 311.7) + s * 0.137);
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 an = abs(n);
    float fog = smoothstep(uFogNear, uFogFar, vDepth);

    // ── roof ──
    if (an.y > 0.5) {
      vec3 roof = vTint * 1.9 + vec3(0.012, 0.016, 0.026);
      gl_FragColor = vec4(mix(roof, uFogColor, fog), 1.0);
      return;
    }

    // ── facade ──
    float u = (an.z > an.x ? vLocal.x : vLocal.z) + 0.5;
    float floors = max(1.0, floor(vWin.y));
    vec2 g = vec2(u * vWin.x, vLocal.y * floors);
    vec2 cell = floor(g);
    vec2 f = fract(g);

    float pane = step(0.22, f.x) * step(f.x, 0.78) * step(0.24, f.y) * step(f.y, 0.8);
    float r = hash21(cell, vSeed * 53.0 + 7.0);
    float lit = step(r, vLit) * pane;
    float flicker = 0.9 + 0.1 * sin(uTime * 1.6 + r * 63.0);

    vec3 warm = uWindowWarm * (0.65 + 0.55 * hash21(cell.yx, vSeed * 11.0)) * flicker;
    vec3 cool = uWindowCool * flicker;
    vec3 winColor = mix(warm, cool, step(0.9, r));

    vec3 col = vTint;
    col = mix(col, vTint * 0.32, pane);
    col = mix(col, winColor, lit);
    // ground-contact occlusion, so the base of every tower reads solid
    col *= 0.7 + 0.3 * clamp(vLocal.y * 4.0, 0.0, 1.0);
    // side faces a touch darker than front/back: cheap "light from the street"
    col *= 0.84 + 0.16 * an.z;

    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  }
`;

const FLOOR_HEIGHT = 3.2;

interface BuildingsProps {
  layout: CityLayout;
  onHover: (b: CityBuilding | null) => void;
  onSelect: (b: CityBuilding) => void;
  fog: { color: string; near: number; far: number };
}

export default function Buildings({ layout, onHover, onSelect, fog }: BuildingsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // where the press started, so a drag across the skyline never counts as a tap
  const press = useRef<{ x: number; y: number; id: number } | null>(null);
  const count = layout.buildings.length;

  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);

    const tint = new Float32Array(count * 3);
    const win = new Float32Array(count * 2);
    const lit = new Float32Array(count);
    const seed = new Float32Array(count);
    const c = new THREE.Color();

    layout.buildings.forEach((b, i) => {
      c.set(b.color);
      tint[i * 3] = c.r;
      tint[i * 3 + 1] = c.g;
      tint[i * 3 + 2] = c.b;
      win[i * 2] = b.cols;
      win[i * 2 + 1] = Math.max(2, Math.round(b.h / FLOOR_HEIGHT));
      lit[i] = b.lit;
      seed[i] = b.seed;
    });

    g.setAttribute("aTint", new THREE.InstancedBufferAttribute(tint, 3));
    g.setAttribute("aWin", new THREE.InstancedBufferAttribute(win, 2));
    g.setAttribute("aLit", new THREE.InstancedBufferAttribute(lit, 1));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));

    return g;
  }, [layout, count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uWindowWarm: { value: new THREE.Color("#ffd09a") },
          uWindowCool: { value: new THREE.Color("#9fdcff") },
          uFogColor: { value: new THREE.Color(fog.color) },
          uFogNear: { value: fog.near },
          uFogFar: { value: fog.far },
          uTime: { value: 0 },
        },
      }),
    [fog.color, fog.near, fog.far],
  );

  // one matrix per tower: footprint, height, position
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    layout.buildings.forEach((b, i) => {
      pos.set(b.x, 0, b.z);
      scale.set(b.w, b.h, b.d);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [layout, geometry, material]);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return;
    onHover(layout.buildings[e.instanceId] ?? null);
  };

  const handleOver = () => {
    document.body.style.cursor = "pointer";
  };

  const handleOut = () => {
    document.body.style.cursor = "";
    onHover(null);
  };

  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    // only the tower under the cursor owns this press
    e.stopPropagation();
    press.current = {
      x: e.nativeEvent.clientX,
      y: e.nativeEvent.clientY,
      id: e.instanceId === undefined ? -1 : e.instanceId,
    };
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const p = press.current;
    press.current = null;
    if (!p || p.id < 0) return;
    // a tap, not the tail of an orbit drag
    const moved = Math.hypot(e.nativeEvent.clientX - p.x, e.nativeEvent.clientY - p.y);
    if (moved > 8) return;
    if (e.instanceId !== p.id) return;
    const b = layout.buildings[p.id];
    if (b) onSelect(b);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      frustumCulled={false}
      onPointerMove={handleMove}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onPointerDown={handleDown}
      onClick={handleClick}
    />
  );
}
