// Acceptance tests for the <embetty-video> state-management fixes.
//
// Run with: npm test
//
// Scenarios covered:
//   1. Normal source switching (poster + data invalidation)
//   2. Request failures (non-2xx and invalid JSON) -> observable error state
//   3. Out-of-order responses -> only the last source is ever shown
//   4. Facebook activation before metadata arrives -> no "undefined" iframe
//   5. YouTube / Vimeo / native iframe generation still works
//   6. Endpoint paths and serverUrl/_api rules remain unchanged
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Vue from 'vue/dist/vue.common.dev.js';

import facebookA from './fixtures/facebook-a.json' with { type: 'json' };
import facebookB from './fixtures/facebook-b.json' with { type: 'json' };
import {
  SERVER_URL,
  MockFetch,
  MockImage,
  loadComponents,
  closeVite,
  installWindowMocks,
  mountVideo,
  mountComponent,
  flushMicrotasks,
  deferred
} from './helpers/harness.mjs';

let EmbettyVideo;
let EmbettyTweet;
const fetchMock = new MockFetch();

before(async () => {
  const components = await loadComponents();
  EmbettyVideo = components.EmbettyVideo;
  EmbettyTweet = components.EmbettyTweet;
  installWindowMocks(fetchMock);
});

after(async () => {
  await closeVite();
});

beforeEach(() => {
  fetchMock.reset();
  MockImage.reset();
});

const FACEBOOK_A = { type: 'facebook', videoId: '111111111111111' };
const FACEBOOK_B = { type: 'facebook', videoId: '222222222222222' };

// ---------------------------------------------------------------------------
// 1. Normal switching: old poster and data are invalidated immediately
// ---------------------------------------------------------------------------
test('switching video-id hides the old poster until the new one loads and replaces the data', async () => {
  const dataA = deferred();
  const dataB = deferred();
  fetchMock
    .route(`/video/facebook/${FACEBOOK_A.videoId}`, async () => {
      await dataA.promise;
      return { status: 200, body: facebookA };
    })
    .route(`/video/facebook/${FACEBOOK_B.videoId}`, async () => {
      await dataB.promise;
      return { status: 200, body: facebookB };
    });

  const { video, setProps } = mountVideo(EmbettyVideo, FACEBOOK_A);

  // A's initial request is still in flight; nothing has been fetched yet
  assert.equal(video.fetched, false);
  dataA.resolve();
  await flushMicrotasks();
  assert.equal(video.fetched, true);
  assert.deepEqual(video.data, facebookA);

  // initial poster preload is pending (not shown until loaded)
  assert.equal(video.posterLoaded, false);
  assert.match(video.posterImageUrl, /111111111111111-poster-image/);
  MockImage.resolve('111111111111111-poster-image');
  assert.equal(video.posterLoaded, true);

  // --- switch source A -> B (B's response kept pending) ---
  await setProps({ videoId: FACEBOOK_B.videoId });

  // old data and poster must be gone immediately, before B responds
  assert.equal(video.fetched, false, 'fetched flag reset on source change');
  assert.equal(video.data, undefined, 'old data invalidated immediately');
  assert.equal(video.posterLoaded, false, 'old poster hidden immediately');
  assert.equal(video.activated, false, 'activated state reset on source change');
  assert.equal(video.error, null);
  assert.match(video.posterImageUrl, /222222222222222-poster-image/);

  // B's metadata and poster now arrive
  dataB.resolve();
  await flushMicrotasks();
  assert.deepEqual(video.data, facebookB);
  assert.equal(video.fetched, true);
  MockImage.resolve('222222222222222-poster-image');
  assert.equal(video.posterLoaded, true);
  assert.match(video.posterImageUrl, /222222222222222-poster-image/);
});

test('switching type resets state and requests the new platform endpoints', async () => {
  const dataA = deferred();
  fetchMock.route('/video/facebook/', async () => {
    await dataA.promise;
    return { status: 200, body: facebookA };
  });
  const { video, setProps } = mountVideo(EmbettyVideo, FACEBOOK_A);
  dataA.resolve();
  await flushMicrotasks();
  MockImage.resolve('111111111111111-poster-image');
  assert.equal(video.posterLoaded, true);

  await setProps({ type: 'youtube', videoId: 'm6UOo2YGbIE' });

  assert.equal(video.activated, false);
  assert.equal(video.activating, false);
  assert.equal(video.posterLoaded, false);
  assert.equal(video.data, undefined);
  // YouTube needs no metadata endpoint, so its data URL is undefined
  assert.equal(video.url, undefined);
  assert.match(video.posterImageUrl, /\/video\/youtube\/m6UOo2YGbIE-poster-image/);
});

