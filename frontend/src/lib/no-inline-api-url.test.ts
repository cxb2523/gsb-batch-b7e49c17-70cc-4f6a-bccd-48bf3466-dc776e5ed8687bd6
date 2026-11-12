import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function getAllSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('architecture enforcement (D1, Q-F1, Q-F9)', () => {
  const srcDir = path.resolve(__dirname, '..');
  const allFiles = getAllSourceFiles(srcDir);

  it('no file other than lib/api-url.ts mentions VITE_API_URL or localhost:3000', () => {
    const offenders: Array<{ file: string; match: string }> = [];

    for (const filePath of allFiles) {
      const relPath = path.relative(srcDir, filePath);
      if (relPath.includes('.test.') || relPath === 'lib/api-url.ts') {
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('VITE_API_URL')) {
        offenders.push({ file: relPath, match: 'VITE_API_URL' });
      }
      if (content.includes('localhost:3000')) {
        offenders.push({ file: relPath, match: 'localhost:3000' });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no fetch( call sites exist outside lib/http.ts and test files', () => {
    const offenders: string[] = [];

    for (const filePath of allFiles) {
      const relPath = path.relative(srcDir, filePath);
      if (relPath.includes('.test.') || relPath === 'lib/http.ts') {
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      if (/\bfetch\s*\(/.test(content)) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no useQuery or useMutation calls outside features/*/queries.ts and test files', () => {
    const offenders: Array<{ file: string; match: string }> = [];

    for (const filePath of allFiles) {
      const relPath = path.relative(srcDir, filePath);
      if (relPath.includes('.test.') || relPath.match(/^features\/[^/]+\/queries\.ts$/)) {
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      if (/\buseQuery\s*[<(]/.test(content)) {
        offenders.push({ file: relPath, match: 'useQuery' });
      }
      if (/\buseMutation\s*[<(]/.test(content)) {
        offenders.push({ file: relPath, match: 'useMutation' });
      }
    }

    expect(offenders).toEqual([]);
  });
});
