import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  define: {
    'process.env': {},
  },
  optimizeDeps: {
    include: ['bpmn-js'],
  },
  server: {
    port: 5174,
    proxy: {
      '/dxa': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
      '/workspace': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
