import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const localPython = path.join(
  packageRoot,
  '.venv',
  process.platform === 'win32' ? 'Scripts' : 'bin',
  process.platform === 'win32' ? 'python.exe' : 'python',
);
const executable = fs.existsSync(localPython)
  ? localPython
  : process.env.DASH_PYTHON || 'python';
// Avoid `shell: true` on Windows: it concatenates arguments without
// quoting, so values containing spaces (e.g. `-m "not browser"`) split.
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: packageRoot,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
