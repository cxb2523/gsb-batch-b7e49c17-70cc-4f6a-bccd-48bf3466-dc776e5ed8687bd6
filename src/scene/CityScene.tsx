import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import Buildings from "./Buildings";
import { Roads, Trees } from "./Streets";
import { Roundabout, Traffic } from "./Downtown";
import { Ground, Moon, PALETTE, Sky, Stars } from "./Backdrop";
import type { CityBuilding, CityLayout } from "../lib/types";
import { useReducedMotion } from "../lib/usePresence";

export interface FocusTarget {
  x: number;
  z: number;
  h: number;
  /** bump to re-trigger the same focus */
  token: number;
}

interface Home {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
  /** how far the orbit pivot may be panned away from downtown */
  bound: number;
}

// the camera and the fog now derive from the actual city footprint, so the
// density knobs never leave the city cropped or lost in haze
function homeFor(layout: CityLayout): Home {
  const reach = Math.max(
    Math.abs(layout.extent.minX),
    layout.extent.maxX,
    Math.abs(layout.extent.minZ),
    layout.extent.maxZ,
  );
  const d = Math.max(360, reach * 2.05);
  return {
    pos: new THREE.Vector3(d * 0.56, d * 0.6, d * 0.8),
    target: new THREE.Vector3(0, 16, 0),
    distance: d,
    // a little past the last tower: you can pan to the edge, not into the void
    bound: Math.max(340, reach * 1.12),
  };
}

// Camera. Same model as git-city: a map-style OrbitControls whose pivot is
// wherever you last panned to, and a fixed-rate eased tween (not a spring) for
// flying to a tower. Panning, orbiting and zooming all write that pivot, so the
// view is never locked to the middle of the city.
const TWEEN_RATE = 0.7; // builds the same 1.4s flight as the reference
const ZOOM_MAX_FACTOR = 1.45; // how far out you may pull from the default view
const MAX_TILT = Math.PI / 2.1;
const AUTO_ROTATE_SPEED = 0.15;

interface Flight {
  active: boolean;
  t: number;
  fromPos: THREE.Vector3;
  fromLook: THREE.Vector3;
  toPos: THREE.Vector3;
  toLook: THREE.Vector3;
}

