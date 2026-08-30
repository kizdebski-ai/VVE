import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // `@` is used by component tests (tests/unit/components/*.spec.js).
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Shared PilotAvailability manifest — the single source of truth in the
      // server package, consumed unchanged by the frontend (VVE-100, Module 9).
      '@pilot': fileURLToPath(new URL('../server/src/pilot', import.meta.url)),
    },
    // The shared `@pilot` board modules import yjs from the server package;
    // dedupe so the browser bundle holds exactly one Yjs instance (two would
    // break instanceof checks inside the CRDT).
    dedupe: ['yjs'],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    // Explicit discovery: run exactly this repo's suites (unit behavior tests
    // plus component specs), never unrelated projects on the machine.
    include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
    coverage: {
      enabled: false,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large vendor libraries into separate chunks for better caching
          'vendor-katex': ['katex'],
          'vendor-roughjs': ['roughjs'],
          'vendor-yjs': ['yjs', 'lib0'],
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VVE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: (process.env.VVE_PROXY_TARGET || 'http://localhost:8000').replace(/^http/, 'ws'),
        ws: true,
      },
      '/teacher/login': {
        target: process.env.VVE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
