/**
 * Test-only ESM resolve hook.
 *
 * The app source uses extensionless relative imports (bundler-style, resolved by Vite/tsc),
 * which Node's native ESM loader rejects. This hook lets `node --test` run the offline tests
 * against the unmodified source by trying `.ts` / `.tsx` when a relative specifier does not
 * resolve as written. It is not part of the shipped app.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx', '.js'];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    for (const ext of EXTENSIONS) {
      const candidate = new URL(`${specifier}${ext}`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
