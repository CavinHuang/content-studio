import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PublishService, type PublishRuntime } from '../../src/main/publish/publish-service';
import type { PlatformAdapter, PageDriver, InjectResult } from '../../src/main/publish/adapter';
import { makeLibrary, addContent } from '../helpers/libFixture';
import type { PublishEventOut, PublishTask } from '../../src/shared/types';

const XHS_ID = 'c_20261024_aa01';

function fakeAdapter(over: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    key: 'xiaohongshu',
    rules: { key: 'xiaohongshu', label: '小红书', mode: 'dom', notes: [], validate: () => ({ ok: true, errors: [], warnings: [] }) },
    usesSession: true,
    loginCheck: vi.fn(async () => ({ loggedIn: true })),
    injectDraft: vi.fn(async () => ({ ok: true, draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: [] })),
    readBackStatus: vi.fn(async () => ({ ok: true, title: 't', bodyChars: 10, url: 'https://u' })),
    ...over,
  } as PlatformAdapter;
}
const driver: PageDriver = { evaluate: async () => ({ ok: true }) as never, currentUrl: () => 'https://u' };

function harness(adapter: PlatformAdapter, opts: { minIntervalMs?: number; now?: () => number } = {}) {
  const events: PublishEventOut[] = [];
  const open = vi.fn(async () => driver);
  const show = vi.fn(async () => {});
  const runtime: PublishRuntime = { adapter: (p) => (p === adapter.key ? adapter : undefined), open, show };
  const root = makeLibrary();
  addContent(root, '2026-10-24-a', `id: ${XHS_ID}\ntitle: 甲\nstage: variants\ncreated: "2026-10-24"`);
  // libFixture.addContent 只写 content.md；变体文件直接落盘（与 variants.saveVariant 同构）
  mkdirSync(path.join(root, '2026-10-24-a', 'platforms'), { recursive: true });
  writeFileSync(path.join(root, '2026-10-24-a', 'platforms', 'xiaohongshu.md'),
    `---\nplatform: xiaohongshu\ntitle: 变体标题\ntopics: []\nupdated: "2026-10-24"\n---\n${'字'.repeat(650)}`, 'utf8');
  const svc = new PublishService({ root: () => root, runtime, emit: (e) => events.push(e), minIntervalMs: opts.minIntervalMs ?? 0, ...(opts.now ? { now: opts.now } : {}) });
  const last = (): PublishTask => events[events.length - 1]!.task;
  return { svc, events, last, open, show, adapter, root };
}

