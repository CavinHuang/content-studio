import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'jsdom', include: ['tests/renderer/**/*.test.tsx'] } },
    ],
  },
});
