import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(process.cwd(), '../scripts/demo-wipe.mjs');

interface ExecError {
  code?: number;
  stdout?: string;
  stderr?: string;
}

function isExecError(err: unknown): err is ExecError {
  return typeof err === 'object' && err !== null;
}

describe('scripts/demo-wipe.mjs', () => {
  it('refuses to run when DEMO_MODE is unset', async () => {
    try {
      await execFileAsync('node', [scriptPath], {
        env: { ...process.env, DEMO_MODE: '' },
      });
      expect.unreachable('Should have failed when DEMO_MODE is unset');
    } catch (err: unknown) {
      if (!isExecError(err)) throw err;
      expect(err.code).toBe(1);
      expect(err.stderr || err.stdout).toContain('Refused: DEMO_MODE is not "true"');
    }
  });

  it('refuses to run when DEMO_MODE is "false"', async () => {
    try {
      await execFileAsync('node', [scriptPath], {
        env: { ...process.env, DEMO_MODE: 'false' },
      });
      expect.unreachable('Should have failed when DEMO_MODE is false');
    } catch (err: unknown) {
      if (!isExecError(err)) throw err;
      expect(err.code).toBe(1);
      expect(err.stderr || err.stdout).toContain('Refused: DEMO_MODE is not "true"');
    }
  });

  it('refuses to run without DATABASE_URL even if DEMO_MODE is "true"', async () => {
    try {
      await execFileAsync('node', [scriptPath], {
        env: { ...process.env, DEMO_MODE: 'true', DATABASE_URL: '' },
      });
      expect.unreachable('Should have failed without DATABASE_URL');
    } catch (err: unknown) {
      if (!isExecError(err)) throw err;
      expect(err.code).toBe(1);
      expect(err.stderr || err.stdout).toContain('DATABASE_URL is required');
    }
  });
});
