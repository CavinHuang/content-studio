import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../lib/core.mjs";
import { dispatchApi } from "../lib/api.mjs";
import { markdownChanges, compareMarkdown } from "../src/markdown-sync.mjs";
const setup = (t) => {
  const c = createCore(":memory:");
  t.after(() => c.close());
  return c;
};
const initial =
  "# 创作实践\n\n最初的开头。\n\n保持不变的桥段。\n\n最初的结尾。\n";
function drafts(c) {
  let d = c.writing.create({ title: "平台稿差异审阅" });
  d = c.writing.save(d.projectId, "master", {
    expectedRevision: d.revision,
    markdown: initial,
  });
  const ch = c.writing.document(d.projectId, "wechat");
  const platform = c.writing.save(d.projectId, "wechat", {
    expectedRevision: ch.revision,
    markdown: initial,
    sourceMasterRevision: d.revision,
  });
  return { id: d.projectId, master: d, platform };
}
const input = (
  p,
  choose = (c) => (c.state === "clean" ? "apply" : "keep")
) => ({
  expectedRevision: p.revision,
  expectedMasterRevision: p.masterRevision,
  expectedSourceRevision: p.sourceRevision,
  reviewToken: p.reviewToken,
  decisions: p.changes.map((c) => ({ id: c.id, action: choose(c) })),
});
const save = (c, id, ch, markdown) =>
  c.writing.save(id, ch, {
    expectedRevision: c.writing.document(id, ch).revision,
    markdown,
  });
const call = (c, path, method = "GET", data) =>
  dispatchApi(
    new Request("http://127.0.0.1:4312" + path, {
      method,
      headers: data ? { "content-type": "application/json" } : {},
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    c
  );

test("line changes roundtrip mixed newlines, duplicates, emoji and bounded large regions", () => {
  let seed = 123456;
  const random = (n) => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % n;
  };
  const tokens = ["重复行\n", "中文段落\n", "表情🌲\r\n", "\n", "没有末尾换行"];
  for (let n = 0; n < 180; n++) {
    const make = () =>
        Array.from(
          { length: random(22) },
          () => tokens[random(tokens.length)]
        ).join(""),
      a = make(),
      b = make();
    let result = a;
    for (const h of markdownChanges(a, b).sort((x, y) => y.from - x.from))
      result = result.slice(0, h.from) + h.after + result.slice(h.to);
    assert.equal(result, b);
  }
  const a = Array.from({ length: 600 }, (_, i) => "原行" + i + "\n").join(""),
    b = Array.from({ length: 600 }, (_, i) => "新行" + i + "\n").join("");
  const h = markdownChanges(a, b);
  assert.equal(h.length, 1);
  assert.equal(h[0].coarse, true);
});

test("nonoverlapping master edits merge while platform adaptations and other channels stay intact", (t) => {
  const c = setup(t),
    { id, master } = drafts(c),
    local = initial.replace("最初的结尾。", "公众号自己的结尾与行动建议。");
  save(c, id, "wechat", local);
  save(c, id, "master", initial.replace("最初的开头。", "主稿修订后的开头。"));
  const all = { factual: true, privacy: true, rights: true, layout: true };
  for (const ch of ["wechat", "zhihu"])
    c.editorial.setChecks(id, ch, {
      expectedRevision: c.writing.document(id, ch).revision,
      checks: all,
    });
  const before = c.writing.document(id, "wechat"),
    p = c.writing.compareMaster(id, "wechat");
  assert.equal(p.changes.length, 1);
  assert.equal(p.changes[0].state, "clean");
  const result = c.writing.syncMaster(id, "wechat", input(p));
  assert.equal(
    result.markdown,
    local.replace("最初的开头。", "主稿修订后的开头。")
  );
  assert.equal(result.revision, before.revision + 1);
  assert.equal(result.sourceMasterRevision, p.masterRevision);
  assert.deepEqual(Object.values(result.checks), [false, false, false, false]);
  assert.deepEqual(c.writing.document(id, "zhihu").checks, all);
  assert.equal(
    c.writing.history(id, "master").find((h) => h.revision === master.revision)
      .markdown,
    initial
  );
  assert.equal(
    c.writing.history(id, "wechat").find((h) => h.revision === before.revision)
      .markdown,
    local
  );
  assert.equal(
    c.writing.history(id, "wechat")[0].masterReview.decisions[0].action,
    "apply"
  );
});

test("author may keep one change and merge another, then future merges use the reviewed baseline", (t) => {
  const c = setup(t),
    { id } = drafts(c),
    latest = initial
      .replace("最初的开头。", "新的开头。")
      .replace("最初的结尾。", "新的结尾。");
  save(c, id, "master", latest);
  const p = c.writing.compareMaster(id, "wechat");
  assert.equal(p.changes.length, 2);
  const r = c.writing.syncMaster(
    id,
    "wechat",
    input(p, (h) => (h === p.changes[0] ? "apply" : "keep"))
  );
  assert.equal(r.markdown, initial.replace("最初的开头。", "新的开头。"));
  assert.equal(r.sourceMasterRevision, p.masterRevision);
  save(
    c,
    id,
    "master",
    latest.replace("保持不变的桥段。", "后续补充的新证据。")
  );
  const second = c.writing.compareMaster(id, "wechat");
  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0].state, "clean");
  assert.equal(
    c.writing.syncMaster(id, "wechat", input(second)).markdown,
    r.markdown.replace("保持不变的桥段。", "后续补充的新证据。")
  );
});

