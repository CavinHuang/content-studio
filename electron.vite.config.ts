import { defineConfig } from 'electron-vite'
import { rendererPlugins } from './config/renderer.ts'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    plugins: rendererPlugins(),
    server: { host: '127.0.0.1' },
  },
})
