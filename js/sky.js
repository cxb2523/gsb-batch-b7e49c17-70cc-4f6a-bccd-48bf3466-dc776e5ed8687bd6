// Sky dome, sun, moon and stars, plus rain and snow streaming past the camera.
import * as THREE from '../vendor/three.module.js';
import { atmoUniforms, ATMO_GLSL } from './atmo.js';

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
${ATMO_GLSL}
float hash31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyRadiance(d);
  // the sun's disc, reddened by the air it shines through
  vec3 tau = TAU_R * exp(-uCamAlt / H_R) + uMieBeta * H_M * exp(-uCamAlt / H_M);
  vec3 ext = exp(-tau * airmass(max(uSunDir.y, 0.0)));
  float c = dot(d, uSunDir);
  float disc = smoothstep(0.999957, 0.999985, c) * smoothstep(-0.012, 0.0, d.y);
  col += disc * uSunE * 420.0 * ext;
  if (uNight > 0.01) {
    float up = smoothstep(-0.02, 0.18, d.y);
    vec3 p = d * 170.0;
    vec3 id = floor(p), f = fract(p) - 0.5;
    float h = hash31(id);
    float star = step(0.9962, h) * smoothstep(0.30, 0.02, length(f)) * (0.25 + 4.0 * pow(hash31(id + 5.0), 6.0));
    col += uNight * up * star * vec3(0.045, 0.047, 0.055) * mix(vec3(1.0, 0.85, 0.7), vec3(0.8, 0.9, 1.0), hash31(id + 9.0));
    float cm = dot(d, uMoonDir);
    col += uNight * smoothstep(0.99990, 0.99994, cm) * vec3(0.30, 0.31, 0.34);
    col += uNight * pow(max(cm, 0.0), 600.0) * vec3(0.006, 0.007, 0.009);
  }
  gl_FragColor = vec4(col, 9000.0);
}`;

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: SKY_FRAG,
    uniforms: { ...atmoUniforms },
    side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

// Rain or snow: a box of streaks around the eye, each drawn along the path the
// drop takes relative to the aircraft during one exposure.
export class Precipitation {
  constructor(count = 2600) {
    const pos = new Float32Array(count * 2 * 3), end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('end', new THREE.BufferAttribute(end, 1));
    this.uniforms = {
      uOffset: { value: new THREE.Vector3() }, uStreak: { value: new THREE.Vector3(0, -0.3, 0) },
      uAmount: { value: 0 }, uColor: { value: new THREE.Color(0.6, 0.65, 0.7) }, uBox: { value: 26 }, uNear: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true,   // the aircraft hides the drops behind it
      vertexShader: /* glsl */`
        attribute float end; uniform vec3 uOffset; uniform vec3 uStreak; uniform float uBox; uniform float uAmount; uniform float uNear;
        varying float vA;
        void main() {
          vec3 p = (fract(position + uOffset / uBox) - 0.5) * uBox;
          float keep = step(position.x * 0.37 + position.z * 0.63, uAmount);
          // none inside the cabin: from the cockpit the nearest drops fall beyond the glass
          vA = (1.0 - end * 0.7) * keep * smoothstep(uBox * 0.5, uBox * 0.3, length(p)) * smoothstep(uNear, uNear + 0.5, length(p));
          p += uStreak * end;
          gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA * 0.55); }`,
    });
    this.lines = new THREE.LineSegments(geom, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 50;
    this.lines.visible = false;
  }
  // rel: velocity of the drops relative to the camera, in scene axes (m/s)
  // near: no drops closer than this to the eye (m), the cabin's reach in cockpit view
  update(dt, rel, amount, snow, light, near = 0) {
    const u = this.uniforms;
    u.uNear.value = near;
    this.lines.visible = amount > 0.01;
    if (!this.lines.visible) return;
    u.uOffset.value.addScaledVector(rel, dt);
    const exposure = snow ? 0.012 : 0.028;
    u.uStreak.value.copy(rel).multiplyScalar(exposure);
    u.uAmount.value = amount;
    const b = snow ? 1.6 : 0.9;
    u.uColor.value.setRGB((0.25 + light.r) * b * 0.5, (0.27 + light.g) * b * 0.5, (0.3 + light.b) * b * 0.5);
  }
}