// ---------------------------------------------------------------------------
// 2. Request failures -> observable error state, no half-finished data
// ---------------------------------------------------------------------------
test('non-2xx response puts the component into an exposed error state', async () => {
  fetchMock.route('/video/facebook/111111111111111', { status: 500, body: { error: 'boom' } });
  const { video, render } = mountVideo(EmbettyVideo, FACEBOOK_A);

  await flushMicrotasks();

  assert.ok(video.error instanceof Error, 'error data is exposed');
  assert.match(video.error.message, /500/);
  assert.equal(video.fetched, false, 'failed request is not marked fetched');
  assert.equal(video.data, undefined, 'no half-finished data kept');

  const html = await render();
  assert.match(html, /could not be loaded/i, 'template shows an error message');
  assert.match(html, /role="alert"/, 'error is marked up as an alert');
});

test('invalid JSON puts the component into the error state', async () => {
  fetchMock.route('/video/facebook/111111111111111', { status: 200, invalidJson: true });
  const { video } = mountVideo(EmbettyVideo, FACEBOOK_A);

  await flushMicrotasks();

  assert.ok(video.error instanceof Error);
  assert.equal(video.fetched, false);
  assert.equal(video.data, undefined);
});

test('network failure (fetch rejects) is caught and exposed as an error', async () => {
  fetchMock.route('/video/facebook/111111111111111', {
    throwError: new TypeError('Failed to fetch')
  });
  const { video } = mountVideo(EmbettyVideo, FACEBOOK_A);

  await flushMicrotasks();

  assert.ok(video.error instanceof TypeError);
  assert.equal(video.fetched, false);
});

test('retry clears the error and a successful follow-up request restores the data', async () => {
  // first attempt fails, then a retry succeeds
  let attempt = 0;
  fetchMock.route('/video/facebook/111111111111111', () => {
    attempt++;
    return attempt === 1
      ? { status: 503, body: {} }
      : { status: 200, body: facebookA };
  });

  const { video, render } = mountVideo(EmbettyVideo, FACEBOOK_A);
  await flushMicrotasks();
  assert.ok(video.error instanceof Error);
  assert.match(await render(), /Retry/);

  video.retry();
  assert.equal(video.error, null, 'error cleared on retry');
  assert.equal(video.fetched, false);
  await flushMicrotasks();

  assert.equal(video.error, null);
  assert.equal(video.fetched, true);
  assert.deepEqual(video.data, facebookA);
});

test('_continueActivation is a no-op until data is present, so no undefined iframe is built', () => {
  fetchMock.route('/video/facebook/111111111111111', { status: 200, body: facebookA });
  const { video } = mountVideo(EmbettyVideo, FACEBOOK_A);

  // nothing pending and nothing fetched -> guard does nothing
  video._continueActivation();
  assert.equal(video.activated, false);

  video.activate();
  assert.equal(video.activating, true);
  // still no data -> continuation must not activate
  video._continueActivation();
  assert.equal(video.activated, false);
  assert.equal(video.iframe, '');
});

// ---------------------------------------------------------------------------
// 3. Out-of-order responses: the last source always wins
// ---------------------------------------------------------------------------
test('rapid A -> B switch: the slower first response never overwrites B', async () => {
  // Deferred handlers so we control the exact resolution order.
  const requestA = deferred();
  const requestB = deferred();

  fetchMock
    .route('/video/facebook/111111111111111', async () => {
      await requestA.promise;
      return { status: 200, body: facebookA };
    })
    .route('/video/facebook/222222222222222', async () => {
      await requestB.promise;
      return { status: 200, body: facebookB };
    });

  const { video, setProps } = mountVideo(EmbettyVideo, FACEBOOK_A);
  // immediately switch to B before either response comes back
  await setProps({ videoId: FACEBOOK_B.videoId });

  assert.equal(video.data, undefined);
  assert.equal(video.fetched, false);

  // B (the last requested source) resolves first...
  requestB.resolve();
  await flushMicrotasks();
  assert.deepEqual(video.data, facebookB, 'B data applied');

  // ...then the stale A response resolves and must be discarded
  requestA.resolve();
  await flushMicrotasks();
  assert.deepEqual(video.data, facebookB, 'stale A response does not overwrite B');
  assert.equal(video.fetched, true);
  assert.equal(video.error, null);
});

