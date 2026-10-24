import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    // 插件默认 lib fileName 为 '[name].cjs'，而 main/preload 入口基名同为 index，
    // 默认产物会互踩。此处显式命名主进程产物为 .vite/build/main.cjs。
    lib: { entry: 'src/main/index.ts', fileName: () => 'main.cjs', formats: ['cjs'] },
    rollupOptions: {
      // pi 运行时会 require.resolve("typebox")（dist/core/extensions/loader.js）与读包内
      // 相对文件（DefaultResourceLoader 的 docs/skills）——一旦打进 bundle 运行时断链（探针实证）。
      // external 的动态 import 在 cjs 产物中保持原生 import()（rollup dynamicImportInCjs 默认），
      // pi 是纯 ESM，Node≥22.12 的 require(esm) 兜底亦可用。
      external: ['electron', '@earendil-works/pi-coding-agent', 'typebox'],
    },
  },
});
