import type { UpscalePath } from '../types';

/**
 * Lifecycle phase of a split (two-submit) frame on the temporal path.
 *
 * - `idle`  — no split frame is in flight: the geometry stage has not run
 *   this frame (or the previous split frame already finished).
 * - `guides` — the geometry stage has run ({@link UpscalerCore.dispatchGuides}
 *   or {@link UpscalerCore.encodeGuides}) and the late stage
 *   ({@link UpscalerCore.dispatchUpscale} / {@link UpscalerCore.encodeUpscale})
 *   is the only legal next step.
 *
 * An explicit enum instead of a bare boolean so every misuse — a repeated
 * guides stage, a late stage with no guides, the all-in-one dispatch inside a
 * split frame — resolves through one named transition with its own error,
 * rather than sharing a single flag check.
 */
export type SplitFramePhase = 'idle' | 'guides';

const GUIDES_PATHS: readonly UpscalePath[] = ['temporal', 'guides'];

/**
 * The encoded state constraints behind the six frame entry points
 * (`dispatch`/`encode`, `dispatchGuides`/`encodeGuides`,
 * `dispatchUpscale`/`encodeUpscale`). The submit and encode variants call the
 * same guards, so the non-submitting `encode*()` pair cannot reach a state the
 * submitting pair would have rejected. Holds no GPU resources: `configure()`
 * and `dispose()` reset it through {@link reset} and a fresh split frame can
 * start immediately.
 */
export class SplitFrameState {
    private _phase: SplitFramePhase = 'idle';

    /** True while the geometry stage ran and the late stage hasn't. */
    get guidesPending(): boolean {
        return this._phase === 'guides';
    }

    /** Current phase — the published observable is the boolean getter. */
    get phase(): SplitFramePhase {
        return this._phase;
    }

    /**
     * Entry guard for the all-in-one frame (`dispatch()`/`encode()`).
     * Rejected on the guides-only path (it has no late stage) and while a
     * split frame is in flight (it must be finished with `dispatchUpscale()`).
     */
    assertFrameEntry(path: UpscalePath): void {
        if (path === 'guides') {
            throw new Error(
                "@pmndrs/upscaler: the 'guides' path has no upscale — drive it with dispatchGuides().",
            );
        }
        if (this._phase === 'guides') {
            throw new Error(
                '@pmndrs/upscaler: a split frame is in flight — finish it with dispatchUpscale() ' +
                    'instead of dispatch().',
            );
        }
    }

    /**
     * Entry guard for the geometry stage (`dispatchGuides()`/`encodeGuides()`).
     * Only the temporal and guides paths have a geometry stage; on the
     * temporal path a second guides stage in the same frame is rejected until
     * `dispatchUpscale()` closes it. The guides-only path ends its frame in
     * this call, so it stays `idle` and may run again.
     */
    assertGuidesEntry(path: UpscalePath): void {
        if (!GUIDES_PATHS.includes(path)) {
            throw new Error(
                `@pmndrs/upscaler: dispatchGuides() requires the temporal or guides path (got '${path}').`,
            );
        }
        if (this._phase === 'guides') {
            throw new Error(
                '@pmndrs/upscaler: dispatchGuides() already ran this frame — finish with dispatchUpscale().',
            );
        }
    }

    /**
     * Transition after a geometry stage. Opens the split frame on the
     * temporal path; the guides-only path has no late stage and stays idle.
     */
    guidesEncoded(path: UpscalePath): void {
        if (path === 'temporal') this._phase = 'guides';
    }

    /**
     * Entry guard for the late stage (`dispatchUpscale()`/`encodeUpscale()`).
     * Temporal only, and only while a split frame opened by the geometry
     * stage is in flight.
     */
    assertUpscaleEntry(path: UpscalePath): void {
        if (path !== 'temporal') {
            throw new Error(
                `@pmndrs/upscaler: dispatchUpscale() requires the temporal path (got '${path}').`,
            );
        }
        if (this._phase !== 'guides') {
            throw new Error(
                '@pmndrs/upscaler: call dispatchGuides() first (or use the all-in-one dispatch()).',
            );
        }
    }

    /** Transition after a late stage: the split frame is complete. */
    upscaleEncoded(): void {
        this._phase = 'idle';
    }

    /** Clears any in-flight split frame (configure/dispose). */
    reset(): void {
        this._phase = 'idle';
    }
}
