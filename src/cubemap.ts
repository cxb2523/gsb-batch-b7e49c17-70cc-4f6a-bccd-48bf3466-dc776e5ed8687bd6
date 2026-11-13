// Pure, framework-free cubemap face convention and coordinate math.
//
// This module is the single source of truth for how the texture preview maps
// a 2D face image onto direction vectors. The fragment shader is generated
// from FACE_TABLE (see buildCubemapUvGLSL) and the queryable JS equivalent
// (cubemapDirection) evaluates the exact same table, so tests can verify the
// directions the shader actually uses without a WebGL context.
//
// Six-face orientation convention (matches the WebGL/GL TEXTURE_CUBE_MAP_*
// targets the engine uploads each face to, and the labels of the face buttons):
//
//   face 0  CUBEFACE_POSX  +x   major axis normal = ( 1,  0,  0)
//   face 1  CUBEFACE_NEGX  -x   major axis normal = (-1,  0,  0)
//   face 2  CUBEFACE_POSY  +y   major axis normal = ( 0,  1,  0)
//   face 3  CUBEFACE_NEGY  -y   major axis normal = ( 0, -1,  0)
//   face 4  CUBEFACE_POSZ  +z   major axis normal = ( 0,  0,  1)
//   face 5  CUBEFACE_NEGZ  -z   major axis normal = ( 0,  0, -1)
//
// Face-local coordinates use the standard GL convention: (u, v) = (0, 0) is
// the bottom-left texel of the face image and (u, v) = (1, 1) the top-right,
// with
//
//   s = 2 * u - 1   (horizontal, left -> right)
//   t = 2 * v - 1   (vertical,   bottom -> top)
//
// The table below reproduces the canonical mapping from the Khronos OpenGL
// cubemap tutorial. Adjacent faces share continuous directions along their
// common edges (verified by tests/cubemap.test.ts).

// Face indices, identical to the engine's CUBEFACE_* constants.
const FACE_POSX = 0;
const FACE_NEGX = 1;
const FACE_POSY = 2;
const FACE_NEGY = 3;
const FACE_POSZ = 4;
const FACE_NEGZ = 5;

const FACE_COUNT = 6;

// Human readable labels used by the face buttons, indexed by face number.
const FACE_LABELS = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;

// Signed major-axis normal of each face, indexed by face number.
const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
];

type Vec3 = {
    x: number;
    y: number;
    z: number;
};

// A vec3 component is either a constant or the signed face-local s/t axis.
type ComponentTerm = { kind: 'const'; value: 1 | -1 } | { kind: 's'; sign: 1 | -1 } | { kind: 't'; sign: 1 | -1 };

type FaceMapping = {
    face: number;
    label: string;
    // GLSL/JS expression for each component of the direction vector.
    components: readonly [ComponentTerm, ComponentTerm, ComponentTerm];
};

const term = (kind: ComponentTerm['kind'], sign: 1 | -1 = 1): ComponentTerm =>
    kind === 'const' ? { kind, value: sign } : { kind, sign };

// One row per face. Evaluate with st = (2*u-1, 2*v-1):
//
//   +x: dir = ( 1, -t, -s)
//   -x: dir = (-1, -t,  s)
//   +y: dir = ( s,  1,  t)
//   -y: dir = ( s, -1, -t)
//   +z: dir = ( s, -t,  1)
//   -z: dir = (-s, -t, -1)
const FACE_TABLE: readonly FaceMapping[] = [
    { face: FACE_POSX, label: '+x', components: [term('const', 1), term('t', -1), term('s', -1)] },
    { face: FACE_NEGX, label: '-x', components: [term('const', -1), term('t', -1), term('s', 1)] },
    { face: FACE_POSY, label: '+y', components: [term('s', 1), term('const', 1), term('t', 1)] },
    { face: FACE_NEGY, label: '-y', components: [term('s', 1), term('const', -1), term('t', -1)] },
    { face: FACE_POSZ, label: '+z', components: [term('s', 1), term('t', -1), term('const', 1)] },
    { face: FACE_NEGZ, label: '-z', components: [term('s', -1), term('t', -1), term('const', -1)] }
];

const assertFace = (face: number): void => {
    if (!Number.isInteger(face) || face < 0 || face >= FACE_COUNT) {
        throw new RangeError(`face must be an integer in [0, 5], got ${face}`);
    }
};

const evalTerm = (component: ComponentTerm, s: number, t: number): number => {
    switch (component.kind) {
        case 'const':
            return component.value;
        case 's':
            return component.sign * s;
        case 't':
            return component.sign * t;
        default:
            throw new Error('unknown component term');
    }
};

// Render a component term as a GLSL scalar expression.
const glslTerm = (component: ComponentTerm): string => {
    switch (component.kind) {
        case 'const':
            return component.value.toFixed(1);
        case 's':
            return component.sign < 0 ? '-st.x' : 'st.x';
        case 't':
            return component.sign < 0 ? '-st.y' : 'st.y';
        default:
            throw new Error('unknown component term');
    }
};

