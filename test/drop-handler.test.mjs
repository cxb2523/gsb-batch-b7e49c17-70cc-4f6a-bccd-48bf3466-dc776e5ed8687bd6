import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';

import DropHandler from '@client/service/DropHandler';
import SubtitleConverter from '@client/service/SubtitleConverter';
import Youtube from '@client/service/Youtube';
import playerReducer, {
    PLAYER_LOAD_FROM_FILE,
    PLAYER_LOAD_FROM_YOUTUBE,
    PLAYER_LOAD_SUBTITLE,
    PLAYER_COMPLETE_FROM_FILE,
} from '@client/store/player';

/**
 * Minimal XMLHttpRequest replacement reproducing the parts used by
 * HeadRequest/GetRequest. Responses are configured per "METHOD url".
 */
class FakeXMLHttpRequest {
    static routes = new Map();
    static instances = [];

    static reset() {
        this.routes.clear();
        this.instances = [];
    }

    static route(method, url, { status = 200, headers = {}, body = '', networkError = false } = {}) {
        this.routes.set(`${method} ${url}`, { status, headers, body, networkError });

        return this;
    }

    constructor() {
        this.listeners = new Map();
        this.responseHeaders = {};
        this.responseText = '';
        this.readyState = 0;
        this.status = 0;
        this.method = null;
        this.url = null;
        FakeXMLHttpRequest.instances.push(this);
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }

        this.listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
        const listeners = this.listeners.get(type);

        if (listeners) {
            this.listeners.set(type, listeners.filter(item => item !== listener));
        }
    }

    open(method, url) {
        this.method = method;
        this.url = url;
        this.readyState = 1;
    }

    send() {
        const route = FakeXMLHttpRequest.routes.get(`${this.method} ${this.url}`);

        queueMicrotask(() => {
            if (!route) {
                this.status = 404;
                this.readyState = 4;
                this.dispatch('readystatechange');

                return;
            }

            if (route.networkError) {
                this.readyState = 4;
                this.dispatch('error');

                return;
            }

            this.status = route.status;
            this.readyState = 4;
            this.responseText = route.body;
            this.responseHeaders = Object.fromEntries(
                Object.entries(route.headers).map(([name, value]) => [name.toLowerCase(), value])
            );
            this.dispatch('readystatechange');
        });
    }

    getResponseHeader(name) {
        return this.responseHeaders[name.toLowerCase()] ?? null;
    }

    dispatch(type) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener.call(this, { type });
        }
    }
}

/**
 * Browser FileReader replacement: reads a File through its Blob API.
 */
class FakeFileReader {
    constructor() {
        this.listeners = new Map();
        this.result = null;
        this.error = null;
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }

        this.listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
        const listeners = this.listeners.get(type);

        if (listeners) {
            this.listeners.set(type, listeners.filter(item => item !== listener));
        }
    }

    readAsText(file) {
        file.text().then(
            text => {
                this.result = text;
                this.dispatch('load');
            },
            error => {
                this.error = error;
                this.dispatch('error');
            }
        );
    }

    dispatch(type) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener.call(this, { type });
        }
    }
}

let objectUrls;
let objectUrlId;
let originalCreateObjectURL;
let originalRevokeObjectURL;
let originalXMLHttpRequest;
let originalFileReader;

function createStore() {
    let state = { player: playerReducer(undefined, { type: '@@init' }) };
    const actions = [];

    return {
        actions,
        getState: () => state,
        dispatch(action) {
            actions.push(action);
            state = { ...state, player: playerReducer(state.player, action) };

            return action;
        },
    };
}

function captureConsole() {
    const calls = { info: [], error: [] };
    const original = { info: console.info, error: console.error };

    console.info = (...args) => calls.info.push(args.join(' '));
    console.error = (...args) => calls.error.push(args);

    return {
        calls,
        restore() {
            console.info = original.info;
            console.error = original.error;
        },
    };
}

function createConverter() {
    const converter = new SubtitleConverter();
    const calls = { file: 0, url: 0 };
    const fileMethod = converter.srtFileToVttFile.bind(converter);
    const urlMethod = converter.srtUrlToVttFile.bind(converter);

    converter.srtFileToVttFile = (file, callback) => {
        calls.file += 1;

        return fileMethod(file, callback);
    };

    converter.srtUrlToVttFile = (url, callback) => {
        calls.url += 1;

        return urlMethod(url, callback);
    };

    return { converter, calls };
}

function createHarness() {
    const store = createStore();
    const { converter, calls: converterCalls } = createConverter();
    const youtube = new Youtube('localhost');
    const handler = new DropHandler(store, converter, youtube);
    const consoleSpy = captureConsole();

    return { store, converter, converterCalls, youtube, handler, consoleSpy };
}