test("overlapping changes need explicit keep decisions and cannot be forced into platform text", (t) => {
  const c = setup(t),
    { id } = drafts(c);
  save(c, id, "wechat", initial.replace("最初的开头。", "平台自己的开头。"));
  save(c, id, "master", initial.replace("最初的开头。", "主稿新的开头。"));
  const p = c.writing.compareMaster(id, "wechat"),
    before = c.writing.document(id, "wechat");
  assert.equal(p.changes[0].state, "conflict");
  assert.match(p.changes[0].current, /平台自己的开头/);
  assert.throws(
    () =>
      c.writing.syncMaster(
        id,
        "wechat",
        input(p, () => "apply")
      ),
    (e) => e.status === 409
  );
  assert.throws(
    () => c.writing.syncMaster(id, "wechat", { ...input(p), decisions: [] }),
    (e) => e.status === 400
  );
  assert.equal(c.writing.document(id, "wechat").revision, before.revision);
  const kept = c.writing.syncMaster(id, "wechat", input(p));
  assert.equal(kept.markdown, before.markdown);
  assert.equal(kept.sourceMasterRevision, p.masterRevision);
});

test("identical changes are detected without inserting the same paragraph twice", (t) => {
  const c = setup(t),
    { id } = drafts(c),
    next = initial.replace("最初的开头。", "共同的新开头。");
  save(c, id, "wechat", next);
  save(c, id, "master", next);
  const p = c.writing.compareMaster(id, "wechat");
  assert.equal(p.changes[0].state, "applied");
  assert.equal(c.writing.syncMaster(id, "wechat", input(p)).markdown, next);
  const insert = compareMarkdown("段落\n", "新增\n段落\n", "新增\n段落\n");
  assert.equal(insert[0].state, "applied");
});

test("master deletions and insertions retain unrelated platform edits and exact Unicode offsets", (t) => {
  const c = setup(t),
    { id } = drafts(c),
    local = initial + "公众号附言🌲\n",
    next = initial
      .replace("最初的开头。\n\n", "")
      .replace("保持不变的桥段。", "保持不变的桥段。\n\n新增含🌲的例子。");
  save(c, id, "wechat", local);
  save(c, id, "master", next);
  const p = c.writing.compareMaster(id, "wechat");
  assert.equal(
    p.changes.every((h) => h.state === "clean"),
    true
  );
  assert.equal(
    c.writing.syncMaster(id, "wechat", input(p)).markdown,
    next + "公众号附言🌲\n"
  );
});

