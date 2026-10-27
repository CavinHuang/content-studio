import { defineConfig } from 'vite'
import { rendererPlugins } from './config/renderer.ts'

export default defineConfig({
  root: '.',
  base: './',
  plugins: rendererPlugins(),
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
