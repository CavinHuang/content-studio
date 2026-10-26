import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import type { PluginOption } from 'vite'

export function rendererPlugins(): PluginOption[] {
  return [
    react(),
    tailwindcss(),
    {
      name: 'renderer-alias',
      config: () => ({
        resolve: { alias: { '@': fileURLToPath(new URL('../src/renderer/src', import.meta.url)) } },
      }),
    },
    {
      name: 'development-react-csp',
      apply: 'serve',
      // React Fast Refresh injects an inline preamble only in development.
      transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
  ]
}
