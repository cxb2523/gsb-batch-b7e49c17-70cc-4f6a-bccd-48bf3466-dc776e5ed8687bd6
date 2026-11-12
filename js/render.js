// Frame pipeline, all in linear HDR:
//   1. the world (sky + terrain), writing view distance into alpha
//   2. clouds, raymarched at reduced resolution up to that distance
//   3. composite, then the aircraft and cockpit drawn on top with their own depth range
//   4. exposure, filmic tone curve, display encoding
import * as THREE from '../vendor/three.module.js';
import { QUAD_VERT } from './clouds.js';

const COMPOSITE = /* glsl */`
precision highp float;
uniform sampler2D uScene; uniform sampler2D uCloud; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 s = texture2D(uScene, vUv).rgb;
  // the cloud buffer is small and its march is dithered: a 3x3 tent filter turns the dither into smooth cloud
  vec4 c = texture2D(uCloud, vUv) * 0.25;
  c += (texture2D(uCloud, vUv + vec2(uTexel.x, 0.0)) + texture2D(uCloud, vUv - vec2(uTexel.x, 0.0))
      + texture2D(uCloud, vUv + vec2(0.0, uTexel.y)) + texture2D(uCloud, vUv - vec2(0.0, uTexel.y))) * 0.125;
  c += (texture2D(uCloud, vUv + uTexel) + texture2D(uCloud, vUv - uTexel)
      + texture2D(uCloud, vUv + vec2(uTexel.x, -uTexel.y)) + texture2D(uCloud, vUv + vec2(-uTexel.x, uTexel.y))) * 0.0625;
  gl_FragColor = vec4(s * c.a + c.rgb, 1.0);
}`;

const FINAL = /* glsl */`
precision highp float;
uniform sampler2D uTex; uniform float uExposure; uniform float uFade; uniform float uGrey; varying vec2 vUv;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = max(texture2D(uTex, vUv).rgb, 0.0) * uExposure;
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.28 * dot(q, q);
  c = aces(c * 0.82);
  c = mix(c, vec3(dot(c, vec3(0.3, 0.55, 0.15))), uGrey);
  c = pow(c, vec3(1.0 / 2.2));
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(c * uFade + (n - 0.5) / 255.0, 1.0);
}`;

export class Pipeline {
  constructor(renderer, clouds) {
    this.r = renderer;
    this.clouds = clouds;
    renderer.autoClear = false;
    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: true });
    this.rtCloud = new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: false });
    this.rtComp = new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: true, samples: 4 });
    this.composite = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
      uniforms: { uScene: { value: this.rtScene.texture }, uCloud: { value: this.rtCloud.texture }, uTexel: { value: new THREE.Vector2() } },
    });
    this.final = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: FINAL, depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: this.rtComp.texture }, uExposure: { value: 1 }, uFade: { value: 1 }, uGrey: { value: 0 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.cloudScale = 0.42;
  }
  setSize(w, h) {
    this.rtScene.setSize(w, h);
    this.rtComp.setSize(w, h);
    const cw = Math.max(2, Math.round(w * this.cloudScale)), ch = Math.max(2, Math.round(h * this.cloudScale));
    this.rtCloud.setSize(cw, ch);
    this.composite.uniforms.uTexel.value.set(1.5 / cw, 1.5 / ch);   // taps between texels: each one is already a 2x2 average
  }
  render(world, worldCam, near, nearCam, exposure, fade = 1, grey = 0) {
    const r = this.r;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(world, worldCam);

    this.clouds.uniforms.uScene.value = this.rtScene.texture;
    this.quad.material = this.clouds.material;
    r.setRenderTarget(this.rtCloud);
    r.render(this.quadScene, this.quadCam);

    this.quad.material = this.composite;
    r.setRenderTarget(this.rtComp);
    r.clear();
    r.render(this.quadScene, this.quadCam);
    r.clearDepth();
    r.render(near, nearCam);

    this.final.uniforms.uExposure.value = exposure;
    this.final.uniforms.uFade.value = fade;
    this.final.uniforms.uGrey.value = grey;
    this.quad.material = this.final;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
