import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpscalerCore } from './UpscalerCore';
import { FLAG_PERSPECTIVE, FLAG_RESET, FLAG_REVERSED_DEPTH } from './shaders/common';
import type { CoreTexture, CoreTextureDescriptor } from './textures';

//* Mock Device — answers every create* call with a stub so the core runs
// end to end without a GPU or an engine (raw GPUTexture inputs only).

function mockDevice() {
    const writes: Uint32Array[] = [];
    const resource = (descriptor: { size?: number; label?: string } = {}) => ({
        label: descriptor.label,
        width: 16,
        height: 16,
        sampleCount: 1,
        format: 'rgba16float',
        getBindGroupLayout: () => ({}),
        createView: () => ({}),
        getMappedRange: () => new ArrayBuffer(descriptor.size ?? 4),
        unmap: () => {},
        destroy: vi.fn(),
    });
    const encoder = {
        beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }),
        finish: () => ({}),
    };
    const device = {
        lost: new Promise<GPUDeviceLostInfo>(() => {}),
        features: new Set<string>(),
        queue: {
            writeBuffer: vi.fn((_buffer: unknown, _offset: number, data: ArrayBuffer) => {
                writes.push(new Uint32Array(data.slice(0)));
            }),
            writeTexture: vi.fn(),
            submit: vi.fn(),
        },
        createShaderModule: resource,
        createComputePipelineAsync: async () => resource(),
        createSampler: resource,
        createBuffer: resource,
        createTexture: vi.fn(resource),
        createBindGroup: resource,
        createCommandEncoder: vi.fn(() => encoder),
    };
    return { device, writes, encoder, gpu: (label: string) => resource({ label }) as unknown as GPUTexture };
}

// The flags word of the most recent constants upload (ConstantsBuffer u32[20]).
const lastFlags = (writes: Uint32Array[]) => writes[writes.length - 1][20];

describe('UpscalerCore without an engine', () => {
    beforeEach(() => {
        vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 });
        vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('allocates the published set through the allocator and returns its handles', async () => {
        const { device } = mockDevice();
        const allocated: CoreTextureDescriptor[] = [];
        const allocateTexture = (descriptor: CoreTextureDescriptor): CoreTexture<{ name: string }> => {
            allocated.push(descriptor);
            return { gpu: device.createTexture() as unknown as GPUTexture, handle: { name: descriptor.label }, destroy: vi.fn() };
        };
        const core = new UpscalerCore({ device: device as unknown as GPUDevice, allocateTexture });
        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2 });
        await core.prepare();

        expect(core.output).toEqual({ name: 'upscale-output' });
        expect(core.guides.dilatedMotion).toEqual({ name: 'upscale-dilated-motion' });
        expect(core.guides.history).toEqual({ name: 'upscale-history-0' });
        const byLabel = new Map(allocated.map((d) => [d.label, d]));
        expect(byLabel.get('upscale-output')).toMatchObject({ width: 64, height: 32, format: 'rgba16float' });
        expect(byLabel.get('upscale-dilated-depth-0')).toMatchObject({ width: 32, height: 16, format: 'r32float' });
        expect(byLabel.get('upscale-masks')).toMatchObject({ format: 'rgba8unorm' });
    });

    it('defaults to raw GPUTexture handles', async () => {
        const { device } = mockDevice();
        const core = new UpscalerCore({ device: device as unknown as GPUDevice });
        core.configure({ displayWidth: 64, displayHeight: 32, path: 'spatial' });
        expect(core.output).toMatchObject({ label: 'upscale-output' });
    });

    it('stages camera facts from plain frame data', async () => {
        const { device, writes, gpu } = mockDevice();
        const core = new UpscalerCore({ device: device as unknown as GPUDevice });
        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2 });
        await core.prepare();
        const inputs = { color: gpu('color'), depth: gpu('depth'), velocity: gpu('velocity') };

        core.dispatch(inputs, { near: 0.1, far: 100, perspective: true, reversedDepth: true });
        expect(lastFlags(writes) & (FLAG_PERSPECTIVE | FLAG_REVERSED_DEPTH | FLAG_RESET))
            .toBe(FLAG_PERSPECTIVE | FLAG_REVERSED_DEPTH | FLAG_RESET);

        core.dispatch(inputs, { near: 0.1, far: 100, perspective: false });
        expect(lastFlags(writes) & (FLAG_PERSPECTIVE | FLAG_REVERSED_DEPTH | FLAG_RESET)).toBe(0);
    });

    it("reads the projection type from a denoiser-style camera's matrix", async () => {
        const { device, writes, gpu } = mockDevice();
        const core = new UpscalerCore({ device: device as unknown as GPUDevice });
        core.configure({ displayWidth: 64, displayHeight: 32, path: 'spatial' });
        await core.prepare();
        const perspective = new Float32Array(16);
        perspective[11] = -1; // w = −z
        const orthographic = new Float32Array(16);
        orthographic[15] = 1;

        core.dispatch({ color: gpu('color') }, { near: 0.1, far: 100, projection: perspective });
        expect(lastFlags(writes) & FLAG_PERSPECTIVE).toBe(FLAG_PERSPECTIVE);
        core.dispatch({ color: gpu('color') }, { near: 0.1, far: 100, projection: orthographic });
        expect(lastFlags(writes) & FLAG_PERSPECTIVE).toBe(0);
        expect(() => core.dispatch({ color: gpu('color') }, { near: 0.1, far: 100 })).toThrow(/perspective/);
    });

    it('encodes into a host encoder without submitting', async () => {
        const { device, encoder, gpu } = mockDevice();
        const core = new UpscalerCore({ device: device as unknown as GPUDevice });
        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2 });
        await core.prepare();
        const camera = { near: 0.1, far: 100, perspective: true };

        core.encodeGuides(encoder as unknown as GPUCommandEncoder, { depth: gpu('depth'), velocity: gpu('velocity') }, camera);
        expect(core.guidesPending).toBe(true);
        core.encodeUpscale(encoder as unknown as GPUCommandEncoder, { color: gpu('color') }, camera);
        expect(core.guidesPending).toBe(false);
        expect(device.createCommandEncoder).not.toHaveBeenCalled();
        expect(device.queue.submit).not.toHaveBeenCalled();
    });

    it('advances jitter only on the temporal path with jitter on', async () => {
        const { device } = mockDevice();
        const core = new UpscalerCore({ device: device as unknown as GPUDevice });
        expect(core.beginFrame()).toBeNull();
        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2 });
        expect(core.beginFrame()).toBe(core.jitter);
        expect(core.jitterPhase).toBe(1);
        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2, jitter: false });
        expect(core.beginFrame()).toBeNull();
        core.configure({ displayWidth: 64, displayHeight: 32, path: 'spatial' });
        expect(core.beginFrame()).toBeNull();
    });
});

