import assert from 'node:assert/strict';
import test from 'node:test';

const streamUrls = (
	process.env.E2E_STREAM_URLS ??
	'https://184.194.94.182/camera01/,https://184.194.94.182/camera03/'
)
	.split(',')
	.map((url) => url.trim())
	.filter(Boolean);

for (const streamUrl of streamUrls) {
	const cameraPath = new URL(streamUrl).pathname.replaceAll('/', '') || streamUrl;

	test(`la página real de reproducción de ${cameraPath} está disponible`, async () => {
		const response = await fetch(streamUrl, { signal: AbortSignal.timeout(20_000) });
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
	});
}
