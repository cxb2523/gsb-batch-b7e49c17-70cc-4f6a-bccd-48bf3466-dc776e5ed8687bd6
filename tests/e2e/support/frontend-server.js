import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForVite(childProcess, output, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childProcess.exitCode !== null) throw new Error(`SvelteKit terminó antes de iniciar.\n${output()}`);
    if (output().includes('127.0.0.1')) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`SvelteKit no inició dentro del tiempo esperado.\n${output()}`);
}

export async function startRealFrontend() {
  const projectRoot = process.cwd();
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  let output = '';
  const childProcess = spawn(globalThis.process.execPath, [
    viteEntry, 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'
  ], { cwd: projectRoot, env: globalThis.process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  childProcess.stdout.on('data', (chunk) => { output += chunk; });
  childProcess.stderr.on('data', (chunk) => { output += chunk; });
  await waitForVite(childProcess, () => output);
  return {
    baseUrl,
    async close() {
      if (childProcess.exitCode !== null) return;
      childProcess.kill('SIGTERM');
      await new Promise((resolve) => {
        childProcess.once('exit', resolve);
        setTimeout(resolve, 2_000).unref();
      });
    }
  };
}
