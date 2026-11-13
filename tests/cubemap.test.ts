// Automated verification of the cubemap six-face orientation convention and
// the pure coordinate math used by the texture preview.
//
// Run with: npm test
// (Node's built-in test runner; no browser or WebGL context required because
// the shader's getCubemapUv is generated from the same FACE_TABLE that the JS
// query functions evaluate.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    FACE_COUNT,
    FACE_LABELS,
    FACE_NORMALS,
    MIN_SCALE,
    MAX_SCALE,
    NotACubemapError,
    buildCubemapUvGLSL,
    cubemapDirection,
    queryCubemapDirection,
    pixelToUv,
    uvToPixel,
    clampScale,
    clampOffset
} from '../src/cubemap.ts';

// A locally constructed 4x4 cubemap: six faces of 4x4 RGBA texels. The pixel
// values themselves are placeholders; every check below samples direction
// vectors at the texel-center uvs of this data, exactly as the preview would.
const CUBE_SIZE = 4;
const CHANNELS = 4;

const makeCubemapData = (): Uint8Array[] => {
    const faces: Uint8Array[] = [];
    for (let face = 0; face < FACE_COUNT; ++face) {
        const data = new Uint8Array(CUBE_SIZE * CUBE_SIZE * CHANNELS);
        for (let i = 0; i < data.length; i += CHANNELS) {
            data[i] = (face * 40 + 32) & 0xff; // r: unique per face
            data[i + 1] = ((i / CHANNELS) * 17) & 0xff; // g: varies per texel
            data[i + 2] = 128; // b
            data[i + 3] = 255; // a
        }
        faces.push(data);
    }
    return faces;
};

// Texel-center uv in face-local GL convention (bottom-left origin).
const texelCenterUv = (col: number, rowBottom: number): { u: number; v: number } => ({
    u: (col + 0.5) / CUBE_SIZE,
    v: (rowBottom + 0.5) / CUBE_SIZE
});

const EPS = 1e-12;

const approxEqualVec = (
    a: { x: number; y: number; z: number },
    b: readonly [number, number, number] | { x: number; y: number; z: number },
    epsilon = EPS
): void => {
    const bx = Array.isArray(b) ? b[0] : b.x;
    const by = Array.isArray(b) ? b[1] : b.y;
    const bz = Array.isArray(b) ? b[2] : b.z;
    assert.ok(Math.abs(a.x - bx) <= epsilon, `x ${a.x} != ${bx}`);
    assert.ok(Math.abs(a.y - by) <= epsilon, `y ${a.y} != ${by}`);
    assert.ok(Math.abs(a.z - bz) <= epsilon, `z ${a.z} != ${bz}`);
};

const length3 = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z);

const dot3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
    a.x * b.x + a.y * b.y + a.z * b.z;

const cross3 = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
): { x: number; y: number; z: number } => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
});

test('face metadata covers the six signed axes in engine order', () => {
    assert.equal(FACE_COUNT, 6);
    assert.deepEqual([...FACE_LABELS], ['+x', '-x', '+y', '-y', '+z', '-z']);
    assert.deepEqual(
        FACE_NORMALS.map((n) => n.join(',')),
        ['1,0,0', '-1,0,0', '0,1,0', '0,-1,0', '0,0,1', '0,0,-1']
    );
});