test("stale master or platform revisions and forged cross-channel review tokens fail without writes", (t) => {
  const c = setup(t),
    { id } = drafts(c);
  save(c, id, "master", initial + "新主稿附言。");
  let p = c.writing.compareMaster(id, "wechat");
  save(c, id, "master", initial + "更新的主稿附言。");
  assert.throws(
    () => c.writing.syncMaster(id, "wechat", input(p)),
    (e) => e.status === 409
  );
  p = c.writing.compareMaster(id, "wechat");
  save(c, id, "wechat", initial + "平台另一个页面的修改。");
  assert.throws(
    () => c.writing.syncMaster(id, "wechat", input(p)),
    (e) => e.status === 409
  );
  p = c.writing.compareMaster(id, "wechat");
  assert.throws(
    () =>
      c.writing.syncMaster(id, "wechat", {
        ...input(p),
        reviewToken: "forged",
      }),
    (e) => e.status === 409
  );
  assert.throws(
    () => c.writing.syncMaster(id, "zhihu", input(p)),
    (e) => e.status === 409
  );
  assert.equal(
    c.store.db
      .prepare("SELECT COUNT(*) AS n FROM writing_master_sync_reviews")
      .get().n,
    0
  );
});

test("sync audit and Markdown revision roll back together when persistence fails", (t) => {
  const c = setup(t),
    { id } = drafts(c);
  save(c, id, "master", initial + "新增内容。");
  const p = c.writing.compareMaster(id, "wechat"),
    before = c.writing.document(id, "wechat");
  c.store.db.exec(
    "CREATE TRIGGER reject_sync_review BEFORE INSERT ON writing_master_sync_reviews BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;"
  );
  assert.throws(
    () => c.writing.syncMaster(id, "wechat", input(p)),
    /synthetic failure/
  );
  assert.deepEqual(c.writing.document(id, "wechat"), before);
  assert.equal(c.writing.history(id, "wechat")[0].revision, before.revision);
});

test("sync API is scoped to the author core and does not bypass legacy migration or XHS plans", async (t) => {
  const c = setup(t),
    other = setup(t),
    { id } = drafts(c),
    path = "/api/writing/projects/" + id + "/wechat/master-sync";
  assert.equal((await call(c, path)).status, 200);
  assert.equal((await call(other, path)).status, 404);
  assert.equal((await call(other, path, "POST", {})).status, 404);
  const legacy = c.editorial.create({ title: "必须先确认旧排版的文章" });
  assert.equal(
    (
      await call(
        c,
        "/api/writing/projects/" + legacy.id + "/wechat/master-sync"
      )
    ).status,
    409
  );
  assert.throws(
    () => c.writing.compareMaster(id, "xiaohongshu"),
    (e) => e.status === 400
  );
});

test("a reviewed writing context that changed is rejected before any provider call or quota reservation", async (t) => {
  const c = setup(t),
    d = c.writing.create({ title: "先审阅本次写作素材" });
  c.services.save({
    kind: "text",
    name: "合成模型",
    model: "fixture-model",
    baseUrl: "https://model.example/v1/",
    apiKey: "fixture-key",
  });
  const context = c.creator.context(d.projectId),
    expectedContext = {
      revision: context.revision,
      profileRevision: context.profileRevision,
      topicRevision: null,
    };
  let calls = 0;
  c.services.publicTransport = async () => {
    calls++;
    return Response.json({});
  };
  c.creator.setContext(d.projectId, {
    expectedRevision: 0,
    overrides: { tone: "另一个页面的新偏好" },
  });
  await assert.rejects(
    () =>
      c.services.using(() =>
        c.writing.suggest(d.projectId, "master", {
          expectedRevision: d.revision,
          instruction: "写一个初稿",
          allowExternalAI: true,
          expectedContext,
        })
      ),
    (e) => e.status === 409
  );
  assert.equal(calls, 0);
  assert.equal(c.services.usage().recent.length, 0);
  assert.equal(c.writing.document(d.projectId, "master").markdown, "");
});

