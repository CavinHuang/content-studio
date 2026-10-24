import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildDomainTools } from '../../src/main/agent/domain-tools';
import { loadPi, loadTypebox } from '../../src/main/agent/pi-loader';
import { makeLibrary, addContent } from '../helpers/libFixture';
import { draftsDir } from '../../src/main/drafts';

const ID = 'c_20261024_aa00';

async function tools(root: string, askUser = async () => '默认回答') {
  const pi = await loadPi();
  const T = await loadTypebox();
  return buildDomainTools(pi, T, { root, askUser });
}
// pi 的 execute 签名各工具 params 类型不同（逆变不可用 unknown 收窄），测试助手放宽为 any
type ExecResult = { content: { text?: string }[]; isError?: boolean };
const exec = (t: { execute: (a: string, b: any, c?: any, d?: any, e?: any) => Promise<any> }, params: any): Promise<ExecResult> =>
  t.execute('call_1', params, undefined, undefined, {});

describe('领域工具', () => {
  it('list_contents 返回库内内容摘要，可按 stage 过滤', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-a', `id: ${ID}\ntitle: 甲\nstage: draft\ncreated: "2026-10-24"`);
    addContent(root, '2026-10-24-b', 'id: c_20261024_bb11\ntitle: 乙\nstage: idea\ncreated: "2026-10-24"');
    const ts = await tools(root);
    const all = await exec(ts[0]!, {});
    expect(all.content[0]?.text).toContain(ID);
    expect(all.content[0]?.text).toContain('c_20261024_bb11');
    const filtered = await exec(ts[0]!, { stage: 'draft' });
    expect(filtered.content[0]?.text).toContain(ID);
    expect(filtered.content[0]?.text).not.toContain('c_20261024_bb11');
  }, 30_000);
  it('read_content 返回标题与正文；不存在时 isError 结果', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-a', `id: ${ID}\ntitle: 甲\nstage: draft\ncreated: "2026-10-24"`, '正文内容甲');
    const ts = await tools(root);
    const ok = await exec(ts[1]!, { id: ID });
    expect(ok.content[0]?.text).toContain('正文内容甲');
    const bad = await exec(ts[1]!, { id: 'c_20990101_zzzz' });
    expect(bad.isError).toBe(true);
  }, 30_000);
  it('write_draft 只落草稿区并提示待人工确认；内容不存在时 isError', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-a', `id: ${ID}\ntitle: 甲\nstage: draft\ncreated: "2026-10-24"`);
    const ts = await tools(root);
    const r = await exec(ts[2]!, { id: ID, markdown: '# 草稿\n', note: '长文初稿' });
    expect(r.content[0]?.text).toContain('草稿已保存');
    expect(r.content[0]?.text).toContain('人工确认');
    const files = readdirSync(draftsDir(root, ID));
    expect(files.some((f) => f.startsWith('draft-') && f.endsWith('.md'))).toBe(true);
    expect(existsSync(path.join(root, '2026-10-24-a', 'content.md'))).toBe(true); // 正文未被触碰
    const bad = await exec(ts[2]!, { id: 'c_20990101_zzzz', markdown: 'x' });
    expect(bad.isError).toBe(true);
  }, 30_000);
  it('ask_user 转问询回调并把回答带回给模型；abort 信号以取消文案收尾', async () => {
    const root = makeLibrary();
    const ts = await tools(root);
    const r = await exec(ts[3]!, { question: '目标读者？', options: ['技术读者', '普通读者'] });
    expect(r.content[0]?.text).toContain('用户回答：默认回答');
    // abort 路径
    const ac = new AbortController();
    const p = ts[3]!.execute('call_2', { question: '取消我' }, ac.signal, undefined, {} as never);
    ac.abort();
    const r2 = (await p) as ExecResult;
    expect(r2.content[0]?.text).toContain('取消');
  }, 30_000);
});