//* Split-frame state — the geometry stage (dispatchGuides/encodeGuides) and
// the late stage (dispatchUpscale/encodeUpscale) are an ordered pair. Every
// misuse must fail on its own distinguishable transition, with the same
// constraints on the submitting and host-encoder variants. All driven through
// the mock device above: no real WebGPU device is involved.

describe('UpscalerCore split-frame state', () => {
    const camera = { near: 0.1, far: 100, perspective: true };

    beforeEach(() => {
        vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 });
        vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    async function temporalCore(path: 'temporal' | 'guides' | 'spatial' | 'bilinear' = 'temporal') {
        const mocks = mockDevice();
        const core = new UpscalerCore({ device: mocks.device as unknown as GPUDevice });
        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2, path });
        await core.prepare();
        return { ...mocks, core };
    }

    const guideInputs = (gpu: (label: string) => GPUTexture) => ({ depth: gpu('depth'), velocity: gpu('velocity') });
    const upscaleInputs = (gpu: (label: string) => GPUTexture) => ({ color: gpu('color'), depth: gpu('depth'), velocity: gpu('velocity') });

    it('returns guidesPending to false after a full two-stage split frame', async () => {
        const { core, gpu } = await temporalCore();
        expect(core.guidesPending).toBe(false);

        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(true);
        core.dispatchUpscale(upscaleInputs(gpu), camera);
        expect(core.guidesPending).toBe(false);
    });

    it('rejects a second guides stage with a finish-with-dispatchUpscale error', async () => {
        const { core, gpu } = await temporalCore();
        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(true);

        expect(() => core.dispatchGuides(guideInputs(gpu), camera)).toThrow(
            /already ran this frame — finish with dispatchUpscale\(\)/,
        );
        // The rejected stage must not touch the GPU, and the frame stays open.
        expect(core.guidesPending).toBe(true);
    });

    it('rejects a late stage without a guides stage, naming dispatchGuides/dispatch', async () => {
        const { core, gpu, device } = await temporalCore();
        expect(core.guidesPending).toBe(false);

        expect(() => core.dispatchUpscale(upscaleInputs(gpu), camera)).toThrow(
            /call dispatchGuides\(\) first \(or use the all-in-one dispatch\(\)\)/,
        );
        expect(device.createCommandEncoder).not.toHaveBeenCalled();
        expect(device.queue.submit).not.toHaveBeenCalled();
        expect(core.guidesPending).toBe(false);
    });

    it('rejects the all-in-one dispatch while a split frame is in flight', async () => {
        const { core, gpu, device } = await temporalCore();
        core.dispatchGuides(guideInputs(gpu), camera);

        expect(() => core.dispatch(upscaleInputs(gpu), camera)).toThrow(
            /split frame is in flight — finish it with dispatchUpscale\(\)/,
        );
        // Only the guides stage's encoder/submit happened; the rejected dispatch added none.
        expect(device.createCommandEncoder).toHaveBeenCalledTimes(1);
        expect(device.queue.submit).toHaveBeenCalledTimes(1);
        expect(core.guidesPending).toBe(true);
    });

    it('constrains the encode pair the same way without ever creating an encoder or submitting', async () => {
        const mocks = await temporalCore();
        const { core, gpu, encoder, device } = mocks;

        // Missing guides stage: encodeUpscale cannot run first.
        expect(() => core.encodeUpscale(encoder as unknown as GPUCommandEncoder, upscaleInputs(gpu), camera)).toThrow(
            /call dispatchGuides\(\) first \(or use the all-in-one dispatch\(\)\)/,
        );
        expect(device.createCommandEncoder).not.toHaveBeenCalled();
        expect(device.queue.submit).not.toHaveBeenCalled();
        expect(core.guidesPending).toBe(false);

        // Happy path through the host encoder.
        core.encodeGuides(encoder as unknown as GPUCommandEncoder, guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(true);
        expect(() => core.encodeGuides(encoder as unknown as GPUCommandEncoder, guideInputs(gpu), camera)).toThrow(
            /already ran this frame — finish with dispatchUpscale\(\)/,
        );
        core.encodeUpscale(encoder as unknown as GPUCommandEncoder, upscaleInputs(gpu), camera);
        expect(core.guidesPending).toBe(false);

        // The encode entry points own no submission machinery.
        expect(device.createCommandEncoder).not.toHaveBeenCalled();
        expect(device.queue.submit).not.toHaveBeenCalled();
    });

    it.each(['spatial', 'bilinear'] as const)('rejects dispatchGuides on the %s path', async (path) => {
        const { core, gpu } = await temporalCore(path);
        expect(() => core.dispatchGuides(guideInputs(gpu), camera)).toThrow(
            /dispatchGuides\(\) requires the temporal or guides path/,
        );
        expect(core.guidesPending).toBe(false);
    });

    it('keeps the guides-only path idle and rejects its upscale/dispatch entry points', async () => {
        const { core, gpu } = await temporalCore('guides');

        // dispatchGuides is the whole frame: it never opens a split frame, so
        // a second call in the next frame is legal.
        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(false);
        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(false);

        expect(() => core.dispatch(upscaleInputs(gpu), camera)).toThrow(/the 'guides' path has no upscale/);
        expect(() => core.dispatchUpscale(upscaleInputs(gpu), camera)).toThrow(
            /dispatchUpscale\(\) requires the temporal path/,
        );
    });

    it('clears the split frame on configure() so a fresh split frame can start', async () => {
        const { core, gpu } = await temporalCore();
        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(true);

        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2 });
        expect(core.guidesPending).toBe(false);

        // Re-prepare the reconfigured pass graph, then run the pair again.
        await core.prepare();
        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(true);
        core.dispatchUpscale(upscaleInputs(gpu), camera);
        expect(core.guidesPending).toBe(false);
    });

    it('clears the split frame on dispose() and allows a restart afterwards', async () => {
        const { core, gpu } = await temporalCore();
        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(true);

        core.dispose();
        expect(core.guidesPending).toBe(false);

        // A new working set and pass graph: the next guides stage starts clean.
        core.configure({ displayWidth: 64, displayHeight: 32, customUpscaleRatio: 2 });
        await core.prepare();
        core.dispatchGuides(guideInputs(gpu), camera);
        expect(core.guidesPending).toBe(true);
        core.dispatchUpscale(upscaleInputs(gpu), camera);
        expect(core.guidesPending).toBe(false);
    });
});