describe('PublishService（spec §6：串行限速/三分类/防覆盖映射）', () => {
  it('全链相位 queued→validating→login_check→injecting→reading_back→prepared，变体路径与回读落任务', async () => {
    const h = harness(fakeAdapter());
    const r = h.svc.createTask(XHS_ID, 'xiaohongshu');
    expect(r.ok).toBe(true);
    await h.svc.run((r as { task: PublishTask }).task.taskId);
    const phases = h.events.map((e) => e.task.phase);
    expect(phases[phases.length - 1]).toBe('prepared');
    for (const p of ['queued', 'validating', 'login_check', 'injecting', 'reading_back', 'prepared']) expect(phases).toContain(p);
    const t = h.last();
    expect(t.draftUrl).toContain('xiaohongshu.com');
    expect(t.readBack).toMatchObject({ title: 't', bodyChars: 10 });
    expect(t.variantPath).toContain('platforms/xiaohongshu.md');
  });
  it('变体不存在/未过校验 → failed(validation)，绝不进入注入', async () => {
    const h = harness(fakeAdapter());
    const r = await h.svc.createTask('c_20261024_bb02', 'xiaohongshu'); // 内容不存在
    expect(r.ok).toBe(true);
    await h.svc.run((r as { task: PublishTask }).task.taskId);
    expect(h.last()).toMatchObject({ phase: 'failed', category: 'validation' });
    expect(h.adapter.injectDraft).not.toHaveBeenCalled();
  });
  it('未登录 → failed(not_logged_in)；页面结构变更 → failed(page_changed)；防覆盖 → failed(already_has_content)', async () => {
    const noLogin = harness(fakeAdapter({ loginCheck: vi.fn(async () => ({ loggedIn: false, message: '请先登录' })) }));
    const t1 = (await noLogin.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await noLogin.svc.run(t1.taskId);
    expect(noLogin.last()).toMatchObject({ phase: 'failed', category: 'not_logged_in', message: '请先登录' });

    const changed = harness(fakeAdapter({ injectDraft: vi.fn(async (): Promise<InjectResult> => ({ ok: false, code: 'PAGE_CHANGED', message: 'm' })) }));
    const t2 = (await changed.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await changed.svc.run(t2.taskId);
    expect(changed.last()).toMatchObject({ phase: 'failed', category: 'page_changed' });

    const guard = harness(fakeAdapter({ injectDraft: vi.fn(async (): Promise<InjectResult> => ({ ok: false, code: 'ALREADY_HAS_CONTENT', message: '已有内容' })) }));
    const t3 = (await guard.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await guard.svc.run(t3.taskId);
    expect(guard.last()).toMatchObject({ phase: 'failed', category: 'already_has_content' });
  });
  it('平台间串行：第二个任务等第一个完成才执行；最小间隔生效', async () => {
    let release!: () => void;
    const slow = fakeAdapter({ injectDraft: vi.fn(() => new Promise<InjectResult>((res) => { release = () => res({ ok: true, warnings: [] }); })) });
    let clock = 1_000_000; // 可控时钟：最小间隔判定（lastRunAt + minIntervalMs - now）不依赖真实墙钟
    const h = harness(slow, { minIntervalMs: 50, now: () => clock });
    const t1 = (await h.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    const t2 = (await h.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    const calls = () => (slow.injectDraft as ReturnType<typeof vi.fn>).mock.calls.length;
    const p1 = h.svc.run(t1.taskId);
    const p2 = h.svc.run(t2.taskId);
    // 到达注入前有真实 fs I/O（listContents/readVariant），时长不定——用 waitFor 而非固定 20ms 定时假设（门禁在并行负载下抖动的根因）
    await vi.waitFor(() => expect(calls()).toBe(1));
    expect(calls()).toBe(1); // 串行：第一个注入挂起期间第二个绝不开跑
    release();
    await p1;
    expect(calls()).toBe(1); // 第一个已完成而第二个尚未注入：最小间隔仍在 gating（时钟未走满 50ms）
    await vi.waitFor(() => expect(calls()).toBe(2)); // 间隔过后第二个才注入
    release(); // 闭包 release 只指向最新一次注入的 resolver：第二个任务挂起时需再释放一次
    await p2;
    expect(calls()).toBe(2);
  });
  it('retry 重跑失败任务；checkLogin 不建任务；showView 透传', async () => {
    const h = harness(fakeAdapter({ injectDraft: vi.fn(async (): Promise<InjectResult> => ({ ok: false, code: 'NETWORK', message: '断网' })) }));
    const t = (await h.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await h.svc.run(t.taskId);
    expect(h.last().category).toBe('network');
    (h.adapter.injectDraft as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, draftUrl: 'u', warnings: [] }));
    h.svc.retry(t.taskId);
    await new Promise((r) => setTimeout(r, 10));
    await vi.waitFor(() => expect(h.last().phase).toBe('prepared'));
    expect(await h.svc.checkLogin('xiaohongshu')).toEqual({ loggedIn: true });
    await h.svc.showView('xiaohongshu', true);
    expect(h.show).toHaveBeenCalledWith('xiaohongshu', true);
  });
  it('api 平台（usesSession=false）不调 runtime.open：checkLogin/execute 传空驱动，全链到 prepared 且无回读', async () => {
    const api = fakeAdapter({
      key: 'wechat-article',
      rules: { key: 'wechat-article', label: '公众号文章', mode: 'api', notes: [], validate: () => ({ ok: true, errors: [], warnings: [] }) },
      usesSession: false,
      injectDraft: vi.fn(async (): Promise<InjectResult> => ({ ok: true, mediaId: 'e2e-draft-1', warnings: [] })),
    });
    const h = harness(api);
    // wechat-article 变体需过其平台规则（封面必填；fake 适配器不读文件，只校验 doc）
    writeFileSync(path.join(h.root, '2026-10-24-a', 'platforms', 'wechat-article.md'),
      '---\nplatform: wechat-article\ntitle: 变体标题\ntopics: []\ncover: assets/cover.png\nupdated: "2026-10-24"\n---\n公众号正文', 'utf8');
    expect(await h.svc.checkLogin('wechat-article')).toEqual({ loggedIn: true });
    expect(h.open).not.toHaveBeenCalled();
    const r = h.svc.createTask(XHS_ID, 'wechat-article');
    expect(r.ok).toBe(true);
    await h.svc.run((r as { task: PublishTask }).task.taskId);
    expect(h.last()).toMatchObject({ phase: 'prepared', mediaId: 'e2e-draft-1' });
    expect(h.open).not.toHaveBeenCalled(); // ElectronPublishRuntime 对无编辑器平台 open 即 throw——服务必须按 usesSession 分流（e2e 前的回归闸）
    expect(h.adapter.readBackStatus).not.toHaveBeenCalled(); // api 模式无页面回读
  });
});
