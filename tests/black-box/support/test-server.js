import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { join } from 'node:path';

const apiKey = 'black-box-key';
const registeredAt = '2026-10-17T10:00:00.000Z';

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function createMockBackend(cameras, state) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (request.headers['x-api-key'] !== apiKey) {
      sendJson(response, 401, { detail: 'API key inválida' }); return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      if (!state.apiAvailable) {
        sendJson(response, 503, { detail: 'FastAPI no disponible' }); return;
      }
      sendJson(response, 200, { status: 'ok' }); return;
    }
    if (request.method === 'GET' && url.pathname === '/cameras') {
      sendJson(response, 200, { cameras }); return;
    }
    if (request.method === 'POST' && url.pathname === '/cameras') {
      const body = await readJson(request);
      const camera = { ...body, number: cameras.length + 1, registered_at: registeredAt };
      cameras.push(camera);
      sendJson(response, 201, { camera }); return;
    }
    if (request.method === 'PUT' && url.pathname.startsWith('/cameras/')) {
      const body = await readJson(request);
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      const index = cameras.findIndex((camera) => camera.source_id === id);
      const camera = { ...body, registered_at: registeredAt };
      if (index >= 0) cameras[index] = camera; else cameras.push(camera);
      sendJson(response, 200, { camera }); return;
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/cameras/')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      const index = cameras.findIndex((camera) => camera.source_id === id);
      if (index >= 0) cameras.splice(index, 1);
      sendJson(response, 200, { removed: true }); return;
    }
    if (request.method === 'POST' && url.pathname === '/sources/start') {
      const body = await readJson(request);
      sendJson(response, 200, { source_id: body.source_id, status: 'running' }); return;
    }
    if (request.method === 'DELETE' && /^\/sources\/[^/]+$/.test(url.pathname)) {
      sendJson(response, 200, { stopped: true }); return;
    }
    if (request.method === 'GET' && /\/sources\/[^/]+\/status$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/').at(-2));
      sendJson(response, 200, state.sources[id] ?? { status: 'running' }); return;
    }
    if (request.method === 'GET' && url.pathname === '/detections') {
      sendJson(response, 200, [{
        id: 'det-1', camera: url.searchParams.get('camera'), clase: 'Normal',
        confianza: 0.91, fecha_hora: '2026-10-17T10:01:00.000Z'
      }]); return;
    }
    if (request.method === 'GET' && url.pathname === '/alerts') {
      sendJson(response, 200, { items: [] }); return;
    }
    if (request.method === 'GET' && url.pathname === '/inference-logs') {
      sendJson(response, 200, { items: [{ id: 'log-1', level: 'INFO' }], total: 1 }); return;
    }
    sendJson(response, 404, { detail: 'Ruta simulada no encontrada' });
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function waitForVite(process, output, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`SvelteKit terminó antes de iniciar.\n${output()}`);
    if (output().includes('127.0.0.1')) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`SvelteKit no inició dentro del tiempo esperado.\n${output()}`);
}

export async function startTestApplication() {
  const projectRoot = process.cwd();
  const cameras = [{
    source_id: 'camara1', number: 1, name: 'Entrada', stream_path: 'camera01',
    registered_at: registeredAt, enabled: true
  }];
  const [frontendPort, backendPort] = await Promise.all([getAvailablePort(), getAvailablePort()]);
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const backendState = { apiAvailable: true, sources: {} };
  const backendServer = createMockBackend(cameras, backendState);
  await listen(backendServer, backendPort);

  let output = '';
  const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const frontendProcess = spawn(process.execPath, [
    viteEntry, 'dev', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CAMERA_PLAYBACK_URL: 'https://media.example/camera01/',
      INFERENCE_API_URL: backendUrl,
      INFERENCE_API_KEY: apiKey
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  frontendProcess.stdout.on('data', (chunk) => { output += chunk; });
  frontendProcess.stderr.on('data', (chunk) => { output += chunk; });
  await waitForVite(frontendProcess, () => output);

  return {
    baseUrl: frontendUrl,
    cameras,
    backendState,
    async close() {
      if (frontendProcess.exitCode === null) {
        frontendProcess.kill('SIGTERM');
        await new Promise((resolve) => {
          frontendProcess.once('exit', resolve);
          setTimeout(resolve, 2_000).unref();
        });
      }
      await new Promise((resolve) => backendServer.close(resolve));
    }
  };
}
