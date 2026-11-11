import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import serve from 'rollup-plugin-serve';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

// src/version.ts holds a placeholder so the module type-checks; the real value comes from
// package.json at build time, which is the only file semantic-release rewrites.
const injectVersion = {
  name: 'inject-version',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('src/version.ts')) return null;
    return { code: `export const VERSION = '${version}';`, map: null };
  },
};

const dev = process.env.ROLLUP_WATCH;

export default {
  input: 'src/chartdeck-card.ts',
  output: {
    dir: 'dist',
    format: 'es',
    entryFileNames: 'chartdeck-card.js',
    // Every language but English is a chunk of its own, loaded by the main file with a relative
    // import, so it sits beside it under a name HACS downloads along with the main file: every
    // .js in dist/ travels. The hash changes with the content, so a browser that kept an old
    // main file never loads a translation it was not built with.
    chunkFileNames: 'chartdeck-card.[name]-[hash].js',
    // Always, so a stack trace from somebody's console points at a TypeScript line. The map sits
    // beside each file in dist/ and on the release; a browser that cannot fetch one simply shows
    // the minified line.
    sourcemap: true,
  },
  plugins: [
    injectVersion,
    nodeResolve(),
    typescript({ tsconfig: './tsconfig.json', noEmit: false, declaration: false, sourceMap: true }),
    json({ preferConst: true }),
    dev &&
      serve({
        contentBase: ['./dist'],
        host: '0.0.0.0',
        port: 5000,
        allowCrossOrigin: true,
        headers: { 'Access-Control-Allow-Origin': '*' },
      }),
    !dev && terser({ mangle: { safari10: true } }),
  ],
  watch: { exclude: 'node_modules/**' },
};