test('out-of-order poster loads: a slow old poster never replaces the new one', async () => {
  const requestA = deferred();
  const requestB = deferred();
  fetchMock
    .route(`/video/facebook/${FACEBOOK_A.videoId}`, async () => {
      await requestA.promise;
      return { status: 200, body: facebookA };
    })
    .route(`/video/facebook/${FACEBOOK_B.videoId}`, async () => {
      await requestB.promise;
      return { status: 200, body: facebookB };
    });

  const { video, setProps } = mountVideo(EmbettyVideo, FACEBOOK_A);
  requestA.resolve();
  await flushMicrotasks();

  // switch before A's poster finishes loading
  await setProps({ videoId: FACEBOOK_B.videoId });
  requestB.resolve();
  await flushMicrotasks();

  // two poster preloads are now pending; A's is the older one
  assert.equal(video.posterLoaded, false);

  // A's slow poster resolves after the switch -> must be ignored
  MockImage.resolve('111111111111111-poster-image');
  assert.equal(video.posterLoaded, false, 'stale poster A is discarded');
  assert.match(video.posterImageUrl, /222222222222222/);

  // B's poster then loads and is shown
  MockImage.resolve('222222222222222-poster-image');
  assert.equal(video.posterLoaded, true);
});

// ---------------------------------------------------------------------------
// 4. Facebook: activating before metadata arrives never yields "undefined"
// ---------------------------------------------------------------------------
test('Facebook play click before metadata stays inactive and shows a loading state', async () => {
  const request = deferred();
  fetchMock.route('/video/facebook/111111111111111', async () => {
    await request.promise;
    return { status: 200, body: facebookA };
  });

  const { video, render } = mountVideo(EmbettyVideo, FACEBOOK_A);
  assert.equal(video.fetched, false);

  video.activate();
  assert.equal(video.activated, false, 'stays inactive while data is missing');
  assert.equal(video.activating, true, 'enters the waiting/loading state');
  assert.equal(video.iframe, '', 'no iframe built from undefined data');

  const loadingHtml = await render();
  assert.match(loadingHtml, /Loading…/, 'loading indicator rendered');
  assert.doesNotMatch(loadingHtml, /undefined/, 'no "undefined" in rendered output');

  // once metadata arrives, the `fetched` watcher (flushed by Vue's scheduler
  // in a real browser) continues the pending activation via _continueActivation
  request.resolve();
  await flushMicrotasks();
  assert.equal(video.fetched, true);
  video._continueActivation();
  assert.equal(video.activated, true);
  assert.equal(video.activating, false);
  assert.match(video.iframe, /plugins\/video\.php/);
  assert.ok(
    video.iframe.includes(encodeURIComponent(facebookA.canonicalUrl)),
    'iframe contains the encoded canonical URL from the fetched metadata'
  );
  assert.doesNotMatch(video.iframe, /undefined/);

  // the activated template renders the iframe inside its wrapper
  const activatedHtml = await render();
  assert.match(activatedHtml, /class="wrapper/);
  assert.match(activatedHtml, /facebook\.com\/plugins\/video\.php/);
  assert.doesNotMatch(activatedHtml, /undefined/);
});

test('Facebook play click after a failed request shows the error, not an iframe', async () => {
  fetchMock.route('/video/facebook/111111111111111', { status: 502, body: {} });
  const { video, render } = mountVideo(EmbettyVideo, FACEBOOK_A);
  await flushMicrotasks();

  video.activate();
  assert.equal(video.activated, false);
  assert.ok(video.error instanceof Error);
  assert.doesNotMatch(video.iframe, /undefined/);

  const html = await render();
  assert.match(html, /could not be loaded/i);
  assert.doesNotMatch(html, /plugins\/video\.php/, 'no iframe rendered in the error state');
});

// ---------------------------------------------------------------------------
// 5. YouTube, Vimeo and native iframe generation remains intact
// ---------------------------------------------------------------------------
test('YouTube iframe generation is unchanged and activates without server data', () => {
  const { video } = mountVideo(EmbettyVideo, {
    type: 'youtube',
    videoId: 'm6UOo2YGbIE',
    startAt: 10
  });

  assert.equal(video._requiresData, false);
  video.activate();
  assert.equal(video.activated, true);
  assert.match(video.iframe, /https:\/\/www\.youtube-nocookie\.com\/embed\/m6UOo2YGbIE\?autoplay=1&start=10/);
});

test('Vimeo iframe generation is unchanged', () => {
  const { video } = mountVideo(EmbettyVideo, {
    type: 'vimeo',
    videoId: '1084537',
    startAt: 97
  });

  video.activate();
  assert.match(video.iframe, /https:\/\/player\.vimeo\.com\/video\/1084537\?autoplay=1#t=97/);
});

test('native video iframe (video element) generation is unchanged', () => {
  const nativeUrl = 'https://example.com/videos/clip.mp4';
  const { video } = mountVideo(EmbettyVideo, { type: 'native', videoId: nativeUrl });

  assert.equal(video.posterImageUrl, undefined, 'native has no poster endpoint');
  video.activate();
  assert.match(video.iframe, /<video /);
  assert.match(video.iframe, new RegExp(`<source src="${nativeUrl}"`));
});

// ---------------------------------------------------------------------------
// 6. Endpoint paths and serverUrl/_api rules remain unchanged
// ---------------------------------------------------------------------------
test('platform endpoint paths and _api concatenation are preserved', () => {
  const { video: youtube } = mountVideo(EmbettyVideo, {
    type: 'youtube',
    videoId: 'm6UOo2YGbIE'
  });
  assert.equal(
    youtube.posterImageUrl,
    `${SERVER_URL}/video/youtube/m6UOo2YGbIE-poster-image`
  );
  assert.equal(youtube.url, undefined);

  const { video: vimeo } = mountVideo(EmbettyVideo, {
    type: 'vimeo',
    videoId: '1084537'
  });
  assert.equal(vimeo.posterImageUrl, `${SERVER_URL}/video/vimeo/1084537-poster-image`);

  const { video: facebook } = mountVideo(EmbettyVideo, FACEBOOK_A);
  assert.equal(
    facebook.posterImageUrl,
    `${SERVER_URL}/video/facebook/111111111111111-poster-image`
  );
  assert.equal(facebook.url, `${SERVER_URL}/video/facebook/111111111111111`);
});

test('component-level serverUrl overrides the global fallback via the same _api rule', () => {
  Vue.prototype._embettyVueOptions = { serverUrl: SERVER_URL };
  const local = mountVideo(EmbettyVideo, {
    type: 'youtube',
    videoId: 'm6UOo2YGbIE',
    serverUrl: 'https://custom.example'
  });
  assert.equal(
    local.video.posterImageUrl,
    'https://custom.example/video/youtube/m6UOo2YGbIE-poster-image'
  );
});

// ---------------------------------------------------------------------------
// 7. Shared base class (EmbettyEmbed) regression via EmbettyTweet
// ---------------------------------------------------------------------------
test('EmbettyTweet still receives fetched data through the rewritten base class', async () => {
  const tweet = {
    id_str: '1234567',
    full_text: 'hello world',
    user: { name: 'Name', screen_name: 'handle' },
    entities: {},
    extended_entities: {},
    created_at: 'Mon Jan 01 00:00:00 +0000 2024'
  };
  fetchMock.route('/tweet/1234567', { status: 200, body: tweet });

  const { child } = mountComponent(EmbettyTweet, { status: '1234567' });
  await flushMicrotasks();

  assert.equal(child.fetched, true);
  assert.equal(child.error, null);
  assert.equal(child.data.full_text, 'hello world');
  assert.match(child.url, /\/tweet\/1234567$/);
});

test('EmbettyTweet surfaces an error instead of half-finished data on failure', async () => {
  fetchMock.route('/tweet/7654321', { status: 404, body: {} });

  const { child } = mountComponent(EmbettyTweet, { status: '7654321' });
  await flushMicrotasks();

  assert.ok(child.error instanceof Error);
  assert.equal(child.fetched, false);
  assert.equal(child.data, undefined);
});
