import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { listContents } from '../content-library';
import type { SessionLike, CreateSessionFn } from './agent-service';
import { buildDomainTools, domainToolNames, type AskUserFn } from './domain-tools';
import { loadPi, loadTypebox } from './pi-loader';
import { getModelConfig, piAgentDir, writePiModelsJson } from './model-config';

export interface RealSessionFactoryDeps {
  root: () => string | null;
  skillsDir: () => string;
}

function coded(message: string, code: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/**
 * 真实 pi 会话：每内容一个绑定会话（cwd=内容文件夹），JSONL 持久化于
 * .studio/pi-sessions/<内容id>/（continueRecent 续聊）。noTools:'all' 关闭 pi
 * 内置 read/bash/edit/write——agent 只有领域工具（探针实测零泄漏，铁律机械化）。
 */
export function createRealSessionFactory(deps: RealSessionFactoryDeps): CreateSessionFn {
  return async (contentId: string, askUser: AskUserFn): Promise<SessionLike> => {
    const root = deps.root();
    if (!root) throw coded('尚未选择内容库', 'NO_LIBRARY');
    const cfg = getModelConfig();
    if (!cfg) throw coded('尚未配置模型', 'NO_MODEL_CONFIG');
    const scan = await listContents(root);
    const meta = scan.items.find((m) => m.id === contentId && m.id !== '');
    if (!meta) throw coded(`内容不存在: ${contentId}`, 'CONTENT_NOT_FOUND');

    const contentDir = path.join(root, meta.folder);
    const sessionDir = path.join(root, '.studio', 'pi-sessions', contentId);
    await mkdir(sessionDir, { recursive: true });

    const pi = await loadPi();
    const T = await loadTypebox();
    const agentDir = piAgentDir();
    await mkdir(agentDir, { recursive: true });
    await writePiModelsJson(cfg);
    // 探针实证：ModelRuntime.create 不读 <agentDir>/models.json，必须显式传路径
    const modelRuntime = await pi.ModelRuntime.create({
      modelsPath: path.join(agentDir, 'models.json'),
      authPath: path.join(agentDir, 'auth.json'),
    });
    const model = modelRuntime.getModel(cfg.providerId, cfg.modelId);
    if (!model) throw coded(`模型不可用: ${cfg.providerId}/${cfg.modelId}`, 'MODEL_NOT_FOUND');

    const skills = pi.loadSkillsFromDir({ dir: deps.skillsDir(), source: 'contentdeck' });
    const loader = new pi.DefaultResourceLoader({
      cwd: contentDir,          // 上下文绑定该内容文件夹（spec §5）
      agentDir,                 // 独立 agentDir：不与用户 pi CLI 的 ~/.pi/agent 混用
      skillsOverride: () => skills, // 技能只来自随应用分发的目录
    });
    await loader.reload();

    const customTools = await buildDomainTools(pi, T, { root, askUser });
    const { session } = await pi.createAgentSession({
      cwd: contentDir,
      agentDir,
      model,
      modelRuntime,
      resourceLoader: loader,
      noTools: 'all',                          // 关闭全部内置工具
      customTools,
      tools: [...domainToolNames()],           // 只启用领域工具
      sessionManager: pi.SessionManager.continueRecent(contentDir, sessionDir),
    });
    return {
      subscribe: (l) => session.subscribe(l as never),
      prompt: (text) => session.prompt(text),
      abort: () => session.abort(),
      waitForIdle: () => session.waitForIdle(),
      dispose: () => session.dispose(),
    };
  };
}
