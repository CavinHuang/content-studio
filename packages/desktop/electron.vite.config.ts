import { defineConfig } from 'electron-vite'
import { fileURLToPath } from 'node:url'
import { rendererPlugins } from '../ui/config/renderer'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // pi 运行时会 require.resolve("typebox") 并读包内相对文件（DefaultResourceLoader 的
        // docs/skills）——打进 bundle 即断链（M2 探针实证）。external 的动态 import 在 cjs
        // 产物中保持原生 import()，pi 是纯 ESM，Node≥22.12 的 require(esm) 兜底亦可用。
        external: ['@earendil-works/pi-coding-agent', 'typebox'],
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