// Generate the GLSL getCubemapUv function from FACE_TABLE so the shader can
// never drift from the JS query implementation.
const buildCubemapUvGLSL = (): string => {
    const branches = FACE_TABLE.map((mapping, index) => {
        const [x, y, z] = mapping.components.map(glslTerm);
        const keyword = index === 0 ? 'if' : index === FACE_TABLE.length - 1 ? 'else' : 'else if';
        const condition = keyword === 'else' ? '' : ` (face == ${index}.0)`;
        return `    ${keyword}${condition} {
        return vec3(${x}, ${y}, ${z});
    }`;
    }).join('\n');

    return `vec3 getCubemapUv(vec2 uv, float face) {
    vec2 st = uv * 2.0 - 1.0;
${branches}
}`;
};

// Pure JS equivalent of the shader's getCubemapUv.
// uv is in face-local GL convention: (0, 0) bottom-left, (1, 1) top-right.
const cubemapDirection = (face: number, uv: { u: number; v: number }): Vec3 => {
    assertFace(face);
    const s = 2 * uv.u - 1;
    const t = 2 * uv.v - 1;
    const mapping = FACE_TABLE[face];
    return {
        x: evalTerm(mapping.components[0], s, t),
        y: evalTerm(mapping.components[1], s, t),
        z: evalTerm(mapping.components[2], s, t)
    };
};

// Error thrown when a cubemap-only query is made on a 2D texture.
class NotACubemapError extends Error {
    constructor(message = 'face direction query requires a cubemap texture') {
        super(message);
        this.name = 'NotACubemapError';
    }
}

// Resolve the direction vector the preview shader uses for a cubemap texel.
//
// The shader flips the v axis of the screen-derived uv before sampling
// (texture data is top-left origin), so this entry takes the preview uv where
// (0, 0) is the top-left of the displayed face and applies the same flip.
// Set isCubemap to false (or pass a 2D texture doc) to get the explicit error
// required instead of a silently fabricated direction.
const queryCubemapDirection = (isCubemap: boolean, face: number, uv: { u: number; v: number }): Vec3 => {
    if (!isCubemap) {
        throw new NotACubemapError();
    }
    return cubemapDirection(face, { u: uv.u, v: 1 - uv.v });
};

// Pure screen-pixel -> preview-uv math, mirroring the fragment shader's
// `uv = (gl_FragCoord.xy - offset) / scale / texSize`.
//
// pixelX/pixelY are measured from the TOP-LEFT of the viewport in physical
// pixels (the convention used by mouse events). The returned v therefore also
// runs top-left -> bottom-right, matching the uv fed into queryCubemapDirection
// and the 2D textureLod path.
const pixelToUv = (
    pixelX: number,
    pixelY: number,
    offsetX: number,
    offsetY: number,
    scale: number,
    texWidth: number,
    texHeight: number,
    viewportHeight: number
): { u: number; v: number } => {
    // gl_FragCoord.y counts from the bottom of the viewport.
    const fragX = pixelX;
    const fragY = viewportHeight - pixelY;
    return {
        u: (fragX - offsetX) / scale / texWidth,
        v: 1 - (fragY - offsetY) / scale / texHeight
    };
};

// Inverse of pixelToUv: viewport pixel coordinates (top-left origin) of a
// top-left-origin uv. Kept pure so drag/zoom anchoring can be unit tested.
const uvToPixel = (
    uv: { u: number; v: number },
    offsetX: number,
    offsetY: number,
    scale: number,
    texWidth: number,
    texHeight: number,
    viewportHeight: number
): { x: number; y: number } => {
    const fragX = uv.u * scale * texWidth + offsetX;
    // shader v = 1 - uv.v maps back to a bottom-origin fragment y
    const fragY = (1 - uv.v) * scale * texHeight + offsetY;
    return { x: fragX, y: viewportHeight - fragY };
};

// Scale limits shared with the preview's clamp behavior.
const MIN_SCALE = 0.2;
const MAX_SCALE = 100;

const clampScale = (scale: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

// Clamp panning so a texture of scaled size (scaledW x scaledH) always stays
// within the viewport. When the texture is smaller than the viewport on an
// axis it is centered on that axis instead of being dragged off-screen.
const clampOffset = (offset: number, scaledSize: number, viewportSize: number): number => {
    const diff = scaledSize - viewportSize;
    return diff < 0 ? diff * -0.5 : Math.max(-diff, Math.min(0, offset));
};

export {
    FACE_POSX,
    FACE_NEGX,
    FACE_POSY,
    FACE_NEGY,
    FACE_POSZ,
    FACE_NEGZ,
    FACE_COUNT,
    FACE_LABELS,
    FACE_NORMALS,
    FACE_TABLE,
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
};
export type { Vec3, FaceMapping, ComponentTerm };
