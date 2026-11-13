import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // Component tests import the workspace core from source, mirroring
      // packages/vue/vite.config.ts.
      '@vue-player/core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['packages/vue/**', 'happy-dom']],
  },
})
