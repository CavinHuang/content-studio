/**
 * 【历史资产参考件——P4 发布编排】
 * 来源提交：edf225b（feat(m3): PublishService 发布编排（串行限速/三分类/回读）与 create_publish_task 领域工具）
 * 原路径：src/main/publish/publish-service.ts
 * 提取方式：git show edf225b:src/main/publish/publish-service.ts（2026-10-27 提取，内容未改动）
 * 说明：属重置前旧历史的实现，仅供移植参考，不参与当前构建。重试三分类与限速参数见 ref/memo-xiaohongshu-and-publish.md。
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { listContents } from '../content-library';
import { readVariant } from '../variants';
import { validateVariant } from '../../shared/platform-rules';
import { classifyFailure, type PageDriver, type PlatformAdapter } from './adapter';
import type { PlatformKey, PublishEventOut, PublishTask } from '../../shared/types';

export type PublishRuntime = {
  adapter(platform: PlatformKey): PlatformAdapter | undefined;
  open(platform: PlatformKey): Promise<PageDriver>;
  show(platform: PlatformKey, visible: boolean): Promise<void>;
};
export type CreateTaskResult = { ok: true; task: PublishTask } | { ok: false; code: string; message: string };

function msg(err: unknown): string { return err instanceof Error ? err.message : String(err); }

/** api 平台（usesSession=false）无页面：空驱动占位——API 适配器约定不使用 driver，误用即显式报错。 */
const noPageDriver: PageDriver = {
  evaluate: async () => { throw new Error('API 平台无页面会话，driver 不可用'); },
  currentUrl: () => '',
};

/** 发布编排（spec §6）：选内容+平台→变体确认（本地校验先行）→登录探测→注入（全局串行+限速）→停在草稿态→回读。 */
export class PublishService {
  private readonly tasks = new Map<string, PublishTask>();
  private chain: Promise<void> = Promise.resolve();
  private lastRunAt = 0;
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: {
    root(): string | null; runtime: PublishRuntime; emit(ev: PublishEventOut): void;
    minIntervalMs?: number; now?: () => number;
  }) {
    this.minIntervalMs = deps.minIntervalMs ?? Number(process.env.CONTENTDECK_PUBLISH_MIN_INTERVAL_MS ?? 15_000);
    this.now = deps.now ?? Date.now;
  }

  /** spec §5：只建任务，不触发注入（注入由人在发布中心发起）。 */
  createTask(contentId: string, platform: PlatformKey): CreateTaskResult {
    if (!this.deps.runtime.adapter(platform)) return { ok: false, code: 'PUBLISH_PLATFORM_UNSUPPORTED', message: `平台 ${platform} 的发布适配器暂未提供` };
    if (!this.deps.root()) return { ok: false, code: 'NO_LIBRARY', message: '尚未选择内容库' };
    const task: PublishTask = {
      taskId: `t_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`,
      contentId, platform, phase: 'queued', updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.taskId, task);
    this.emit(task);
    return { ok: true, task };
  }

  list(): PublishTask[] { return [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  task(taskId: string): PublishTask | undefined { return this.tasks.get(taskId); }

  async checkLogin(platform: PlatformKey): Promise<{ loggedIn: boolean; message?: string }> {
    const adapter = this.deps.runtime.adapter(platform);
    if (!adapter) return { loggedIn: false, message: '平台暂不支持' };
    try { return await adapter.loginCheck(await this.openDriver(adapter, platform)); }
    catch (err) { return { loggedIn: false, message: msg(err) }; }
  }

  /** dom 平台（usesSession=true）才开页面会话；api 平台（公众号文章等）无内嵌编辑器，跳过 runtime.open 传空驱动。 */
  private async openDriver(adapter: PlatformAdapter, platform: PlatformKey): Promise<PageDriver> {
    return adapter.usesSession ? await this.deps.runtime.open(platform) : noPageDriver;
  }

  async showView(platform: PlatformKey, visible: boolean): Promise<void> { await this.deps.runtime.show(platform, visible); }

  /** 全局串行互斥链 + 相邻执行最小间隔（spec §6 平台间限速串行注入）。 */
  run(taskId: string): Promise<void> {
    const next = this.chain.then(async () => {
      const wait = this.lastRunAt + this.minIntervalMs - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRunAt = this.now();
      await this.execute(taskId);
    });
    this.chain = next.catch(() => {}); // 链不断：单任务失败不影响其他平台/任务
    return next;
  }

  retry(taskId: string): void {
    const t = this.tasks.get(taskId);
    if (!t || t.phase !== 'failed') return;
    t.phase = 'queued'; t.category = undefined; t.message = undefined;
    this.emit(t);
    void this.run(taskId);
  }

  private emit(t: PublishTask): void {
    t.updatedAt = new Date().toISOString();
    this.deps.emit({ kind: 'task_update', task: { ...t } });
  }

  private async execute(taskId: string): Promise<void> {
    const t = this.tasks.get(taskId);
    if (!t) return;
    const adapter = this.deps.runtime.adapter(t.platform);
    const root = this.deps.root();
    if (!adapter || !root) return this.fail(t, 'validation', !root ? '尚未选择内容库' : '平台适配器不可用');
    try {
      t.phase = 'validating'; this.emit(t);
      const scan = await listContents(root);
      const meta = scan.items.find((m) => m.id === t.contentId);
      if (!meta) return this.fail(t, 'validation', `内容不存在: ${t.contentId}`);
      const doc = await readVariant(root, t.contentId, t.platform);
      if (!doc) return this.fail(t, 'validation', `变体不存在：请先在变体工作台生成并保存 ${adapter.rules.label} 变体`);
      const v = validateVariant(t.platform, doc);
      if (!v.ok) return this.fail(t, 'validation', `变体未通过本地规则校验：${v.errors.join('；')}`);
      t.variantPath = `${meta.folder}/platforms/${t.platform}.md`;

      t.phase = 'login_check'; this.emit(t);
      const driver = await this.openDriver(adapter, t.platform);
      const login = await adapter.loginCheck(driver);
      if (!login.loggedIn) return this.fail(t, 'not_logged_in', login.message ?? '请先登录平台');

      t.phase = 'injecting'; this.emit(t);
      const r = await adapter.injectDraft(driver, { doc, variantPath: t.variantPath, contentFolder: path.join(root, meta.folder) });
      if (!r.ok) return this.fail(t, classifyFailure(r.code), `${r.message}`);
      t.draftUrl = r.draftUrl; t.mediaId = r.mediaId; t.message = r.warnings.length ? r.warnings.join('；') : undefined;

      if (adapter.usesSession) {
        t.phase = 'reading_back'; this.emit(t);
        const rb = await adapter.readBackStatus(driver);
        if (rb.ok) t.readBack = { title: rb.title, bodyChars: rb.bodyChars, url: rb.url ?? driver.currentUrl() };
        else t.message = `草稿已注入但回读失败：${rb.message}`;
      }
      t.phase = 'prepared'; this.emit(t); // 停在草稿态（spec §6：人工在平台点发布）
    } catch (err) {
      const code = (err as { code?: string })?.code;
      this.fail(t, code ? classifyFailure(code) : 'unknown', msg(err));
    }
  }

  private fail(t: PublishTask, category: PublishTask['category'], message: string): void {
    t.category = category; t.message = message; t.phase = 'failed'; this.emit(t);
  }
}
