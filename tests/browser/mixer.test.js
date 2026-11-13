/**
 * Mixer panel tests for examples/player.html
 *
 * These drive the real page against the real AudioWorklet processor and
 * check both the audible evidence (the output peak meter, sourced from the
 * most recently generated sample buffer) and the failure reporting paths.
 */

import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

/** Parse "'0.123'" out of the peak display. */
function parsePeak(text) {
    const value = parseFloat(String(text).trim());
    return Number.isFinite(value) ? value : 0;
}

/** Read the peak meter, waiting for `ms` of audio to be generated first. */
async function readPeak(page, ms = 1200) {
    await page.waitForTimeout(ms);
    return parsePeak(await page.locator('#peakValue').textContent());
}

async function initPlayer(page) {
    await page.goto('/examples/player.html');
    await page.click('#initBtn');
    await expect(page.locator('#status')).toContainText('Ready', { timeout: 20000 });
}

async function loadMidi(page, relativePath) {
    await page.locator('#fileInput').setInputFiles(join(REPO_ROOT, relativePath));
    await expect(page.locator('#status')).toContainText('Loaded:', { timeout: 15000 });
}

test.describe('Mixer controls before a file is loaded', () => {

    test('controls are absent/disabled with a stated reason', async ({ page }) => {
        await page.goto('/examples/player.html');

        await expect(page.locator('#mixerHint')).toBeVisible();
        await expect(page.locator('#mixerHint')).toContainText('Load a MIDI file');

        // Before Initialize there are no track rows and no channel switches.
        await expect(page.locator('.track-row')).toHaveCount(0);
        await expect(page.locator('.channel-toggle')).toHaveCount(0);

        await initPlayer(page);

        // After Initialize but before a file, the hint stays and no tracks exist.
        await expect(page.locator('#mixerHint')).toBeVisible();
        await expect(page.locator('#mixerHint')).toContainText('Load a MIDI file');
        await expect(page.locator('.track-row')).toHaveCount(0);

        // The channel grid is rendered but every switch is disabled.
        const inputs = page.locator('.channel-toggle input');
        await expect(inputs).toHaveCount(16);
        for (let i = 0; i < 16; i++) await expect(inputs.nth(i)).toBeDisabled();

        expect(await page.locator('#peakValue').textContent()).toBe('--');
        await expect(page.locator('#peakSource')).toContainText('no file loaded');
    });

    test('channel switches remain disabled until a MIDI file is loaded', async ({ page }) => {
        await initPlayer(page);

        const inputs = page.locator('.channel-toggle input');
        const count = await inputs.count();
        expect(count).toBe(16);
        for (let i = 0; i < count; i++) {
            await expect(inputs.nth(i)).toBeDisabled();
        }
    });
});

test.describe('Mixer track controls', () => {

    test.beforeEach(async ({ page }) => {
        await initPlayer(page);
        await loadMidi(page, 'test-files/canyon.mid');
    });

    test('lists every track with On/Off/Solo tri-state buttons', async ({ page }) => {
        const rows = page.locator('.track-row');
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThan(0);

        for (let i = 0; i < rowCount; i++) {
            const row = rows.nth(i);
            await expect(row.locator('button[data-option="on"]')).toBeVisible();
            await expect(row.locator('button[data-option="off"]')).toBeVisible();
            await expect(row.locator('button[data-option="solo"]')).toBeVisible();
            // Untitled tracks still get a recognizable placeholder name.
            await expect(row.locator('.track-name')).toContainText(String(i));
        }

        await expect(page.locator('.channel-toggle input')).toHaveCount(16);
        await expect(page.locator('#mixerHint')).not.toBeVisible();
    });

    test('muting all tracks drops the peak, restoring brings it back', async ({ page }) => {
        await page.click('#playBtn');
        await expect(page.locator('#playBtn')).toContainText('Pause');

        const playing = await readPeak(page, 2500);
        expect(playing).toBeGreaterThan(0.005);

        const rowCount = await page.locator('.track-row').count();
        for (let i = 0; i < rowCount; i++) {
            await page.locator(`.track-row[data-track-index="${i}"] button[data-option="off"]`).click();
        }
        const muted = await readPeak(page, 2500);
        expect(muted).toBeLessThan(playing * 0.25);

        for (let i = 0; i < rowCount; i++) {
            await page.locator(`.track-row[data-track-index="${i}"] button[data-option="on"]`).click();
        }
        const restored = await readPeak(page, 2000);
        expect(restored).toBeGreaterThan(muted * 4);

        // Active button state follows the real call, not just local UI state.
        await expect(page.locator('.segmented button.active[data-option="on"]')).toHaveCount(rowCount);
    });

    test('soloing a track sets the Solo tri-state and clearing restores On', async ({ page }) => {
        const row = page.locator('.track-row[data-track-index="0"]');
        await row.locator('button[data-option="solo"]').click();
        await expect(row.locator('button[data-option="solo"]')).toHaveClass(/active/);

        // Changing any track back to On leaves solo mode.
        await row.locator('button[data-option="on"]').click();
        await expect(row.locator('button[data-option="on"]')).toHaveClass(/active/);
        await expect(page.locator('.segmented button.active[data-option="solo"]')).toHaveCount(0);
    });
});

