/**
 * pi 与 typebox 的唯一运行时入口。
 * - pi 仅 ESM（type:module）且需保持包结构完整：只能动态 import + vite external，严禁静态引入。
 * - 严禁 import pi 的 TUI/modes 路径（InteractiveMode 等）：会触发 pi-tui 原生 prebuild，
 *   .node 无法从 asar 内加载（探针 dlopen 追踪结论；根入口不加载原生模块）。
 * - typebox 是 pi 的直接依赖（同名包），领域工具的参数 schema 复用同一实现。
 */
export type PiModule = typeof import('@earendil-works/pi-coding-agent');
export type TypeBoxModule = typeof import('typebox');

let piPromise: Promise<PiModule> | null = null;
let typeboxPromise: Promise<TypeBoxModule> | null = null;

export function loadPi(): Promise<PiModule> {
  piPromise ??= import('@earendil-works/pi-coding-agent');
  return piPromise;
}

export function loadTypebox(): Promise<TypeBoxModule> {
  typeboxPromise ??= import('typebox');
  return typeboxPromise;
}
