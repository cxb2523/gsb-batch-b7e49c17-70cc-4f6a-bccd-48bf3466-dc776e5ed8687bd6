/**
 * Tests for the mixer controls on the real playback chain.
 *
 * Uses AdlMidiCore (the same WASM synthesis path the AudioWorklet
 * processor drives) with the nuked core build in dist/, so the
 * "mute → silence → restore → sound" evidence is measured from
 * genuinely generated sample buffers rather than UI state.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CORE_URL = new URL('../../dist/libadlmidi.nuked.core.js', import.meta.url).href;
const CANYON = join(ROOT, 'test-files', 'canyon.mid');
const MULTITRACK = join(ROOT, 'tests', 'fixtures', 'multitrack.mid');

let AdlMidiCore;
let TrackOption;

beforeAll(async () => {
    const module = await import('../../src/core.js');
    AdlMidiCore = module.AdlMidiCore;
    TrackOption = module.TrackOption;
});

/**
 * Peak of the most recently generated sample buffer, exactly the quantity
 * the mixer panel displays ("current output peak").
 */
function peakOf(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
    }
    return peak;
}

/** Generate `seconds` of audio and return the max |sample| in the whole window. */
function renderPeak(synth, seconds) {
    const frames = Math.floor(44100 * seconds);
    return peakOf(synth.play(frames));
}

/** Generate `seconds` and return the peak of the final quarter (the steady state). */
function settlePeak(synth, seconds) {
    const samples = synth.play(Math.floor(44100 * seconds));
    const tailStart = Math.floor(samples.length * 0.75);
    let peak = 0;
    for (let i = tailStart; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
    }
    return peak;
}

describe('Mixer peak evidence (playback chain)', () => {
    let synth;

    beforeAll(async () => {
        synth = await AdlMidiCore.create({ corePath: CORE_URL });
        synth.init(44100);
        const loaded = synth.loadMidi(readFileSync(CANYON));
        expect(loaded).toBe(true);
        expect(synth.getTrackCount()).toBeGreaterThan(0);
        synth.setLoopEnabled(true);
        // Let the sequencer reach a dense part of the song before measuring.
        renderPeak(synth, 0.6);
    });

    afterAll(() => synth?.close());

    it('reports a non-silent baseline peak while the song plays', () => {
        const baseline = renderPeak(synth, 0.4);
        expect(baseline).toBeGreaterThan(0.005);
    });

    it('muting every track drops the peak to near silence', () => {
        const baseline = renderPeak(synth, 0.4);

        const count = synth.getTrackCount();
        const results = [];
        for (let track = 0; track < count; track++) {
            results.push(synth.setTrackOptions(track, TrackOption.OFF));
        }
        expect(results.every(r => r === true)).toBe(true);

        // Give release envelopes time to finish, then measure steady state.
        renderPeak(synth, 0.35);
        const muted = settlePeak(synth, 0.2);

        expect(muted).toBeLessThan(0.01);
        expect(muted).toBeLessThan(baseline * 0.25);
    });

    it('restoring the tracks brings the peak back up', () => {
        const count = synth.getTrackCount();
        for (let track = 0; track < count; track++) {
            expect(synth.setTrackOptions(track, TrackOption.ON)).toBe(true);
        }

        const restored = renderPeak(synth, 0.4);
        const mutedReference = settlePeak(synth, 0.05);

        expect(restored).toBeGreaterThan(0.005);
        expect(restored).toBeGreaterThan(mutedReference * 4);
    });

    it('disabling all 16 channels silences output and re-enabling restores it', () => {
        const before = renderPeak(synth, 0.3);

        for (let channel = 0; channel < 16; channel++) {
            expect(synth.setChannelEnabled(channel, false)).toBe(true);
        }
        renderPeak(synth, 0.3);
        const disabled = settlePeak(synth, 0.2);
        expect(disabled).toBeLessThan(0.01);
        expect(disabled).toBeLessThan(before * 0.25);

        for (let channel = 0; channel < 16; channel++) {
            expect(synth.setChannelEnabled(channel, true)).toBe(true);
        }
        const restored = renderPeak(synth, 0.4);
        expect(restored).toBeGreaterThan(disabled * 4);
    });

    it('soloing a track keeps it audible while clearing solo restores the mix', () => {
        const count = synth.getTrackCount();
        for (let track = 0; track < count; track++) {
            expect(synth.setTrackOptions(track, TrackOption.ON)).toBe(true);
        }

        expect(synth.setTrackOptions(0, TrackOption.SOLO)).toBe(true);
        const soloed = renderPeak(synth, 0.4);
        expect(soloed).toBeGreaterThan(0.001);

        // 0xFFFFFFFF is libADLMIDI's sentinel for "no track soloed".
        expect(synth.setTrackOptions(0xFFFFFFFF, TrackOption.SOLO)).toBe(true);
        const mixed = renderPeak(synth, 0.4);
        expect(mixed).toBeGreaterThan(0.001);
    });
});

