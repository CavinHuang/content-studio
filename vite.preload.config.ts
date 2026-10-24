import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    // 插件默认 preload 与 main 同输出 .vite/build/（vite.base.config.js outDir），
    // 与主进程产物区分：独立 outDir + 显式入口产物名 → .vite/preload/index.cjs。
    outDir: '.vite/preload',
    rollupOptions: { external: ['electron'], output: { entryFileNames: 'index.cjs' } },
  },
});