test('face center uvs produce the six mutually orthogonal unit axis directions', () => {
    const cubemap = makeCubemapData();
    assert.equal(cubemap.length, 6);
    assert.equal(cubemap[0].length, CUBE_SIZE * CUBE_SIZE * CHANNELS);

    const centers = FACE_NORMALS.map((_, face) => {
        // center texel of a 4x4 face: cols/rows 1 and 2 share the center;
        // use the midpoint uv (0.5, 0.5) directly.
        const dir = cubemapDirection(face, { u: 0.5, v: 0.5 });
        assert.ok(Math.abs(length3(dir) - 1) <= EPS, `face ${face} center is not unit`);
        return dir;
    });

    // each center equals its face's signed major-axis normal
    centers.forEach((dir, face) => approxEqualVec(dir, FACE_NORMALS[face]));

    // all non-opposite face centers are pairwise orthogonal
    for (let i = 0; i < centers.length; ++i) {
        for (let j = i + 1; j < centers.length; ++j) {
            const opposite = (i ^ 1) === j;
            if (opposite) {
                // opposite faces are parallel but point opposite ways
                assert.ok(Math.abs(dot3(centers[i], centers[j]) + 1) <= EPS, `faces ${i},${j} not opposite`);
            } else {
                assert.ok(Math.abs(dot3(centers[i], centers[j])) <= EPS, `faces ${i},${j} not orthogonal`);
            }
        }
    }

    // opposite faces point in opposite directions
    for (let i = 0; i < 3; ++i) {
        approxEqualVec(centers[2 * i], [-centers[2 * i + 1].x, -centers[2 * i + 1].y, -centers[2 * i + 1].z]);
    }
});

test('every texel-center direction lies on the correct face plane', () => {
    const cubemap = makeCubemapData();
    for (let face = 0; face < FACE_COUNT; ++face) {
        assert.equal(cubemap[face].length, CUBE_SIZE * CUBE_SIZE * 4);
        const normal = FACE_NORMALS[face];
        for (let col = 0; col < CUBE_SIZE; ++col) {
            for (let row = 0; row < CUBE_SIZE; ++row) {
                const uv = texelCenterUv(col, row);
                const dir = cubemapDirection(face, uv);

                // the component matching the face normal stays fixed at +/-1,
                // i.e. the direction lies on the plane x=+/-1, y=+/-1 or z=+/-1
                const major = dir.x * normal[0] + dir.y * normal[1] + dir.z * normal[2];
                assert.ok(Math.abs(major - 1) <= EPS, `face ${face} (${col},${row}) off its plane`);

                // the two tangential components stay within the face bounds
                const tangential = [dir.x, dir.y, dir.z].filter((_, axis) => normal[axis] === 0);
                for (const value of tangential) {
                    assert.ok(Math.abs(value) <= 1 + EPS, `face ${face} (${col},${row}) tangent out of bounds`);
                }
            }
        }
    }

    // the face center is additionally a unit direction
    const center = cubemapDirection(0, { u: 0.5, v: 0.5 });
    assert.ok(Math.abs(length3(center) - 1) <= EPS);
});

test('adjacent faces agree on direction vectors along their shared edges', () => {
    // Sample a direction at an edge of one face and find the same physical
    // direction on an edge of another face. Every edge of the cube must be
    // covered exactly once by each of its two adjacent faces, so collect all
    // 24 face edges (6 faces x 4 edges), bucket their endpoint directions, and
    // require every bucket to contain exactly two faces.
    type Edge = { face: number; a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } };

    const edgeAt = (face: number, u0: number, v0: number, u1: number, v1: number): Edge => ({
        face,
        a: cubemapDirection(face, { u: u0, v: v0 }),
        b: cubemapDirection(face, { u: u1, v: v1 })
    });

    const edges: Edge[] = [];
    for (let face = 0; face < FACE_COUNT; ++face) {
        edges.push(edgeAt(face, 0, 0, 0, 1)); // left
        edges.push(edgeAt(face, 1, 0, 1, 1)); // right
        edges.push(edgeAt(face, 0, 0, 1, 0)); // bottom
        edges.push(edgeAt(face, 0, 1, 1, 1)); // top
    }
    assert.equal(edges.length, 24);

    const keyOf = (v: { x: number; y: number; z: number }): string =>
        `${v.x.toFixed(9)},${v.y.toFixed(9)},${v.z.toFixed(9)}`;

    const sameDir = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean =>
        Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS && Math.abs(a.z - b.z) <= EPS;

    // check every edge against all edges of other faces: each must find its
    // counterpart, and the shared endpoints must match (in either order)
    let matchedPairs = 0;
    for (let i = 0; i < edges.length; ++i) {
        const e = edges[i];
        let counterpart: Edge | null = null;
        for (let j = 0; j < edges.length; ++j) {
            const o = edges[j];
            if (o.face === e.face) {
                continue;
            }
            const direct = sameDir(e.a, o.a) && sameDir(e.b, o.b);
            const reversed = sameDir(e.a, o.b) && sameDir(e.b, o.a);
            if (direct || reversed) {
                counterpart = o;
                break;
            }
        }
        assert.ok(counterpart, `face ${e.face} edge ${keyOf(e.a)} -> ${keyOf(e.b)} has no matching neighbor`);
        if (counterpart && counterpart.face > e.face) {
            matchedPairs++;
        }
    }
    // 12 cube edges, each represented by one pair of face edges
    assert.equal(matchedPairs, 12);
});

