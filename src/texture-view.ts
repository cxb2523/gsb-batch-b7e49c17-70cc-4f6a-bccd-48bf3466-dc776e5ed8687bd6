import {
    Layer,
    LayerComposition,
    Entity,
    Mesh,
    ShaderMaterial,
    MeshInstance,
    Color,
    Texture,
    FILTER_LINEAR,
    FILTER_NEAREST,
    FILTER_LINEAR_MIPMAP_LINEAR,
    FILTER_NEAREST_MIPMAP_LINEAR,
    PIXELFORMAT_R8_G8_B8_A8,
    TEXTURETYPE_DEFAULT,
    SEMANTIC_POSITION,
    ShaderChunks,
    SHADERLANGUAGE_GLSL
} from 'playcanvas';

import {
    FACE_COUNT,
    NotACubemapError,
    buildCubemapUvGLSL,
    clampOffset,
    clampScale,
    pixelToUv as pixelToUvPure,
    queryCubemapDirection
} from './cubemap';
import type { Vec3 } from './cubemap';
import type { RenderCanvas } from './render-canvas';
import type { TextureDoc } from './texture-doc';

type TexelCoord = {
    u: number;
    v: number;
};

type PixelCoord = {
    x: number;
    y: number;
};

class TextureView {
    canvas: RenderCanvas;
    composition: LayerComposition;
    layer: Layer;
    root: Entity;
    material: ShaderMaterial;
    render: Entity;
    meshInstance: MeshInstance;
    camera: Entity;
    defaultTex: Texture;
    rebuildMaterial: boolean;
    texture: TextureDoc | null;
    textureType: string;
    alpha: boolean;
    face: number;
    filter: boolean;
    mipmap: number;
    exposure: number;
    offsetX: number;
    offsetY: number;
    scale: number;
    viewportW: number;
    viewportH: number;