function Rig({ focus, homeToken, home }: { focus: FocusTarget | null; homeToken: number; home: Home }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();
  const reduce = useReducedMotion();

  // Seed the pivot from `home` once. This is done here instead of through the
  // `target` prop: drei would then hand the controls the very Vector3 that
  // `home` owns, and the pan clamp below would rewrite `home` in place.
  useEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    ctl.target.copy(home.target);
    ctl.update();
  }, [home]);

  // OrbitControls has no pan limit, so the pivot is clamped after each frame
  // and the camera is shifted by the same delta — the view angle never changes.
  const clampPivot = () => {
    const ctl = controls.current;
    if (!ctl) return;
    const t = ctl.target;
    const nx = THREE.MathUtils.clamp(t.x, -home.bound, home.bound);
    const ny = THREE.MathUtils.clamp(t.y, 0, 240);
    const nz = THREE.MathUtils.clamp(t.z, -home.bound, home.bound);
    if (nx === t.x && ny === t.y && nz === t.z) return;
    camera.position.x += nx - t.x;
    camera.position.y += ny - t.y;
    camera.position.z += nz - t.z;
    t.set(nx, ny, nz);
    ctl.update();
  };
  const flight = useRef<Flight>({
    active: false,
    t: 1,
    fromPos: new THREE.Vector3(),
    fromLook: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    toLook: new THREE.Vector3(),
  });
  // the city stops turning on its own the moment the visitor takes the camera
  const userMoved = useRef(false);

  const fly = (toPos: THREE.Vector3, toLook: THREE.Vector3) => {
    const ctl = controls.current;
    if (!ctl) return;
    const f = flight.current;
    f.fromPos.copy(camera.position);
    f.fromLook.copy(ctl.target);
    f.toPos.copy(toPos);
    f.toLook.copy(toLook);
    f.t = 0;
    f.active = true;
    ctl.autoRotate = false;
  };

  const snap = (toPos: THREE.Vector3, toLook: THREE.Vector3) => {
    const ctl = controls.current;
    if (!ctl) return;
    camera.position.copy(toPos);
    ctl.target.copy(toLook);
    ctl.update();
  };

  // ← a tower
  useEffect(() => {
    const ctl = controls.current;
    if (!focus || !ctl) return;

    // Stand outside the tower, on the side facing away from downtown, and look
    // back at its face. Distance follows the tower's height, since ours range
    // from a 9-unit dead blog to a 214-unit landmark.
    const k = Math.min(1.9, Math.max(0.62, focus.h / 110));
    const isMobile = window.innerWidth < 640;
    const dist = (isMobile ? 300 : 180) * k;
    const camH = (isMobile ? 200 : 120) * k;

    const len = Math.hypot(focus.x, focus.z);
    const nx = len > 1 ? focus.x / len : 0.707;
    const nz = len > 1 ? focus.z / len : 0.707;

    const toPos = new THREE.Vector3(focus.x + nx * dist, focus.h + camH, focus.z + nz * dist);
    const toLook = new THREE.Vector3(focus.x, Math.max(0, focus.h + 15), focus.z);

    if (reduce) snap(toPos, toLook);
    else fly(toPos, toLook);
  }, [focus, camera, reduce]);

  // ← leaving a tower: hand the pivot back to the middle of town, view unchanged
  useEffect(() => {
    if (!homeToken) return;
    const ctl = controls.current;
    if (!ctl) return;
    if (reduce) snap(camera.position.clone(), home.target);
    else fly(camera.position.clone(), home.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeToken]);

  useFrame((_, delta) => {
    const ctl = controls.current;
    if (!ctl) return;
    const f = flight.current;
    if (f.active) {
      f.t = Math.min(1, f.t + delta * TWEEN_RATE);
      // ease-out cubic, exactly the reference curve
      const e = 1 - Math.pow(1 - f.t, 3);
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      ctl.target.lerpVectors(f.fromLook, f.toLook, e);
      ctl.update();
      if (f.t >= 1) {
        f.active = false;
        if (!userMoved.current && !focus) ctl.autoRotate = true;
      }
      return;
    }
    // OrbitControls keeps itself up to date (damping + auto-rotate); all that
    // is left is keeping the pivot inside the city
    clampPivot();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={32}
      maxDistance={home.distance * ZOOM_MAX_FACTOR}
      maxPolarAngle={MAX_TILT}
      autoRotate
      autoRotateSpeed={AUTO_ROTATE_SPEED}
      // plain OrbitControls bindings: left drag orbits, right drag pans, wheel
      // zooms. The map-style remap (left = pan, zoom to cursor) never felt
      // right here, so it is gone along with its key handler.
      screenSpacePanning={false}
      onStart={() => {
        // grabbing the city mid-flight takes over instantly
        userMoved.current = true;
        flight.current.active = false;
        if (controls.current) controls.current.autoRotate = false;
      }}
    />
  );
}

const beamFragment = /* glsl */ `
  varying float vY;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float a = pow(1.0 - vY, 1.6) * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`;

function Beam({ x, z, y, color }: { x: number; z: number; y: number; color: string }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying float vY;
          void main() {
            vY = uv.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: beamFragment,
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.5 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [color],
  );

  return (
    <mesh position={[x, y + 150, z]} material={material} renderOrder={5}>
      <cylinderGeometry args={[1.6, 2.6, 300, 8, 1, true]} />
    </mesh>
  );
}

function SelectionMarker({ building }: { building: CityBuilding | null }) {
  const ring = useRef<THREE.Mesh>(null);
  const beamColor = building?.color && building.color !== "#000000" ? "#ffe3a8" : "#ffe3a8";

  useFrame((state) => {
    if (!ring.current) return;
    const s = 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.06;
    ring.current.scale.setScalar(s);
  });

  if (!building) return null;

  return (
    <group>
      <mesh ref={ring} position={[building.x, 0.9, building.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
        <ringGeometry args={[building.w * 0.95, building.w * 1.18, 6]} />
        <meshBasicMaterial color="#ffe3a8" transparent opacity={0.75} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Beam x={building.x} z={building.z} y={building.h} color={beamColor} />
    </group>
  );
}

function HoverMarker({ building }: { building: CityBuilding | null }) {
  if (!building) return null;
  return (
    <mesh position={[building.x, (building.h + 1) / 2, building.z]}>
      <boxGeometry args={[building.w + 1.6, building.h + 1, building.d + 1.6]} />
      <meshBasicMaterial color="#fff6d8" transparent opacity={0.22} wireframe depthWrite={false} />
    </mesh>
  );
}

interface CitySceneProps {
  layout: CityLayout;
  selected: CityBuilding | null;
  hovered: CityBuilding | null;
  focus: FocusTarget | null;
  homeToken: number;
  onHover: (b: CityBuilding | null) => void;
  onSelect: (b: CityBuilding | null) => void;
}

export default function CityScene({
  layout,
  selected,
  hovered,
  focus,
  homeToken,
  onHover,
  onSelect,
}: CitySceneProps) {
  const home = useMemo(() => homeFor(layout), [layout]);
  const fog = useMemo(
    () => ({ color: PALETTE.fog, near: home.distance * 0.8, far: home.distance * 2.3 }),
    [home],
  );
  // a press that turned into an orbit drag must not count as "clicked the sky"
  const missPress = useRef<{ x: number; y: number } | null>(null);

  return (
    <Canvas
      dpr={[1, 1.8]}
      camera={{ position: [home.pos.x, home.pos.y, home.pos.z], fov: 42, near: 2, far: 12000 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(PALETTE.skyBottom);
      }}
      onPointerDown={(e) => {
        missPress.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMissed={(e) => {
        const p = missPress.current;
        missPress.current = null;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) return;
        onSelect(null);
      }}
    >
      <fog attach="fog" args={[fog.color, fog.near, fog.far]} />
      <Sky />
      <Stars />
      <Moon />
      <ambientLight intensity={0.5} />
      {/* the only light in the scene: it shades the trees and the monument,
          everything else is unlit shaders */}
      <hemisphereLight args={["#3d5c8c", "#0a0f18", 2.1]} />
      <Ground layout={layout} />
      <Roads layout={layout} />
      <Roundabout layout={layout} />
      <Traffic layout={layout} />
      <Trees layout={layout} />
      <Buildings layout={layout} onHover={onHover} onSelect={onSelect} fog={fog} />
      <SelectionMarker building={selected} />
      <HoverMarker building={hovered} />
      <Rig focus={focus} homeToken={homeToken} home={home} />
    </Canvas>
  );
}
