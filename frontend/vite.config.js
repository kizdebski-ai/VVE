import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.{js,ts}'],
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
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/teacher/login': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