test.describe('Mixer channel controls', () => {

    test.beforeEach(async ({ page }) => {
        await initPlayer(page);
        await loadMidi(page, 'test-files/canyon.mid');
        await page.click('#playBtn');
        await expect(page.locator('#playBtn')).toContainText('Pause');
    });

    test('disabling channels lowers the peak and re-enabling raises it', async ({ page }) => {
        const playing = await readPeak(page, 2500);
        expect(playing).toBeGreaterThan(0.005);

        for (let channel = 0; channel < 16; channel++) {
            await page.locator(`.channel-toggle[data-channel="${channel}"] input`).uncheck();
        }
        const disabled = await readPeak(page, 2500);
        expect(disabled).toBeLessThan(playing * 0.25);

        for (let channel = 0; channel < 16; channel++) {
            await page.locator(`.channel-toggle[data-channel="${channel}"] input`).check();
        }
        const restored = await readPeak(page, 2000);
        expect(restored).toBeGreaterThan(disabled * 4);
    });
});

test.describe('Mixer failure reporting', () => {

    test.beforeEach(async ({ page }) => {
        await initPlayer(page);
        await loadMidi(page, 'test-files/canyon.mid');
    });

    test('an invalid track index surfaces a failure instead of being ignored', async ({ page }) => {
        // Set up a visible row for an out-of-range track, then drive the real
        // handler with it. libADLMIDI returns -1 for invalid track numbers,
        // which the wrapper turns into a rejection.
        await page.evaluate(() => {
            const list = document.getElementById('trackList');
            const row = document.createElement('div');
            row.className = 'track-row';
            row.dataset.trackIndex = '999';
            row.innerHTML = '<span class="track-name">999: out of range</span><span class="track-status"></span>';
            list.appendChild(row);
        });

        await page.evaluate(() => window.playerHandleTrackOption(999, 'off'));
        await expect(page.locator('.track-row[data-track-index="999"]')).toHaveClass(/failed/);
        await expect(page.locator('#mixerErrors')).toContainText('Failed to set track options for track 999');
    });

    test('an invalid channel number surfaces a failure instead of being ignored', async ({ page }) => {
        await page.evaluate(() => window.playerHandleChannelEnabled(99, false));
        await expect(page.locator('#mixerErrors')).toContainText('Channel 99');
    });

    test('a rejected setTrackOptions marks the track row instead of silently ignoring', async ({ page }) => {
        // Make the real method reject, as it does for an invalid track index.
        await page.evaluate(() => {
            const synth = window.playerSynth();
            synth.__realSetTrackOptions = synth.setTrackOptions.bind(synth);
            synth.setTrackOptions = () => Promise.reject(
                new Error('Failed to set track options for track 0')
            );
        });

        await page.locator('.track-row[data-track-index="0"] button[data-option="off"]').click();

        const row = page.locator('.track-row[data-track-index="0"]');
        await expect(row).toHaveClass(/failed/);
        await expect(row.locator('.track-status')).toContainText('failed');
        await expect(page.locator('#mixerErrors')).toContainText('Failed to set track options');

        // Local state must not pretend the mute succeeded.
        await expect(row.locator('button[data-option="off"]')).not.toHaveClass(/active/);
        await expect(row.locator('button[data-option="on"]')).toHaveClass(/active/);
    });

    test('a rejected solo leaves the previous solo marker intact', async ({ page }) => {
        await page.locator('.track-row[data-track-index="0"] button[data-option="solo"]').click();
        await expect(page.locator('.segmented button.active[data-option="solo"]')).toHaveCount(1);

        await page.evaluate(() => {
            const synth = window.playerSynth();
            synth.setTrackOptions = () => Promise.reject(new Error('solo rejected'));
        });

        await page.evaluate(() => window.playerHandleTrackOption(999, 'solo'));
        // Track 999 never became solo; the real soloed track still shows Solo.
        await expect(page.locator('.segmented button.active[data-option="solo"]')).toHaveCount(1);
        await expect(page.locator('#mixerErrors')).toContainText('solo rejected');
    });

    test('a false return from setTrackOptions marks the track row', async ({ page }) => {
        await page.evaluate(() => {
            const synth = window.playerSynth();
            synth.setTrackOptions = async () => false;
        });

        await page.locator('.track-row[data-track-index="0"] button[data-option="off"]').click();

        const row = page.locator('.track-row[data-track-index="0"]');
        await expect(row).toHaveClass(/failed/);
        await expect(page.locator('#mixerErrors')).toContainText('returned false');
    });

    test('a false return from setChannelEnabled marks the channel', async ({ page }) => {
        await page.evaluate(() => {
            const synth = window.playerSynth();
            synth.setChannelEnabled = async () => false;
        });

        // Click directly: uncheck() would wait for the DOM state to change,
        // which the panel deliberately reverts when the call fails.
        await page.locator('.channel-toggle[data-channel="3"] input').click();

        const toggle = page.locator('.channel-toggle[data-channel="3"]');
        await expect(toggle).toHaveClass(/failed/);
        await expect(page.locator('#mixerErrors')).toContainText('Channel 3');

        // The checkbox reflects the real (failed) state rather than the click.
        await expect(toggle.locator('input')).toBeChecked();
    });
});