function videoActions(store) {
    return store.actions.filter(
        action => action.type === PLAYER_LOAD_FROM_FILE || action.type === PLAYER_COMPLETE_FROM_FILE
    );
}

function subtitleActions(store) {
    return store.actions.filter(action => action.type === PLAYER_LOAD_SUBTITLE);
}

async function settle() {
    for (let index = 0; index < 10; index += 1) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

function fileWith(content, name, type) {
    return new File([content], name, { type });
}

const SRT_CONTENT = [
    '1',
    '00:00:01,000 --> 00:00:02,000',
    'Hello',
    '',
    '2',
    '00:00:03,500 --> 00:00:04,250',
    'World',
    '',
].join('\n');

const VTT_CONTENT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';

beforeEach(() => {
    objectUrls = new Map();
    objectUrlId = 0;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalXMLHttpRequest = globalThis.XMLHttpRequest;
    originalFileReader = globalThis.FileReader;

    URL.createObjectURL = blob => {
        const url = `blob:test/${(objectUrlId += 1)}`;
        objectUrls.set(url, blob);

        return url;
    };
    URL.revokeObjectURL = url => objectUrls.delete(url);

    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
    globalThis.FileReader = FakeFileReader;
    FakeXMLHttpRequest.reset();
});

afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;

    if (originalXMLHttpRequest === undefined) {
        delete globalThis.XMLHttpRequest;
    } else {
        globalThis.XMLHttpRequest = originalXMLHttpRequest;
    }

    if (originalFileReader === undefined) {
        delete globalThis.FileReader;
    } else {
        globalThis.FileReader = originalFileReader;
    }
});

