import { describe, expect, it } from "vitest";
import type { TextureSource } from "../src/backend.js";
import { Draw } from "../src/draw.js";
import { WebGL2Backend } from "../src/webgl2.js";

/**
 * A recording stand-in for WebGL2: every method is logged, `create*` returns a fresh tagged object, so tests
 * can reconstruct what the vertex shaders would do with the uploaded instance data without a real GPU.
 */
function fakeGL() {
  const calls: { name: string; args: unknown[] }[] = [];
  const listeners = new Map<string, (e: Event) => void>();
  const canvas = {
    addEventListener: (type: string, fn: (e: Event) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const locations = new Map<string, { name: string }>();
  const target: Record<string | symbol, unknown> = {
    canvas,
    drawingBufferWidth: 100,
    drawingBufferHeight: 50,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    getParameter: (p: unknown) => (p === "MAX_TEXTURE_SIZE" ? 16384 : undefined),
    getUniformLocation: (_program: unknown, name: string) => {
      let loc = locations.get(name);
      if (!loc) {
        loc = { name };
        locations.set(name, loc);
      }
      return loc;
    },
    shaderSource: () => {},
  };
  const gl = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (typeof key !== "string") return undefined;
      if (/^[A-Z0-9_]+$/.test(key)) return key; // constants: their own name
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        if (key.startsWith("create")) return { kind: key.slice(6), deleted: false };
        if (key.startsWith("delete")) (args[0] as { deleted: boolean }).deleted = true;
        return undefined;
      };
    },
  });
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

const image = (w = 16, h = 16) => ({ width: w, height: h }) as unknown as TextureSource;
const roundHalf = (v: number) => Math.floor(v + 0.5);

/** The calls of one instanced draw: the GL operations since the previous draw call. */
function drawGroup(calls: { name: string; args: unknown[] }[], index: number) {
  const bounds = calls
    .map((c, i) => (c.name === "drawArraysInstanced" ? i : -1))
    .filter((i) => i >= 0);
  const start = index === 0 ? 0 : (bounds[index - 1] as number) + 1;
  const end = bounds[index] as number;
  return calls.slice(start, end);
}

type Uniforms = Record<string, number[]>;

/** Uniform values set inside one draw group, keyed by the location's name. */
function uniforms(group: { name: string; args: unknown[] }[]): Uniforms {
  const out: Uniforms = {};
  for (const c of group) {
    const loc = c.args[0] as { name?: string } | null;
    if (!loc?.name || !c.name.startsWith("uniform")) continue;
    out[loc.name] = c.args.slice(1).map(Number);
  }
  return out;
}

/** Attribute location -> the array uploaded to its buffer, replaying the group's bind/upload/pointer calls. */
function attributes(group: { name: string; args: unknown[] }[]): Map<number, Float32Array> {
  let bound: Float32Array | undefined;
  const data = new Map<number, Float32Array>();
  for (const c of group) {
    if (c.name === "bindBuffer") bound = undefined;
    if (c.name === "bufferData" && c.args[1] instanceof Float32Array) bound = c.args[1] as Float32Array;
    if ((c.name === "vertexAttribPointer" || c.name === "vertexAttribIPointer") && bound) {
      data.set(c.args[0] as number, bound);
    }
  }
  return data;
}

/**
 * The COPY_VERT landing of copy `i` (plain `draw.sprites`, shared options): the unit square's origin
 * transformed by the batch's linear part, then rounded exactly as the shader does when `u_snap` is on.
 */
function copyLanding(u: Uniforms, pos: Float32Array, i: number): [number, number] {
  const [a, b, c, d] = u.u_linear as number[];
  const [ox, oy] = u.u_origin as number[];
  const x = pos[i * 2] as number;
  const y = pos[i * 2 + 1] as number;
  let ex = ox + a * x + c * y;
  let ey = oy + b * x + d * y;
  if ((u.u_snap?.[0] ?? 0) > 0.5) {
    ex = roundHalf(ex);
    ey = roundHalf(ey);
  }
  return [ex, ey];
}