test.describe('Mixer state after reloading a file', () => {

    test('switching to a file with fewer tracks drops stale rows and solo flags', async ({ page }) => {
        await initPlayer(page);

        await loadMidi(page, 'tests/fixtures/multitrack.mid');
        const rows = page.locator('.track-row');
        expect(await rows.count()).toBeGreaterThan(1);

        // Leave the mixer in a distinctly non-default state.
        await page.locator('.track-row[data-track-index="1"] button[data-option="off"]').click();
        await page.locator('.track-row[data-track-index="2"] button[data-option="solo"]').click();
        await page.locator('.channel-toggle[data-channel="4"] input').uncheck();
        await expect(page.locator('.segmented button.active[data-option="solo"]')).toHaveCount(1);
        await expect(page.locator('.channel-toggle input:not(:checked)')).toHaveCount(1);

        // Reload a single-track file.
        await loadMidi(page, 'test-files/canyon.mid');

        // The list now matches the new file: one row, all On, no solo marker.
        await expect(page.locator('.track-row')).toHaveCount(1);
        await expect(page.locator('.segmented button.active[data-option="solo"]')).toHaveCount(0);
        await expect(page.locator('.segmented button.active[data-option="off"]')).toHaveCount(0);
        await expect(page.locator('.segmented button.active[data-option="on"]')).toHaveCount(1);

        // All channels are on again and prior errors are cleared.
        await expect(page.locator('.channel-toggle input:not(:checked)')).toHaveCount(0);
        expect(await page.locator('#mixerErrors').textContent()).toBe('');

        // The old file's mute state really is gone from the audio path.
        await page.click('#playBtn');
        const peak = await readPeak(page, 2500);
        expect(peak).toBeGreaterThan(0.005);
    });

    test('track names belong to the new file', async ({ page }) => {
        await initPlayer(page);

        await loadMidi(page, 'tests/fixtures/multitrack.mid');
        const labels = await page.locator('.track-name').allTextContents();
        expect(labels.join(' ')).toContain('Bass');
        expect(labels.join(' ')).toContain('Lead');

        await loadMidi(page, 'test-files/canyon.mid');
        const newLabels = await page.locator('.track-name').allTextContents();
        expect(newLabels).toHaveLength(1);
        expect(newLabels.join(' ')).not.toContain('Bass');
        expect(newLabels.join(' ')).not.toContain('Lead');
    });

    test('a failed load clears the list and disables controls again', async ({ page }) => {
        await initPlayer(page);

        await loadMidi(page, 'tests/fixtures/multitrack.mid');
        await page.locator('.track-row[data-track-index="2"] button[data-option="solo"]').click();
        await expect(page.locator('.segmented button.active[data-option="solo"]')).toHaveCount(1);

        // Loading a file the sequencer cannot parse must not keep stale controls.
        await page.locator('#fileInput').setInputFiles(join(REPO_ROOT, 'tests/fixtures/invalid.mid'));
        await expect(page.locator('#status')).toContainText('Error', { timeout: 15000 });

        await expect(page.locator('.track-row')).toHaveCount(0);
        await expect(page.locator('#mixerHint')).toBeVisible();
        await expect(page.locator('.segmented button.active[data-option="solo"]')).toHaveCount(0);
        await expect(page.locator('#mixerErrors')).toHaveText('');
        await expect(page.locator('#peakValue')).toHaveText('--');

        const inputs = page.locator('.channel-toggle input');
        for (let i = 0; i < 16; i++) await expect(inputs.nth(i)).toBeDisabled();
    });
});