describe('drop handler: local files', () => {
    test('a .mkv file is loaded as video even when its MIME type is generic', () => {
        const { store, handler, consoleSpy } = createHarness();
        const file = fileWith('matroska', 'movie.mkv', 'application/octet-stream');

        handler.handleFile(file);

        const actions = videoActions(store);

        assert.equal(actions.length, 1);
        assert.equal(actions[0].type, PLAYER_LOAD_FROM_FILE);
        assert.equal(actions[0].payload.name, 'movie.mkv');
        assert.equal(actions[0].payload.type, 'application/octet-stream');
        assert.equal(actions[0].payload.source, 'file');
        assert.equal(subtitleActions(store).length, 0);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('a .mkv file with an empty MIME type is loaded as video', () => {
        const { store, handler } = createHarness();

        handler.handleFile(fileWith('matroska', 'movie.mkv', ''));

        assert.equal(videoActions(store).length, 1);
    });

    for (const name of ['movie.mp4', 'movie.webm', 'movie.mov']) {
        test(`a ${name} file keeps being loaded as video`, () => {
            const { store, handler } = createHarness();

            handler.handleFile(fileWith('video', name, 'application/octet-stream'));

            const actions = videoActions(store);

            assert.equal(actions.length, 1);
            assert.equal(subtitleActions(store).length, 0);
        });
    }

    test('the extension wins over a conflicting video MIME type for .srt', async () => {
        const { store, handler, converterCalls, consoleSpy } = createHarness();

        handler.handleFile(fileWith(SRT_CONTENT, 'subs.srt', 'video/mp4'));
        await settle();

        assert.equal(converterCalls.file, 1);
        assert.equal(videoActions(store).length, 0);
        assert.equal(subtitleActions(store).length, 1);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('a .srt file is converted to VTT before being loaded as a subtitle', async () => {
        const { store, handler, converterCalls, consoleSpy } = createHarness();

        handler.handleFile(fileWith(SRT_CONTENT, 'subs.srt', 'text/plain'));
        await settle();

        const subtitles = store.getState().player.subtitles;

        assert.equal(converterCalls.file, 1);
        assert.equal(subtitles.length, 1);
        assert.equal(subtitles[0].label, 'subs.vtt');
        assert.ok(objectUrls.has(subtitles[0].url));

        const converted = await objectUrls.get(subtitles[0].url).text();

        assert.match(converted, /^WEBVTT/);
        assert.match(converted, /00:00:01\.000 --> 00:00:02\.000/);
        assert.doesNotMatch(converted, /00:00:01,000/);
        assert.equal(store.actions.length, 1);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('a .vtt file is loaded as a subtitle as-is, without conversion', () => {
        const { store, handler, converterCalls, consoleSpy } = createHarness();

        handler.handleFile(fileWith(VTT_CONTENT, 'subs.vtt', 'application/octet-stream'));

        const subtitles = store.getState().player.subtitles;

        assert.equal(converterCalls.file, 0);
        assert.equal(subtitleActions(store).length, 1);
        assert.equal(subtitles.length, 1);
        assert.equal(subtitles[0].label, 'subs.vtt');
        assert.equal(objectUrls.get(subtitles[0].url).type, 'application/octet-stream');
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('the extension wins over a conflicting subtitle MIME type for .vtt', () => {
        const { store, handler } = createHarness();

        handler.handleFile(fileWith(VTT_CONTENT, 'subs.vtt', 'text/plain'));

        assert.equal(subtitleActions(store).length, 1);
        assert.equal(videoActions(store).length, 0);
    });

    test('an unknown extension falls back to a usable video MIME type without a duplicate warning', () => {
        const { store, handler, consoleSpy } = createHarness();

        handler.handleFile(fileWith('video', 'movie.data', 'video/mp4'));

        assert.equal(videoActions(store).length, 1);
        assert.equal(subtitleActions(store).length, 0);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('an unknown extension falls back to a usable subtitle MIME type', async () => {
        const { store, handler, consoleSpy } = createHarness();

        handler.handleFile(fileWith(SRT_CONTENT, 'subs.data', 'text/srt'));
        await settle();

        const subtitles = store.getState().player.subtitles;

        assert.equal(subtitleActions(store).length, 1);
        assert.equal(subtitles.length, 1);

        const converted = await objectUrls.get(subtitles[0].url).text();

        assert.match(converted, /^WEBVTT/);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('an unsupported file warns exactly once and dispatches nothing', () => {
        const { store, handler, consoleSpy } = createHarness();

        handler.handleFile(fileWith('notes', 'notes.txt', 'text/plain'));

        assert.equal(store.actions.length, 0);
        assert.equal(consoleSpy.calls.info.length, 1);
    });

    test('an unknown extension with a generic MIME type warns exactly once', () => {
        const { store, handler, consoleSpy } = createHarness();

        handler.handleFile(fileWith('binary', 'archive.bin', 'application/octet-stream'));

        assert.equal(store.actions.length, 0);
        assert.equal(consoleSpy.calls.info.length, 1);
    });
});

describe('drop handler: pasted URLs', () => {
    test('a YouTube URL is recognized before any HEAD request', () => {
        const { store, handler, consoleSpy } = createHarness();

        handler.handleText('https://youtu.be/BathEBfiG1s');

        const actions = store.actions;

        assert.equal(actions.length, 1);
        assert.equal(actions[0].type, PLAYER_LOAD_FROM_YOUTUBE);
        assert.equal(actions[0].payload.url, 'BathEBfiG1s');
        assert.equal(FakeXMLHttpRequest.instances.length, 0);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('a YouTube URL wins even when it looks like a video file URL', () => {
        const { store, handler } = createHarness();

        handler.handleText('https://youtu.be/BathEBfiG1s.mp4');

        assert.equal(store.actions[0].type, PLAYER_LOAD_FROM_YOUTUBE);
        assert.equal(FakeXMLHttpRequest.instances.length, 0);
    });

    for (const contentType of ['text/plain', 'application/octet-stream']) {
        test(`a .srt URL served as ${contentType} is converted to VTT`, async () => {
            const url = 'https://example.test/subtitles.srt';
            const { store, handler, converterCalls, consoleSpy } = createHarness();

            FakeXMLHttpRequest
                .route('HEAD', url, { headers: { 'Content-Type': contentType } })
                .route('GET', url, { headers: { 'Content-Type': contentType }, body: SRT_CONTENT });

            handler.handleText(url);
            await settle();

            const subtitles = store.getState().player.subtitles;

            assert.equal(converterCalls.url, 1);
            assert.equal(converterCalls.file, 0);
            assert.equal(subtitleActions(store).length, 1);
            assert.equal(videoActions(store).length, 0);
            assert.equal(subtitles.length, 1);
            assert.equal(subtitles[0].label.endsWith('.vtt'), true);

            const converted = await objectUrls.get(subtitles[0].url).text();

            assert.match(converted, /^WEBVTT/);
            assert.doesNotMatch(converted, /00:00:01,000/);
            assert.deepEqual(consoleSpy.calls.info, []);
        });
    }

    test('an .SRT URL is recognized case-insensitively', async () => {
        const url = 'https://example.test/SUBS.SRT';
        const { store, handler, converterCalls } = createHarness();

        FakeXMLHttpRequest
            .route('HEAD', url, { headers: { 'Content-Type': 'text/plain' } })
            .route('GET', url, { headers: { 'Content-Type': 'text/plain' }, body: SRT_CONTENT });

        handler.handleText(url);
        await settle();

        assert.equal(converterCalls.url, 1);
        assert.equal(subtitleActions(store).length, 1);
        assert.equal(videoActions(store).length, 0);
    });

    test('a .vtt URL with an untrustworthy Content-Type is loaded directly', async () => {
        const url = 'https://example.test/subtitles.vtt';
        const { store, handler, converterCalls, consoleSpy } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url, { headers: { 'Content-Type': 'text/plain' } });

        handler.handleText(url);
        await settle();

        const actions = subtitleActions(store);

        assert.equal(converterCalls.url, 0);
        assert.equal(actions.length, 1);
        assert.equal(actions[0].payload.url, url);
        assert.equal(actions[0].payload.label, '/subtitles.vtt');
        assert.equal(store.getState().player.subtitles.length, 1);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('a .vtt URL with a charset parameter is normalized and accepted', async () => {
        const url = 'https://example.test/subtitles.vtt';
        const { store, handler } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url, { headers: { 'Content-Type': 'text/vtt; charset=utf-8' } });

        handler.handleText(url);
        await settle();

        assert.equal(subtitleActions(store).length, 1);
    });

    test('a .vtt URL with no Content-Type still relies on the extension', async () => {
        const url = 'https://example.test/subtitles.vtt';
        const { store, handler } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url);

        handler.handleText(url);
        await settle();

        assert.equal(subtitleActions(store).length, 1);
        assert.equal(store.getState().player.subtitles.length, 1);
    });

    for (const [name, url, contentType] of [
        ['mp4', 'https://example.test/movie.mp4', 'text/plain'],
        ['webm', 'https://example.test/movie.webm', 'application/octet-stream'],
        ['mov', 'https://example.test/movie.mov', 'text/plain'],
        ['mkv', 'https://example.test/movie.mkv', 'application/octet-stream'],
    ]) {
        test(`a .${name} URL served as ${contentType} is loaded as video`, async () => {
            const { store, handler, consoleSpy } = createHarness();

            FakeXMLHttpRequest.route('HEAD', url, { headers: { 'Content-Type': contentType } });

            handler.handleText(url);
            await settle();

            const actions = videoActions(store);

            assert.equal(actions.length, 1);
            assert.equal(actions[0].type, PLAYER_LOAD_FROM_FILE);
            assert.equal(actions[0].payload.url, url);
            assert.equal(subtitleActions(store).length, 0);
            assert.deepEqual(consoleSpy.calls.info, []);
        });
    }

    test('a URL without a known extension falls back to a video Content-Type', async () => {
        const url = 'https://example.test/download';
        const { store, handler, consoleSpy } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url, { headers: { 'Content-Type': 'video/mp4' } });

        handler.handleText(url);
        await settle();

        assert.equal(videoActions(store).length, 1);
        assert.deepEqual(consoleSpy.calls.info, []);
    });

    test('a URL without an extension keeps the generic binary video fallback', async () => {
        const url = 'https://example.test/download';
        const { store, handler } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url, { headers: { 'Content-Type': 'application/octet-stream' } });

        handler.handleText(url);
        await settle();

        assert.equal(videoActions(store).length, 1);
    });

    test('a URL without an extension and without a usable type warns exactly once', async () => {
        const url = 'https://example.test/download';
        const { store, handler, consoleSpy } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url, { headers: { 'Content-Type': 'text/plain' } });

        handler.handleText(url);
        await settle();

        assert.equal(store.actions.length, 0);
        assert.equal(consoleSpy.calls.info.length, 1);
    });

    test('an unknown extension with an unusable type warns exactly once', async () => {
        const url = 'https://example.test/notes.txt';
        const { store, handler, consoleSpy } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url, { headers: { 'Content-Type': 'text/plain' } });

        handler.handleText(url);
        await settle();

        assert.equal(store.actions.length, 0);
        assert.equal(consoleSpy.calls.info.length, 1);
    });

    test('the URL extension wins over a conflicting video Content-Type for .srt', async () => {
        const url = 'https://example.test/subtitles.srt';
        const { store, handler, converterCalls } = createHarness();

        FakeXMLHttpRequest
            .route('HEAD', url, { headers: { 'Content-Type': 'video/mp4' } })
            .route('GET', url, { headers: { 'Content-Type': 'video/mp4' }, body: SRT_CONTENT });

        handler.handleText(url);
        await settle();

        assert.equal(converterCalls.url, 1);
        assert.equal(subtitleActions(store).length, 1);
        assert.equal(videoActions(store).length, 0);
    });

    test('a failed HEAD request reports the error and dispatches nothing', async () => {
        const url = 'https://example.test/movie.mp4';
        const { store, handler, consoleSpy } = createHarness();

        FakeXMLHttpRequest.route('HEAD', url, { status: 404 });

        handler.handleText(url);
        await settle();

        assert.equal(store.actions.length, 0);
        assert.equal(consoleSpy.calls.error.length, 1);
    });

    test('a pasted non-URL text is ignored silently', () => {
        const { store, handler, consoleSpy } = createHarness();

        handler.handleText('just some text');

        assert.equal(store.actions.length, 0);
        assert.deepEqual(consoleSpy.calls.info, []);
        assert.equal(FakeXMLHttpRequest.instances.length, 0);
    });
});
