import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'path';

/**
 * The version shown in the app is this package's own, which the release process keeps equal to the
 * root one (`scripts/check-versions.mjs` fails the build when they differ).
 */
function packageVersion(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'),
  );
  if (
    typeof pkg === 'object' &&
    pkg !== null &&
    'version' in pkg &&
    typeof pkg.version === 'string'
  ) {
    return pkg.version;
  }
  throw new Error('frontend/package.json has no version');
}

const EXCALIDRAW_FONT_CDN = /https:\/\/esm\.sh\/\$\{[\s\S]*?\}\/dist\/prod\//;

/**
 * Excalidraw appends a public CDN to every font's source list as a fallback, and browsers check
 * every source against the content security policy even when the first one loads. Point the
 * fallback at our own copy of the fonts instead. The build fails if Excalidraw changes that line,
 * so an upgrade cannot quietly bring the CDN back.
 */
function selfHostedExcalidrawFonts(): Plugin {
  return {
    name: 'self-hosted-excalidraw-fonts',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('@excalidraw/excalidraw') || !code.includes('ASSETS_FALLBACK_URL'))
        return null;
      if (!EXCALIDRAW_FONT_CDN.test(code)) {
        this.error(
          'Excalidraw no longer builds its font fallback URL as expected; update this plugin.',
        );
      }
      return code.replace(EXCALIDRAW_FONT_CDN, '${window.location.origin}/excalidraw-assets/');
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  define: { BUILD_VERSION: JSON.stringify(packageVersion()) },
  plugins: [
    react(),
    selfHostedExcalidrawFonts(),
    // Excalidraw loads its fonts from a public CDN unless told where they are (see
    // public/excalidraw-config.js).
    // Serving them ourselves keeps every font request on our own origin, which the CSP requires.
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@excalidraw/excalidraw/dist/prod/fonts/**/*',
          dest: 'excalidraw-assets/fonts',
          rename: { stripBase: 6 },
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      'roughjs/bin/rough': path.resolve(import.meta.dirname, './node_modules/roughjs/bin/rough.js'),
    },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    include: [
      '@excalidraw/excalidraw',
      '@excalidraw/mermaid-to-excalidraw',
      'lucide-react',
      'clsx',
      'tailwind-merge',
      '@tanstack/react-query',
      'better-auth/react',
      'better-auth/client/plugins',
      'react-router-dom',
      'sonner',
      'marked',
    ],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/],
      },
    },
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/setupTests.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/docs/types.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 62,
        branches: 59,
        functions: 57,
        lines: 64,
      },
    },
  },
});
