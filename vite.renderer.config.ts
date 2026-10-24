import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // index.html 与入口 main.tsx 都在 src/renderer/：插件默认 root 为项目根，
  // dev server 首页会 404。root 指到 src/renderer 后：
  root: 'src/renderer',
  build: {
    // outDir 相对 root 解析，显式指回插件约定的 .vite/renderer/main_window，
    // 主进程 loadFile('../renderer/main_window/index.html') 依赖该布局；
    // outDir 在 root 之外，vite 默认不清空，显式开启避免残留旧产物。
    outDir: '../../.vite/renderer/main_window',
    emptyOutDir: true,
  },
});