test('face parameterization has consistent handedness (no mirrored or flipped face)', () => {
    // For a correct right-handed cube mapping, increasing u and v on every face
    // must sweep the tangent space with the same winding: cross(d/du, d/dv)
    // points opposite the face normal. A mirrored or upside-down face flips
    // this sign for that face.
    const du = 1e-6;
    for (let face = 0; face < FACE_COUNT; ++face) {
        const p0 = cubemapDirection(face, { u: 0.5 - du, v: 0.5 });
        const p1 = cubemapDirection(face, { u: 0.5 + du, v: 0.5 });
        const q0 = cubemapDirection(face, { u: 0.5, v: 0.5 - du });
        const q1 = cubemapDirection(face, { u: 0.5, v: 0.5 + du });

        const tangentU = { x: (p1.x - p0.x) / (2 * du), y: (p1.y - p0.y) / (2 * du), z: (p1.z - p0.z) / (2 * du) };
        const tangentV = { x: (q1.x - q0.x) / (2 * du), y: (q1.y - q0.y) / (2 * du), z: (q1.z - q0.z) / (2 * du) };
        const winding = cross3(tangentU, tangentV);
        const normal = FACE_NORMALS[face];
        const sign = winding.x * normal[0] + winding.y * normal[1] + winding.z * normal[2];
        assert.ok(sign < 0, `face ${face} (${FACE_LABELS[face]}) has reversed winding`);
    }
});

test('queryCubemapDirection applies the same v flip as the shader and matches face normals', () => {
    // The preview feeds getCubemapUv(uv.x, 1 - uv.y); the query entry mirrors
    // that flip, so a top-left-origin center uv still resolves to the normal.
    for (let face = 0; face < FACE_COUNT; ++face) {
        const dir = queryCubemapDirection(true, face, { u: 0.5, v: 0.5 });
        approxEqualVec(dir, FACE_NORMALS[face]);
    }

    // explicit equivalence with the unflipped primitive
    const preview = queryCubemapDirection(true, FACE_COUNT - 1, { u: 0.25, v: 0.7 });
    const primitive = cubemapDirection(FACE_COUNT - 1, { u: 0.25, v: 1 - 0.7 });
    approxEqualVec(preview, [primitive.x, primitive.y, primitive.z]);
});

test('2D texture face query throws an explicit error instead of returning a direction', () => {
    assert.throws(
        () => queryCubemapDirection(false, 0, { u: 0.5, v: 0.5 }),
        (err: unknown) => err instanceof NotACubemapError
    );

    // an out-of-range face is also an explicit error rather than a fallback
    assert.throws(() => queryCubemapDirection(true, -1, { u: 0.5, v: 0.5 }), RangeError);
    assert.throws(() => queryCubemapDirection(true, 6, { u: 0.5, v: 0.5 }), RangeError);
    assert.throws(() => queryCubemapDirection(true, 1.5, { u: 0.5, v: 0.5 }), RangeError);
});