describe('Mixer API failure reporting', () => {
    let synth;

    beforeAll(async () => {
        synth = await AdlMidiCore.create({ corePath: CORE_URL });
        synth.init(44100);
        synth.loadMidi(readFileSync(MULTITRACK));
    });

    afterAll(() => synth?.close());

    it('returns false (not an exception) for out-of-range track indices', () => {
        expect(synth.setTrackOptions(999, TrackOption.ON)).toBe(false);
        expect(synth.setTrackOptions(-1, TrackOption.ON)).toBe(false);
        const count = synth.getTrackCount();
        expect(synth.setTrackOptions(count, TrackOption.ON)).toBe(false);
    });

    it('returns false (not an exception) for out-of-range channel numbers', () => {
        expect(synth.setChannelEnabled(16, true)).toBe(false);
        expect(synth.setChannelEnabled(99, false)).toBe(false);
        expect(synth.setChannelEnabled(-1, true)).toBe(false);
    });

    it('keeps accepted calls working after a rejected call', () => {
        expect(synth.setTrackOptions(999, TrackOption.OFF)).toBe(false);
        expect(synth.setTrackOptions(1, TrackOption.OFF)).toBe(true);
        expect(synth.getTrackCount()).toBeGreaterThan(1);
        expect(synth.setTrackOptions(1, TrackOption.ON)).toBe(true);
    });
});

describe('Mixer state across file reloads', () => {
    let synth;

    beforeAll(async () => {
        synth = await AdlMidiCore.create({ corePath: CORE_URL });
        synth.init(44100);
    });

    afterAll(() => synth?.close());

    it('track count and titles follow the newly loaded file', () => {
        synth.loadMidi(readFileSync(MULTITRACK));
        expect(synth.getTrackCount()).toBe(3);
        expect(synth.getTrackTitleCount()).toBe(2);
        expect(synth.getTrackTitle(0)).toBe('Bass');
        expect(synth.getTrackTitle(1)).toBe('Lead');

        synth.loadMidi(readFileSync(CANYON));
        expect(synth.getTrackCount()).toBe(1);
        expect(synth.getTrackTitleCount()).toBe(0);
    });

    it('a previously muted/soloed track does not silence the new file', () => {
        synth.loadMidi(readFileSync(MULTITRACK));
        synth.setLoopEnabled(true);

        expect(synth.setTrackOptions(1, TrackOption.OFF)).toBe(true);
        expect(synth.setTrackOptions(2, TrackOption.OFF)).toBe(true);
        expect(synth.setChannelEnabled(0, false)).toBe(true);

        expect(synth.loadMidi(readFileSync(MULTITRACK))).toBe(true);
        const peak = renderPeak(synth, 0.4);
        expect(peak).toBeGreaterThan(0.005);
    });

    it('solo state does not leak into the next file', () => {
        synth.loadMidi(readFileSync(MULTITRACK));
        expect(synth.setTrackOptions(2, TrackOption.SOLO)).toBe(true);
        synth.setLoopEnabled(true);
        renderPeak(synth, 0.3);

        expect(synth.loadMidi(readFileSync(CANYON))).toBe(true);
        synth.setLoopEnabled(true);

        // If the solo flag survived the reload, canyon would produce silence.
        // Canyon's intro ramps up over a second, so measure the whole window.
        const peak = renderPeak(synth, 1.5);
        expect(peak).toBeGreaterThan(0.005);

        // And muting canyon's only track afterwards really does silence it,
        // proving the audio we just measured came through the mixer path.
        expect(synth.setTrackOptions(0, TrackOption.OFF)).toBe(true);
        renderPeak(synth, 0.3);
        const muted = settlePeak(synth, 0.2);
        expect(muted).toBeLessThan(0.01);
        expect(muted).toBeLessThan(peak * 0.25);
    });
});
