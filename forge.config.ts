import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    // vite 插件默认 ignore 只放行 .vite——会把 external 的 pi/typebox 依赖树排除在 asar 外
    //（产物在仓库内时靠向上解析仓库 node_modules 而假阳性通过冒烟，分发即断链）。
    // 自设函数形式 ignore 插件不覆写；node_modules 内部由 packager 的 prune（forge 默认开，
    // galactus 生产依赖闭包）裁剪，不受 ignore 影响。
    ignore: (file: string) => {
      if (!file) return false; // 空串=src 根（fs.cp 对根调 filter），放行否则整个复制被取消
      return file !== '/package.json' &&
        !file.startsWith('/.vite') &&
        !file.startsWith('/node_modules');
    },
    asar: {
      // pi 运行时 require.resolve("typebox") 与读包内相对文件；打包后将 pi/typebox 解到
      // app.asar.unpacked（探针遗留风险：asar 内 ESM 加载未验证——用解包+冒烟双重保险）
      unpack: '**/node_modules/{typebox,@earendil-works}/**',
    },
    extraResource: ['skills'], // 技能随应用分发（real-session 的 skillsDir 在打包态读 resourcesPath/skills）
  },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin', 'linux'], config: {} }],
  plugins: [new VitePlugin({
    build: [
      { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
      { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
  })],
};
export default config;