test('pixelToUv is pure screen math matching the shader formula, and round-trips', () => {
    const scale = 2;
    const texWidth = 64;
    const texHeight = 32;
    // square viewport matching the scaled texture height so boundary uvs are exact
    const viewportHeight = scale * texHeight;

    // with zero offset, the top-left viewport pixel has fragY = viewportHeight,
    // i.e. shader v = 1; the top-left-origin return value flips that to 0.
    const tl = pixelToUv(0, 0, 0, 0, scale, texWidth, texHeight, viewportHeight);
    assert.ok(Math.abs(tl.u - 0) <= EPS);
    assert.ok(Math.abs(tl.v - 0) <= EPS);

    // bottom-left viewport pixel has fragY = 0 (shader v = 0) -> flipped v = 1
    const bl = pixelToUv(0, viewportHeight, 0, 0, scale, texWidth, texHeight, viewportHeight);
    assert.ok(Math.abs(bl.u - 0) <= EPS);
    assert.ok(Math.abs(bl.v - 1) <= EPS);

    // a midpoint pixel with a non-zero offset, computed by hand
    const offsetX = 10;
    const offsetY = -20;
    const uv = pixelToUv(30, 50, offsetX, offsetY, scale, texWidth, texHeight, viewportHeight);
    assert.ok(Math.abs(uv.u - (30 - 10) / 2 / 64) <= EPS);
    // fragY = viewportHeight - 50, shader v = (fragY - offsetY) / scale / texHeight,
    // and the returned value applies the top-left origin flip
    const expectedV = 1 - (viewportHeight - 50 - offsetY) / scale / texHeight;
    assert.ok(Math.abs(uv.v - expectedV) <= EPS);

    // round trip through the inverse mapping
    const px = uvToPixel(uv, offsetX, offsetY, scale, texWidth, texHeight, viewportHeight);
    assert.ok(Math.abs(px.x - 30) <= EPS);
    assert.ok(Math.abs(px.y - 50) <= EPS);
});

test('pixelToUv feeds directly into the cubemap direction query', () => {
    // center of a 4x4 face drawn at scale 8 with zero offset in a square
    // viewport must resolve to the face normal.
    const scale = 8;
    const viewport = 32;
    const centerPixel = pixelToUv(16, 16, 0, 0, scale, 4, 4, viewport);
    assert.ok(Math.abs(centerPixel.u - 0.5) <= EPS);
    assert.ok(Math.abs(centerPixel.v - 0.5) <= EPS);
    for (let face = 0; face < FACE_COUNT; ++face) {
        approxEqualVec(queryCubemapDirection(true, face, centerPixel), FACE_NORMALS[face]);
    }
});

test('scale is clamped to [0.2, 100]', () => {
    assert.equal(MIN_SCALE, 0.2);
    assert.equal(MAX_SCALE, 100);
    assert.equal(clampScale(0), MIN_SCALE);
    assert.equal(clampScale(0.19), MIN_SCALE);
    assert.equal(clampScale(50), 50);
    assert.equal(clampScale(1000), MAX_SCALE);
});

test('clampOffset keeps the texture inside the viewport and centers it when smaller', () => {
    // texture larger than viewport: offset pinned to [-diff, 0]
    assert.equal(clampOffset(50, 200, 100), 0);
    assert.equal(clampOffset(-500, 200, 100), -100);
    assert.equal(clampOffset(-40, 200, 100), -40);

    // texture smaller than viewport: centered (offset = -(viewport-size)/2)
    assert.equal(clampOffset(999, 60, 100), 20);
    assert.equal(clampOffset(-999, 60, 100), 20);

    // exactly fits: no slack
    assert.equal(clampOffset(5, 100, 100), 0);
});

test('generated GLSL implements the same mapping as the JS query table', () => {
    const glsl = buildCubemapUvGLSL();
    // faces 0..4 are conditional branches; face 5 is the final else fallback
    for (let face = 0; face < FACE_COUNT - 1; ++face) {
        assert.ok(glsl.includes(`face == ${face}.0`), `missing branch for face ${face}`);
    }
    assert.ok(glsl.includes('else {'), 'missing final else branch for face 5');
    // spot-check the exact expressions from the convention table
    assert.ok(glsl.includes('return vec3(1.0, -st.y, -st.x);'));
    assert.ok(glsl.includes('return vec3(-st.x, -st.y, -1.0);'));
    assert.ok(glsl.includes('vec2 st = uv * 2.0 - 1.0;'));
});
