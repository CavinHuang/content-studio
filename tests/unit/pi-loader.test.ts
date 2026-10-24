import { describe, it, expect } from 'vitest';
import { loadPi, loadTypebox } from '../../src/main/agent/pi-loader';

describe('pi 进程内动态加载', () => {
  it('加载 pi 与 typebox 且本计划依赖的 API 面完整', async () => {
    const pi = await loadPi();
    expect(typeof pi.createAgentSession).toBe('function');
    expect(typeof pi.ModelRuntime?.create).toBe('function');
    expect(typeof pi.SessionManager?.create).toBe('function');
    expect(typeof pi.SessionManager?.continueRecent).toBe('function');
    expect(typeof pi.defineTool).toBe('function');
    expect(typeof pi.loadSkillsFromDir).toBe('function');
    expect(typeof pi.DefaultResourceLoader).toBe('function');
    expect(pi.VERSION).toBe('1.4.0');
    const T = await loadTypebox();
    expect(typeof T.Type.Object).toBe('function');
    expect(typeof T.Type.String).toBe('function');
  }, 30_000);
});
