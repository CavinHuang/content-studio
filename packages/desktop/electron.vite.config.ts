import { defineConfig } from 'electron-vite'
import { fileURLToPath } from 'node:url'
import { rendererPlugins } from '../ui/config/renderer'

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
    root: '../ui',
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL('../ui/index.html', import.meta.url)) },
        output: { entryFileNames: 'assets/[name].[hash].js' },
      },
    },
    plugins: rendererPlugins(),
    server: { host: '127.0.0.1' },
  },
})