    constructor(canvas: RenderCanvas) {
        const device = canvas.renderer.app.graphicsDevice;

        this.canvas = canvas;

        // construct the scene
        this.composition = new LayerComposition('texture-preview');

        this.layer = new Layer({
            id: -2,
            enabled: true,
            opaqueSortMode: 2,
            transparentSortMode: 3
        });
        this.composition.push(this.layer);

        this.canvas.composition = this.composition;

        // root entity
        this.root = new Entity();

        // mesh
        const mesh = new Mesh(device);
        mesh.setPositions([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
        mesh.setIndices([0, 1, 2, 0, 2, 3]);
        mesh.update();

        // construct the material
        this.material = new ShaderMaterial();

        // render entity
        this.meshInstance = new MeshInstance(mesh, this.material);
        this.render = new Entity();
        this.render.addComponent('render', {
            material: this.material,
            meshInstances: [this.meshInstance]
        });
        this.root.addChild(this.render);

        // camera
        this.camera = new Entity();
        this.camera.addComponent('camera', {
            nearClip: 0.01,
            farClip: 32,
            fov: 30,
            clearColor: new Color(0, 0, 0, 0),
            frustumCulling: false,
            layers: []
        });
        this.camera.setLocalPosition(0, 0, 2.2);
        this.camera.camera!.layers = [this.layer.id];
        this.root.addChild(this.camera);

        this.layer.addMeshInstances(this.render.render!.meshInstances);
        this.layer.addCamera(this.camera.camera!);

        this.root.syncHierarchy();

        // handle canvas resize
        this.canvas.on('resize', () => {
            this.setViewport(
                this.canvas.canvasWidth * window.devicePixelRatio,
                this.canvas.canvasHeight * window.devicePixelRatio
            );
        });

        // handle renders
        this.canvas.on('prerender', () => {
            // set filtering
            if (this.texture && this.texture.resource) {
                this.texture.resource.magFilter = this.filter ? FILTER_LINEAR : FILTER_NEAREST;
                this.texture.resource.minFilter = this.filter
                    ? FILTER_LINEAR_MIPMAP_LINEAR
                    : FILTER_NEAREST_MIPMAP_LINEAR;
            }
            this.prepare();
        });

        // create default texture
        const data = new Uint8Array([64, 64, 64, 255]);
        this.defaultTex = new Texture(device, {
            cubemap: false,
            width: 1,
            height: 1,
            format: PIXELFORMAT_R8_G8_B8_A8,
            type: TEXTURETYPE_DEFAULT,
            levels: [data]
        });

        this.rebuildMaterial = true;
        this.texture = null;
        this.meshInstance.visible = false;
        this.textureType = 'gamma';
        this.alpha = false;
        this.face = 0;
        this.filter = false;
        this.mipmap = 0;
        this.exposure = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1.0;
        this.viewportW = 300;
        this.viewportH = 150;
    }

    setTexture(texture: TextureDoc): void {
        if (texture !== this.texture) {
            this.texture = texture;
            this.meshInstance.visible = !!texture.resource;
            if (texture.resource) {
                this.scale = Math.min(this.viewportW / this.texture.width!, this.viewportH / this.texture.height!);
                this.offsetX = 0;
                this.offsetY = 0;
                this.clamp();
            }
            this.rebuildMaterial = true;
            this.canvas.render();
        }
    }

    setFace(value: number): void {
        if (value !== this.face) {
            this.face = value;
            this.canvas.render();
        }
    }

    setTextureType(value: string): void {
        if (value !== this.textureType) {
            this.textureType = value;
            this.rebuildMaterial = true;
            this.canvas.render();
        }
    }

    setAlpha(value: boolean): void {
        if (value !== this.alpha) {
            this.alpha = value;
            this.rebuildMaterial = true;
            this.canvas.render();
        }
    }

    setFilter(value: boolean): void {
        if (value !== this.filter) {
            this.filter = value;
            this.canvas.render();
        }
    }

    setMipmap(value: number): void {
        if (value !== this.mipmap) {
            this.mipmap = value;
            this.canvas.render();
        }
    }

    setExposure(value: number): void {
        if (value !== this.exposure) {
            this.exposure = value;
            this.canvas.render();
        }
    }

    setViewport(width: number, height: number): void {
        this.viewportW = width;
        this.viewportH = height;
        this.clamp();
    }

    setScale(scale: number, pixelX: number, pixelY: number): void {
        const tex = this.pixelToTexel(pixelX, this.viewportH - pixelY);

        // update scale; clamp() enforces the [MIN_SCALE, MAX_SCALE] range
        this.scale = scale;
        this.clamp();

        // keep pixelX,pixelY under the cursor
        const pix = this.texelToPixel(tex.u, tex.v);
        this.offsetX -= pix.x - pixelX;
        this.offsetY -= pix.y - (this.viewportH - pixelY);
        this.clamp();
    }

    setOffset(offsetX: number, offsetY: number): void {
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        this.clamp();
    }

    pixelToTexel(x: number, y: number): TexelCoord {
        return {
            u: (x - this.offsetX) / this.scale,
            v: (y - this.offsetY) / this.scale
        };
    }

    texelToPixel(u: number, v: number): PixelCoord {
        return {
            x: u * this.scale + this.offsetX,
            y: v * this.scale + this.offsetY
        };
    }

    clamp(): void {
        if (this.texture) {
            // clamp scale to the shared [0.2, 100] range
            this.scale = clampScale(this.scale);

            // clamp offsetX so the texture stays inside the viewport
            this.offsetX = clampOffset(this.offsetX, this.scale * this.texture.width!, this.viewportW);

            // clamp offsetY so the texture stays inside the viewport
            this.offsetY = clampOffset(this.offsetY, this.scale * this.texture.height!, this.viewportH);

            this.canvas.render();
        }
    }

    // Query interface for automated verification.
    //
    // Returns the direction vector actually used by the fragment shader for
    // the given cubemap face and preview uv (u/v in [0, 1], origin at the
    // top-left of the displayed face, i.e. the same space produced by
    // pixelToUv). Throws NotACubemapError for a 2D texture and RangeError for
    // a face outside [0, 5], instead of silently returning a direction.
    queryFaceDirection(face: number, uv: TexelCoord): Vec3 {
        const isCubemap = !!(this.texture && this.texture.cubemap);
        if (!isCubemap) {
            throw new NotACubemapError();
        }
        if (!Number.isInteger(face) || face < 0 || face >= FACE_COUNT) {
            throw new RangeError(`face must be an integer in [0, 5], got ${face}`);
        }
        return queryCubemapDirection(true, face, uv);
    }

    // Pure screen pixel -> preview uv entry point, callable without rendering.
    // pixelX/pixelY are physical pixels from the top-left of the viewport.
    screenPixelToUv(pixelX: number, pixelY: number): TexelCoord {
        const width = this.texture?.width ?? 1;
        const height = this.texture?.height ?? 1;
        return pixelToUvPure(pixelX, pixelY, this.offsetX, this.offsetY, this.scale, width, height, this.viewportH);
    }

    // Build the fragment shader source with current settings.
    // Original shader logic from src/chunks/texture.frag.js, adapted for ShaderMaterial API.
    buildFragmentShader(): string {
        const decodeFunc: Record<string, string> = {
            gamma: 'decodeGamma',
            linear: 'decodeLinear',
            rgbm: 'decodeRGBM',
            rgbe: 'decodeRGBE',
            rgbp: 'decodeRGBP',
            a: 'decodeAlpha'
        };

        const isCubemap = this.texture && this.texture.cubemap;
        const decodeFuncName = decodeFunc[this.textureType];

        // Get decode functions from engine, add custom decodeAlpha
        const device = this.canvas.renderer.app.graphicsDevice;
        const chunks = ShaderChunks.get(device, SHADERLANGUAGE_GLSL);
        const decodeFunctions = `
${chunks.get('decodePS')}
vec3 decodeAlpha(vec4 raw) {
    return vec3(raw.a);
}
`;

        return `
${decodeFunctions}

uniform float mipmap;
uniform float exposure;
uniform vec2 offset;
uniform float scale;
uniform vec2 viewportSize;
uniform vec2 texSize;

${isCubemap ? 'uniform samplerCube tex;' : 'uniform sampler2D tex;'}
${isCubemap ? 'uniform float face;' : ''}

${
    isCubemap
        ? `
${buildCubemapUvGLSL()}
`
        : ''
}

vec3 encodeGamma(vec3 source) {
    return pow(source, vec3(1.0 / 2.2));
}

float tile(vec2 coord, float tileSize) {
    return mod(dot(floor(coord * 2.0 / tileSize), vec2(1.0)), 2.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - offset) / scale / texSize;

    ${
        isCubemap
            ? 'vec4 raw = textureCubeLod(tex, getCubemapUv(vec2(uv.x, 1.0 - uv.y), face), mipmap);'
            : 'vec4 raw = textureLod(tex, vec2(uv.x, 1.0 - uv.y), mipmap);'
    }

    vec3 final = ${decodeFuncName}(raw);
    float alpha = raw.a;

    final *= exposure;

    ${
        this.alpha
            ? `
    vec3 tileClr = mix(vec3(0.3), vec3(0.5), tile(gl_FragCoord.xy, 50.0));
    final = mix(tileClr, final, alpha);
    `
            : ''
    }

    float oob = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))) ? 0.0 : 1.0;
    final = mix(vec3(0.15), final, oob);

    gl_FragColor = vec4(encodeGamma(final), 1.0);
}
`;
    }

    // prepare the material for rendering
    prepare(): void {
        if (this.rebuildMaterial) {
            this.rebuildMaterial = false;

            const isCubemap = this.texture && this.texture.cubemap;
            const uniqueName = `texture-view-${this.textureType}-${this.alpha ? 'alpha' : 'noalpha'}-${isCubemap ? 'cube' : '2d'}`;

            this.material.shaderDesc = {
                uniqueName: uniqueName,
                attributes: { vertex_position: SEMANTIC_POSITION },
                vertexGLSL: `
attribute vec3 vertex_position;

void main() {
    gl_Position = vec4(vertex_position * 2.0 - 1.0, 1.0);
}
`,
                fragmentGLSL: this.buildFragmentShader()
            };
        }
        this.material.setParameter('tex', this.texture?.resource || this.defaultTex);
        this.material.setParameter('face', this.face);
        this.material.setParameter('mipmap', this.mipmap);
        this.material.setParameter('exposure', this.exposure);
        this.material.setParameter('offset', [this.offsetX, this.offsetY]);
        this.material.setParameter('scale', this.scale);
        this.material.setParameter('viewportSize', [this.viewportW, this.viewportH]);
        this.material.setParameter(
            'texSize',
            this.texture ? [this.texture.width ?? 1, this.texture.height ?? 1] : [1, 1]
        );
        this.material.update();
    }
}

export { TextureView };