/**
 * The EACH_VERT landing of copy `i` (`draw.sprites` with per-copy scale/rotation), including the scaled
 * anchor offset, and the shader's per-copy `r == 0.0` snap decision.
 */
function eachLanding(
  u: Uniforms,
  attr: Map<number, Float32Array>,
  i: number,
  w: number,
  h: number,
): { e: [number, number]; snapped: boolean } {
  const [a, b, c, d] = u.u_linear as number[];
  const [mtx, mty] = u.u_mt as number[];
  const [uox, uoy] = u.u_origin as number[];
  const [usx, usy] = u.u_scale as number[];
  const rot = u.u_rot?.[0] ?? 0;
  const pos = attr.get(1) as Float32Array;
  const scales = attr.get(2);
  const rots = attr.get(3);
  const sizes = attr.get(6);
  const ax = pos[i * 2] as number;
  const ay = pos[i * 2 + 1] as number;
  const perScale = scales ? (scales[i] as number) : 1;
  const perRot = rots ? (rots[i] as number) : 0;
  const sx = usx * perScale;
  const sy = usy * perScale;
  const r = rot + perRot;
  const sizeX = sizes ? (sizes[i * 2] as number) : w;
  const sizeY = sizes ? (sizes[i * 2 + 1] as number) : h;
  const offsetX = -uox * sizeX;
  const offsetY = -uoy * sizeY;
  // r == 0 keeps the basis axis-aligned: l = a_pos + (s * offset) in local space.
  const lx = sx * offsetX + ax;
  const ly = sy * offsetY + ay;
  let ex = a * lx + c * ly + mtx;
  let ey = b * lx + d * ly + mty;
  const snapped = (u.u_snap?.[0] ?? 0) > 0.5 && r === 0;
  if (snapped) {
    ex = roundHalf(ex);
    ey = roundHalf(ey);
  }
  return { e: [ex, ey], snapped };
}

/** What the single-sprite VERT path uploaded for sprite `i` in the last `bufferSubData`. */
function spriteInstances(calls: { name: string; args: unknown[] }[]): Float32Array {
  const sub = calls.findLast((c) => c.name === "bufferSubData") as { args: unknown[] };
  return sub.args[2] as Float32Array;
}

const isInt = (v: number) => Number.isInteger(v);

