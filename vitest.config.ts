import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 与根 tsconfig paths 保持一致：packages/ui 源码内以 @/ 引用自身，
  // 渲染进程测试直接挂载页面组件时需要同一条别名。
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./packages/ui/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'jsdom', include: ['tests/renderer/**/*.test.{ts,tsx}'] } },
    ],
  },
})