test("writing sends only included material bodies and retains human-readable immutable source evidence", async (t) => {
  const c = setup(t),
    d = c.writing.create({ title: "可审阅的写作来源" });
  c.services.save({
    kind: "text",
    name: "合成模型",
    model: "fixture-model",
    baseUrl: "https://model.example/v1/",
    apiKey: "fixture-key",
  });
  const a = c.creator.addMaterial({
      title: "发送给写作模型的笔记",
      body: "INCLUDED_PRIVATE_TEXT",
    }),
    b = c.creator.addMaterial({
      title: "这次排除的笔记",
      body: "EXCLUDED_PRIVATE_TEXT",
    });
  c.creator.setContext(d.projectId, {
    expectedRevision: 0,
    refs: [
      { kind: "material", id: a.id },
      { kind: "material", id: b.id },
    ],
    excluded: [b.id],
    overrides: { tone: "只描述自己的观察" },
  });
  let captured;
  c.services.publicTransport = async (_url, options) => {
    captured = JSON.parse(options.body);
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              replacement: "作者审阅之后再接受的新初稿。",
              reason: "保留观察边界",
            }),
          },
        },
      ],
    });
  };
  const ctx = c.creator.context(d.projectId),
    s = await c.services.using(() =>
      c.writing.suggest(d.projectId, "master", {
        expectedRevision: d.revision,
        instruction: "根据所选素材写初稿",
        allowExternalAI: true,
        expectedContext: {
          revision: ctx.revision,
          profileRevision: ctx.profileRevision,
          topicRevision: null,
        },
      })
    );
  assert.match(JSON.stringify(captured), /INCLUDED_PRIVATE_TEXT/);
  assert.equal(
    JSON.stringify(captured).includes("EXCLUDED_PRIVATE_TEXT"),
    false
  );
  assert.equal(s.contextSnapshot.sources[0].title, a.title);
  assert.equal(s.contextSnapshot.sources.length, 1);
  assert.equal(s.contextSnapshot.profile.tone, "只描述自己的观察");
  c.creator.setContext(d.projectId, {
    expectedRevision: ctx.revision,
    refs: [],
    overrides: { tone: "后来新偏好" },
  });
  assert.equal(
    c.writing.suggestions(d.projectId, "master")[0].contextSnapshot.profile
      .tone,
    "只描述自己的观察"
  );
  assert.equal(c.writing.document(d.projectId, "master").markdown, "");
});

test("suggestion and source evidence commit together even when evidence persistence fails", async (t) => {
  const c = setup(t),
    d = c.writing.create({ title: "建议证据同事务保存" });
  c.services.save({
    kind: "text",
    name: "合成模型",
    model: "fixture-model",
    baseUrl: "https://model.example/v1/",
    apiKey: "fixture-key",
  });
  c.services.publicTransport = async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              replacement: "不应留下无来源的建议。",
              reason: "用于验证保存原子性",
            }),
          },
        },
      ],
    });
  c.store.db.exec(
    "CREATE TRIGGER reject_suggestion_context BEFORE INSERT ON writing_suggestion_context BEGIN SELECT RAISE(ABORT,'synthetic evidence failure'); END;"
  );
  await assert.rejects(
    () =>
      c.services.using(() =>
        c.writing.suggest(d.projectId, "master", {
          expectedRevision: d.revision,
          instruction: "写一份初稿",
          allowExternalAI: true,
        })
      ),
    /synthetic evidence failure/
  );
  assert.equal(c.writing.suggestions(d.projectId, "master").length, 0);
  assert.equal(c.writing.document(d.projectId, "master").markdown, "");
  assert.equal(c.services.usage().recent[0].state, "completed");
});
