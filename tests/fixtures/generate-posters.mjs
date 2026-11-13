// Generates the local sample poster images used by the acceptance tests.
// Run with: node tests/fixtures/generate-posters.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Tiny valid 1x1 PNGs (base64-encoded) standing in for real video posters.
const posters = {
  'poster-a.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'poster-b.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwAEgwH/y7rRcQAAAABJRU5ErkJggg=='
};

for (const [fileName, base64] of Object.entries(posters)) {
  writeFileSync(join(here, fileName), Buffer.from(base64, 'base64'));
  console.log(`wrote ${fileName}`);
}