describe("whole-pixel rule across sprite(), sprites() and replay()", () => {
  describe("plain sprites() (COPY_VERT)", () => {
    it("snaps the scaled landing, not the unscaled anchor, at 0.5x and 2x", () => {
      for (const scale of [0.5, 2]) {
        const { gl, calls } = fakeGL();
        const draw = new Draw(new WebGL2Backend(gl), false);
        draw.begin("#000", 100, 50, 1);
        // A fractional parent translation, so a naïve anchor round would land somewhere else.
        draw.translate(0.3, 0.7);
        const pos = new Float32Array([10.4, 20.6]);
        draw.sprites(image(), pos, 1, { scaleX: scale, scaleY: scale, origin: [0, 0] });
        draw.end();
        const group = drawGroup(calls, 0);
        const u = uniforms(group);
        const upload = group.find((c) => c.name === "bufferData" && c.args[1] === pos) as { args: unknown[] };
        expect(upload).toBeDefined();
        expect(u.u_snap?.[0]).toBe(1);
        const [ex, ey] = copyLanding(u, pos, 0);
        // Single sprite() under the same options: its CPU-rounded instance position is the reference.
        const ref = fakeGL();
        const d2 = new Draw(new WebGL2Backend(ref.gl), false);
        d2.begin("#000", 100, 50, 1);
        d2.translate(0.3, 0.7);
        d2.sprite(image(), 10.4, 20.6, { scaleX: scale, scaleY: scale, origin: [0, 0] });
        d2.end();
        const inst = spriteInstances(ref.calls);
        expect([ex, ey]).toEqual([inst[0], inst[1]]);
        expect(isInt(ex) && isInt(ey)).toBe(true);
      }
    });

    it("leaves smooth copies unsnapped even with no rotation", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), true); // smooth default on
      draw.begin("#000", 100, 50, 1);
      draw.translate(0.3, 0.7);
      const pos = new Float32Array([10.4, 20.6]);
      draw.sprites(image(), pos, 1, { scaleX: 0.5, origin: [0, 0] });
      draw.end();
      const u = uniforms(drawGroup(calls, 0));
      expect(u.u_snap?.[0]).toBe(0);
      const [ex, ey] = copyLanding(u, pos, 0);
      expect(isInt(ex) || isInt(ey)).toBe(false);
    });
  });

  describe("sprites() with each (EACH_VERT)", () => {
    it("snaps the zero-rotation copy's scaled landing and leaves the rotated copy alone", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), false);
      draw.begin("#000", 100, 50, 1);
      draw.translate(0.3, 0.7);
      const pos = new Float32Array([10.4, 20.6, 30.4, 40.6]);
      const rot = new Float32Array([0, 0.5]);
      draw.sprites(image(), pos, 2, { scaleX: 0.5, scaleY: 2, origin: [0, 0] }, { rotation: rot });
      draw.end();
      const group = drawGroup(calls, 0);
      const u = uniforms(group);
      const attr = attributes(group);
      expect(u.u_snap?.[0]).toBe(1); // the transform is rotation-free; each copy decides on its own r
      const zero = eachLanding(u, attr, 0, 16, 16);
      const turned = eachLanding(u, attr, 1, 16, 16);
      expect(zero.snapped).toBe(true);
      expect(turned.snapped).toBe(false);
      expect(isInt(zero.e[0]) && isInt(zero.e[1])).toBe(true);
      expect(isInt(turned.e[0]) && isInt(turned.e[1])).toBe(false);
      // The snapped copy matches what a lone sprite() with the same scale lands on.
      const ref = fakeGL();
      const d2 = new Draw(new WebGL2Backend(ref.gl), false);
      d2.begin("#000", 100, 50, 1);
      d2.translate(0.3, 0.7);
      d2.sprite(image(), 10.4, 20.6, { scaleX: 0.5, scaleY: 2, origin: [0, 0] });
      d2.end();
      const inst = spriteInstances(ref.calls);
      expect(zero.e).toEqual([inst[0], inst[1]]);
    });

    it("snaps each zero-rotation copy's scaled landing at 0.5x and 2x, like a lone sprite()", () => {
      for (const scale of [0.5, 2]) {
        const { gl, calls } = fakeGL();
        const draw = new Draw(new WebGL2Backend(gl), false);
        draw.begin("#000", 100, 50, 1);
        draw.translate(0.3, 0.7);
        const pos = new Float32Array([10.4, 20.6]);
        const scales = new Float32Array([scale]);
        draw.sprites(image(), pos, 1, { origin: [0, 0] }, { scale: scales });
        draw.end();
        const group = drawGroup(calls, 0);
        const u = uniforms(group);
        const attr = attributes(group);
        const got = eachLanding(u, attr, 0, 16, 16);
        expect(got.snapped).toBe(true);
        expect(isInt(got.e[0]) && isInt(got.e[1])).toBe(true);
        // The same call made one sprite at a time through sprite() lands on the same whole pixels.
        const ref = fakeGL();
        const d2 = new Draw(new WebGL2Backend(ref.gl), false);
        d2.begin("#000", 100, 50, 1);
        d2.translate(0.3, 0.7);
        d2.sprite(image(), 10.4, 20.6, { scaleX: scale, scaleY: scale, origin: [0, 0] });
        d2.end();
        const inst = spriteInstances(ref.calls);
        expect(got.e).toEqual([inst[0], inst[1]]);
      }
    });

    it("never snaps a copy when the sprites are smooth", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), false);
      draw.begin("#000", 100, 50, 1);
      draw.translate(0.3, 0.7);
      const pos = new Float32Array([10.4, 20.6]);
      // each.scale forces the EACH program; a smooth sprite must still leave u_snap off.
      draw.sprites(image(), pos, 1, { smooth: true, scaleX: 2, origin: [0, 0] }, { scale: new Float32Array([1]) });
      draw.end();
      const group = drawGroup(calls, 0);
      const u = uniforms(group);
      const attr = attributes(group);
      expect(u.u_snap?.[0]).toBe(0);
      expect(eachLanding(u, attr, 0, 16, 16).snapped).toBe(false);
    });

    it("a shared rotation keeps every copy unsnapped, matching sprite()", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), false);
      draw.begin("#000", 100, 50, 1);
      draw.translate(0.3, 0.7);
      const pos = new Float32Array([10.4, 20.6, 30, 40]);
      // each.color routes this through the EACH program while the rotation stays shared on u_rot.
      const color = new Uint32Array([0xffffffff, 0xffffffff]);
      draw.sprites(image(), pos, 2, { rotation: 0.25, origin: [0, 0] }, { color });
      draw.end();
      const group = drawGroup(calls, 0);
      const u = uniforms(group);
      const attr = attributes(group);
      for (let i = 0; i < 2; i++) expect(eachLanding(u, attr, i, 16, 16).snapped).toBe(false);
    });
  });

  describe("single sprite() (VERT, CPU-rounded)", () => {
    it("rounds the post-scale landing for unrotated pixel art and flags it PLACED", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), false);
      draw.begin("#000", 100, 50, 1);
      draw.translate(0.3, 0.7);
      draw.sprite(image(), 10.4, 20.6, { scaleX: 0.5, scaleY: 2, origin: [0, 0] });
      draw.end();
      const inst = spriteInstances(calls);
      // lx = 10.4, ly = 20.6 (origin [0,0] leaves the anchor untouched); e = l + (0.3, 0.7) = (10.7, 21.3) -> 11, 21.
      expect([inst[0], inst[1]]).toEqual([11, 21]);
      expect(inst[12]).toBe(48); // unit 0 + SPRITE (16) + PLACED (32), no SNAP
      expect(isInt(inst[0]) && isInt(inst[1])).toBe(true);
    });

    it("keeps the raw position for rotated and for smooth sprites, without PLACED", () => {
      const rotated = fakeGL();
      const d1 = new Draw(new WebGL2Backend(rotated.gl), false);
      d1.begin("#000", 100, 50, 1);
      d1.translate(0.3, 0.7);
      d1.sprite(image(), 10.4, 20.6, { rotation: 0.5, scaleX: 0.5, origin: [0, 0] });
      d1.end();
      const r = spriteInstances(rotated.calls);
      expect(r[12] & 32).toBe(0);
      expect([r[0], r[1]].map((v) => Math.round(v * 1000) / 1000)).toEqual([10.4, 20.6]);

      const smooth = fakeGL();
      const d2 = new Draw(new WebGL2Backend(smooth.gl), true);
      d2.begin("#000", 100, 50, 1);
      d2.translate(0.3, 0.7);
      d2.sprite(image(), 10.4, 20.6, { scaleX: 2, origin: [0, 0] });
      d2.end();
      const s = spriteInstances(smooth.calls);
      expect(s[12] & 32).toBe(0);
      expect([s[0], s[1]].map((v) => Math.round(v * 1000) / 1000)).toEqual([10.4, 20.6]);
    });
  });

  describe("layer replay()", () => {
    const content = (d: Draw) => {
      d.sprite(image(), 10.4, 20.6, { origin: [0, 0] });
      d.sprite(image(), 5.25, 7.75, { origin: [0, 0] });
    };

    it("batches a layer with no per-sprite scale or rotation into static instance buffers", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), false);
      draw.begin("#000", 100, 50, 1);
      const layer = draw.record(content);
      calls.length = 0;
      draw.translate(0.3, 0.7);
      draw.replay(layer);
      draw.end();
      const staticUploads = calls.filter((c) => c.name === "bufferData" && c.args[2] === "STATIC_DRAW");
      expect(staticUploads.length).toBeGreaterThan(0);
      // The replay itself uploads no dynamic instance data: the shader snaps the baked SNAP instances.
      expect(calls.some((c) => c.name === "bufferSubData")).toBe(false);
      const data = new Float32Array(staticUploads[0]?.args[1] as ArrayBuffer);
      for (let i = 0; i < layer.size; i++) {
        const flags = data[i * 14 + 12] as number;
        expect(flags & 64).toBe(64); // SNAP: unrotated, non-smooth
      }
      // And the replay transform is marked rotation-free so the shader is allowed to snap.
      const snapOk = calls.filter((c) => c.name === "uniform1f").map((c) => c.args.slice(1));
      expect(snapOk).toContainEqual([1]);
    });

    it("falls back to one-by-one replay when a recorded sprite carries scale, and matches direct draws", () => {
      for (const opts of [
        { scaleX: 0.5, scaleY: 2, origin: [0, 0] as const },
        { scaleX: 2, scaleY: 2, origin: [0, 0] as const },
        { rotation: 0.5 },
      ]) {
        const f = fakeGL();
        const draw = new Draw(new WebGL2Backend(f.gl), false);
        draw.begin("#000", 100, 50, 1);
        const layer = draw.record((d) => {
          d.sprite(image(), 10.4, 20.6, opts);
          d.sprite(image(), 5, 7);
        });
        f.calls.length = 0;
        draw.translate(0.3, 0.7);
        draw.replay(layer);
        draw.end();
        // No baked layer buffer: the recorded scale/rotation forced the per-item path.
        expect(f.calls.some((c) => c.name === "bufferData" && c.args[2] === "STATIC_DRAW")).toBe(false);
        const replayed = spriteInstances(f.calls);

        const g = fakeGL();
        const direct = new Draw(new WebGL2Backend(g.gl), false);
        direct.begin("#000", 100, 50, 1);
        direct.translate(0.3, 0.7);
        direct.sprite(image(), 10.4, 20.6, opts);
        direct.sprite(image(), 5, 7);
        direct.end();
        const expected = spriteInstances(g.calls);
        expect(Array.from(replayed)).toEqual(Array.from(expected));
      }
    });

    it("still batches a flipped sprite: a flip is only a negative scale folded into the basis", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), false);
      draw.begin("#000", 100, 50, 1);
      const layer = draw.record((d) => {
        d.sprite(image(), 10, 20, { flipX: true, origin: [0, 0] });
      });
      calls.length = 0;
      draw.replay(layer);
      draw.end();
      expect(calls.some((c) => c.name === "bufferData" && c.args[2] === "STATIC_DRAW")).toBe(true);
    });

    it("a smooth recorded sprite keeps its filtering through the batched replay, without SNAP", () => {
      const { gl, calls } = fakeGL();
      const draw = new Draw(new WebGL2Backend(gl), false);
      draw.begin("#000", 100, 50, 1);
      const layer = draw.record((d) => {
        d.sprite(image(), 10.4, 20.6, { smooth: true, origin: [0, 0] });
        d.sprite(image(), 5, 7, { origin: [0, 0] });
      });
      calls.length = 0;
      draw.replay(layer);
      draw.end();
      const staticUploads = calls.filter((c) => c.name === "bufferData" && c.args[2] === "STATIC_DRAW");
      expect(staticUploads.length).toBeGreaterThan(0);
      const data = new Float32Array(staticUploads[0]?.args[1] as ArrayBuffer);
      expect(data[12] & 64).toBe(0); // smooth sprite: no SNAP
      expect(data[14 + 12] & 64).toBe(64); // pixel sprite: SNAP
    });
  });
});
