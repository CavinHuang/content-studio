import { listContents, readContent } from '../content-library';
import { saveDraft } from '../drafts';
import type { PiModule, TypeBoxModule } from './pi-loader';

export type AskUserFn = (question: string, options: string[] | undefined) => Promise<string>;

export interface DomainToolDeps {
  root: string;
  askUser: AskUserFn;
}

const TOOL_NAMES = ['list_contents', 'read_content', 'write_draft', 'ask_user'] as const;
export type DomainToolName = (typeof TOOL_NAMES)[number];
export function domainToolNames(): readonly DomainToolName[] { return TOOL_NAMES; }

// pi 的 AgentToolResult.details 为必填属性（日志/UI 用，模型不可见）——undefined 即可。
function text(t: string) { return { content: [{ type: 'text' as const, text: t }], details: undefined }; }
function textErr(t: string) { return { content: [{ type: 'text' as const, text: t }], details: undefined, isError: true }; }

export async function buildDomainTools(pi: PiModule, T: TypeBoxModule, deps: DomainToolDeps) {
  const listContentsTool = pi.defineTool({
    name: 'list_contents',
    label: '列出内容',
    description: '列出内容库中的所有内容（id、标题、阶段、标签、创建日期）。可用 stage 过滤（idea/draft/review/variants/publishing/published/retro）。',
    parameters: T.Type.Object({ stage: T.Type.Optional(T.Type.String()) }),
    annotations: { readOnlyHint: true },
    async execute(_id, params) {
      try {
        const scan = await listContents(deps.root);
        const items = params.stage ? scan.items.filter((m) => m.stage === params.stage) : scan.items;
        return text(JSON.stringify(
          items.map(({ id, title, stage, tags, created }) => ({ id, title, stage, tags, created })), null, 2));
      } catch (err) { return textErr(`list_contents 失败：${String(err)}`); }
    },
  });
  const readContentTool = pi.defineTool({
    name: 'read_content',
    label: '读取内容',
    description: '按 id 读取一篇内容的元数据与 Markdown 全文。',
    parameters: T.Type.Object({ id: T.Type.String() }),
    annotations: { readOnlyHint: true },
    async execute(_id, params) {
      try {
        const c = await readContent(deps.root, params.id);
        return text(`# ${c.title}（id=${c.id}，stage=${c.stage}，tags=${c.tags.join(',')}）\n\n${c.body}`);
      } catch (err) { return textErr(`read_content 失败：${String(err)}`); }
    },
  });
  const writeDraftTool = pi.defineTool({
    name: 'write_draft',
    label: '写入草稿区',
    description: '把产出的 Markdown 全文写入该内容的草稿区（.studio/drafts/<内容id>/）。这是 AI 产出的唯一落点，不会修改正文；用户确认后才进正文。',
    parameters: T.Type.Object({
      id: T.Type.String(),
      markdown: T.Type.String(),
      note: T.Type.Optional(T.Type.String({ description: '草稿备注，如「长文初稿」「审稿改稿」' })),
    }),
    annotations: { destructiveHint: false },
    async execute(_id, params) {
      try {
        await readContent(deps.root, params.id); // 校验内容存在（防孤儿草稿）
        const d = await saveDraft(deps.root, params.id, { markdown: params.markdown, note: params.note });
        return text(`草稿已保存：${d.name}（等待人工确认采纳，不会自动进正文）`);
      } catch (err) { return textErr(`write_draft 失败：${String(err)}`); }
    },
  });
  const askUserTool = pi.defineTool({
    name: 'ask_user',
    label: '问询用户',
    description: '向用户提一个问题（可给选项列表），等待回答。创作方向、取舍等决策拿不准时必须先问。',
    parameters: T.Type.Object({
      question: T.Type.String(),
      options: T.Type.Optional(T.Type.Array(T.Type.String())),
    }),
    annotations: { readOnlyHint: true },
    execute(_id, params, signal): Promise<ReturnType<typeof text>> {
      return new Promise((resolve) => {
        let settled = false;
        const done = (t: string) => { if (!settled) { settled = true; resolve(text(t)); } };
        const onAbort = () => done('（任务已取消，未获得用户回答）');
        signal?.addEventListener('abort', onAbort, { once: true });
        void deps.askUser(params.question, params.options).then((answer) => {
          signal?.removeEventListener('abort', onAbort);
          done(`用户回答：${answer}`);
        });
      });
    },
  });
  return [listContentsTool, readContentTool, writeDraftTool, askUserTool];
}
