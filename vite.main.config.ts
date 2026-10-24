import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    // 插件默认 lib fileName 为 '[name].cjs'，而 main/preload 入口基名同为 index，
    // 默认产物会互踩。此处显式命名主进程产物为 .vite/build/main.cjs，
    // package.json 的 "main" 与 src/main 的 preload 路径均按此固化。
    lib: { entry: 'src/main/index.ts', fileName: () => 'main.cjs', formats: ['cjs'] },
    rollupOptions: { external: ['electron'] },
  },
});
