import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function listen(server) {
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
}
// Synthetic loopback provider. The agent runtime's first model call is answered
// with one scripted write_suggestions tool call (a single valid edit for the
// seeded article); the call that follows the tool result returns the final
// completion, which ends the run. App, API and SQLite stay genuine.
// SA-01 刷新接续用例通过 holdModel 闸门把「工具结果后的模型调用」保持住，
// 让运行停在 running 态以供 reload/重连；测试必须自行放行。
const TARGET = "等待润色建议";
const REPLACEMENT = "已经过审阅润色的表达";
// AG-02 article-pipeline 全流程用例：pipelineScript 非空时 provider 按脚本数组
// 依次回放完整 OpenAI 响应（read_brief → write_revision → write_suggestions →
// final），脚本耗尽即测试结束（用例 finally 复位）。测试契约映射自 SKILL-SPEC
// 的 <n>.prompt + <n>.expected 关键字匹配（合成指令 + 页面关键字断言）。
let pipelineScript = null;
let pipelinePhase = 0;
let holdModel = null;
const test = base.extend({
  agentOrigin: [
    async ({}, use) => {
      const model = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw),
          last = body.messages.at(-1);
        res.setHeader("content-type", "application/json");
        if (pipelineScript) {
          res.end(JSON.stringify(pipelineScript[pipelinePhase]));
          pipelinePhase += 1;
          return;
        }
        if (last.role === "tool") {
          if (holdModel)
            await Promise.race([holdModel, sleep(30000)]);
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: "已提交 1 处润色建议，请作者逐项审阅。",
                  },
                },
              ],
              usage: { total_tokens: 100 },
            })
          );
          return;
        }
        const payload = JSON.parse(last.content),
          from = payload.markdown.indexOf(TARGET);
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call_synthetic_1",
                      type: "function",
                      function: {
                        name: "write_suggestions",
                        arguments: JSON.stringify({
                          reason: "合成模型建议改写待润色的句子，请作者审阅。",
                          edits: [
                            {
                              from,
                              to: from + TARGET.length,
                              original: TARGET,
                              replacement: REPLACEMENT,
                            },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { total_tokens: 100 },
          })
        );
      });
      const mp = await listen(model),
        probe = createServer(),
        port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-agent-browser-")),
        safe = {
          ...process.env,
          HOST: "127.0.0.1",
          HOSTNAME: "",
          PORT: String(port),
          NODE_ENV: "production",
          NODE_OPTIONS: "",
          CONTENT_STUDIO_MULTIUSER: "1",
          CONTENT_STUDIO_ACCOUNTS_PATH: root,
          CONTENT_STUDIO_DB_PATH: join(root, "legacy.sqlite"),
          CONTENT_STUDIO_DEPLOY_MODE: "",
          CONTENT_STUDIO_ALLOW_REMOTE: "0",
          ENABLE_SCENARIO: "0",
          CONTENT_AI_BASE_URL: `http://127.0.0.1:${mp}/v1/`,
          CONTENT_AI_MODEL: "synthetic-agent-model",
          CONTENT_AI_API_KEY: "synthetic-agent-key",
          CONTENT_IMAGE_API_KEY: "",
          CONTENT_IMAGE_OPENAI_API_KEY: "",
          CONTENT_IMAGE_GEMINI_API_KEY: "",
          CONTENT_IMAGE_QWEN_API_KEY: "",
          CONTENT_ILLUSTRATION_PLANNER_API_KEY: "",
          CONTENT_IMAGE_REVIEW_API_KEY: "",
        };
      for (const name of Object.keys(safe))
        if (
          name.startsWith("NEXT_PUBLIC_") &&
          /SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|AUTH_KEY/.test(name)
        )
          delete safe[name];
      const child = spawn(
        process.execPath,
        ["scripts/runtime-guard.mjs", "start"],
        { cwd: process.cwd(), env: safe, stdio: ["ignore", "pipe", "pipe"] }
      );
      let logs = "";
      child.stdout.on("data", (d) => {
        logs = (logs + d).slice(-3000);
      });
      child.stderr.on("data", (d) => {
        logs = (logs + d).slice(-3000);
      });
      const origin = "http://127.0.0.1:" + port;
      try {
        let ready = false;
        for (let i = 0; i < 120; i++) {
          if (child.exitCode !== null) throw Error(logs);
          try {
            if ((await fetch(origin + "/api/health")).ok) {
              ready = true;
              break;
            }
          } catch {}
          await sleep(200);
        }
        if (!ready) throw Error("Agent server did not start " + logs);
        await use(origin);
      } finally {
        const done = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await Promise.race([done, sleep(5000)]);
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await done;
        }
        await new Promise((r) => model.close(r));
        rmSync(root, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ agentOrigin }, use) => use(agentOrigin),
});
async function signup(page, email = "agent-author@example.test") {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成测试作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}
const cm = (page) => page.getByLabel("文章 Markdown 正文");
// page.request shares the signed-in browser context's cookies; a standalone
// request fixture would fail the multiuser session check.
const stored = (page, doc) =>
  page.request.get(`/api/writing/projects/${doc.projectId}/master`).then((r) =>
    r.json()
  );

test("agent run streams tool steps, files a reviewed suggestion and leaves the article untouched", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "agent-run@example.test");
  const seeded = "# 合成运行的文章\n\n第一段保留原始内容，" + TARGET + "。\n";
  const doc = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "agent 运行视图的合成文章" },
    })
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/master`, {
    data: { expectedRevision: doc.revision, markdown: seeded },
  });
  const baseline = await stored(page, doc);
  await page.goto("/compose?project=" + doc.projectId);
  await expect(cm(page)).toContainText(TARGET);
  // 技能任务面板收在助手栏「技能任务（多步 Agent）」details 里
  await page.getByText("技能任务（多步 Agent）").click();
  const panel = page.locator('section[aria-label="agent 任务运行"]'),
    skills = page.getByLabel("agent 技能");
  await expect(skills.locator("option")).toHaveCount(8);
  await skills.selectOption("selection-rewriter");
  await expect(panel).toContainText(
    "将加载工具：read_document、read_brief、write_suggestions"
  );
  await page.getByLabel("agent 任务要求").fill("请润色正文中待推敲的句子");
  // SC-02：面板额度预判可见（GET /api/creator/usage 派生，逐次记账口径）
  await expect(panel).toContainText("今日模型请求剩余");
  await expect(panel).toContainText("次（逐次记账）");
  await page.getByLabel("允许本次运行调用模型与图片服务").check();
  await page.getByRole("button", { name: "启动运行", exact: true }).click();
  const steps = page.locator(".agent-run-steps");
  await expect(steps).toContainText("工具");
  await expect(steps).toContainText("write_suggestions");
  await expect(panel.locator(".writing-source-note")).toContainText("运行完成");
  // SA-02 回归守卫：completed 运行不出现重驱动按钮（interrupted/failed 专属）
  await expect(
    panel.getByRole("button", { name: "按原技能与模型绑定重新驱动" })
  ).toHaveCount(0);
  await page.reload();
  await expect(cm(page)).toContainText(TARGET);
  await expect(page.locator(".writing-suggestions")).toContainText(
    "agent：选区改写"
  );
  // 一次运行只提交一条建议：卡片是 WritingWorkspace 里的 article.writing-suggestion。
  await expect(page.locator("article.writing-suggestion")).toHaveCount(1);
  const after = await stored(page, doc);
  expect(after.markdown).toBe(seeded);
  expect(after.markdown).not.toContain(REPLACEMENT);
  expect(after.revision).toBe(baseline.revision);
  expect(errors).toEqual([]);
});

test("刷新接续：面板恢复本渠道 running 运行与步骤，重连推进到完成；他渠道运行不附着", async ({
  page,
}) => {
  await signup(page, "agent-refresh@example.test");
  const doc = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "刷新接续的合成文章" },
    })
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/master`, {
    data: { expectedRevision: doc.revision, markdown: "# 接续文章\n\n" + TARGET + "的句子。\n" },
  });
  const panel = page.locator('section[aria-label="agent 任务运行"]');
  await page.goto("/compose?project=" + doc.projectId);
  await expect(cm(page)).toContainText("接续文章");
  await page.getByText("技能任务（多步 Agent）").click();
  await page.getByLabel("agent 任务要求").fill("请挂起润色正文中待推敲的句子");
  await page.getByLabel("允许本次运行调用模型与图片服务").check();
  // 开启闸门后启动：首个模型帧立即落库，工具结果后的调用被保持（running 态）
  let release;
  holdModel = new Promise((r) => {
    release = r;
  });
  try {
    await page.getByRole("button", { name: "启动运行", exact: true }).click();
    const steps = page.locator(".agent-run-steps");
    await expect(steps).toContainText("模型");
    await expect(panel.getByRole("button", { name: "取消运行" })).toBeVisible();
    // 刷新：挂载 effect 从运行列表恢复本渠道 running 运行（含已有步骤）
    await page.reload();
    await expect(cm(page)).toContainText("接续文章");
    await page.getByText("技能任务（多步 Agent）").click();
    await expect(panel.getByRole("button", { name: "取消运行" })).toBeVisible();
    await expect(steps).toContainText("模型");
    // FIX-02：不刷新的渠道切换——切到无运行的公众号渠道后，上一渠道的运行
    // 卡片（含取消按钮）必须消失（不回落展示其它渠道、也不残留本面板旧态）；
    // 切回主稿后刷新接续重新附着本渠道 running 运行。开折叠层用 toPass 原子
    // 重试：cm 可见也可能落在渠道已翻转、文档尚未卸载的过渡渲染上，一次性
    // evaluate 绑定的 details 会被随后的 setDoc(null) 卸载——重试循环在最终
    // 挂载上重开 details 再断言，对装载时序稳健（全量套件负载下实测必要）。
    await page.getByRole("tab", { name: "微信公众号" }).click();
    const agentDetails = page.locator("details.cv2-assistant-advanced");
    await agentDetails.evaluate((el) => {
      el.open = true;
    });
    await expect(panel.getByRole("button", { name: "取消运行" })).toHaveCount(0);
    await expect(panel.locator(".agent-run-steps")).toHaveCount(0);
    await page.getByRole("tab", { name: "主稿" }).click();
    await expect(async () => {
      await agentDetails.evaluate((el) => {
        el.open = true;
      });
      await expect(
        panel.getByRole("button", { name: "取消运行" })
      ).toBeVisible();
      await expect(steps).toContainText("模型");
    }).toPass({ timeout: 20_000 });
    // 放行 → 重连流按 seq 游标推进到完成（无需再次刷新）
    release();
    holdModel = null;
    await expect(panel.locator(".writing-source-note")).toContainText(
      "运行完成"
    );
    await expect(panel.getByRole("button", { name: "取消运行" })).toHaveCount(0);
  } finally {
    if (holdModel) {
      release();
      holdModel = null;
    }
  }

  // 另一渠道（公众号）的运行不被本渠道面板附着：构造 wechat 挂起运行后刷新
  await page.request.post(`/api/creator/projects/${doc.projectId}/channels`, {
    data: { channel: "wechat" },
  });
  const wechatDoc = await (
    await page.request.get(`/api/writing/projects/${doc.projectId}/wechat`)
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/wechat`, {
    data: {
      expectedRevision: wechatDoc.revision,
      markdown: "# 公众号接续\n\n" + TARGET + "的句子。\n",
    },
  });
  let releaseWechat;
  holdModel = new Promise((r) => {
    releaseWechat = r;
  });
  try {
    await page.request.post(
      `/api/creator/projects/${doc.projectId}/agent-runs`,
      {
        data: {
          skillId: "selection-rewriter",
          instruction: "请挂起处理公众号正文",
          expectedRevision: wechatDoc.revision + 1,
          allowExternalAI: true,
          channel: "wechat",
        },
      }
    );
    // 本页面停在 master 渠道：wechat 的 running 运行不得附着（无「取消运行」），
    // 终态的 master 运行也不得回落展示（时间线保持初始为空）
    await page.reload();
    await page.getByText("技能任务（多步 Agent）").click();
    await expect(
      panel.getByRole("button", { name: "取消运行" })
    ).toHaveCount(0);
    await expect(panel.locator(".agent-run-steps")).toHaveCount(0);
  } finally {
    if (holdModel) {
      releaseWechat();
      holdModel = null;
    }
  }
});

// DF-01（QA §10.4.1 回归）：「取消运行」必须走真实用户点击（不能只调 API）。
// 修复前根因：cancel 函数体在同一 try 块内 `const {run}` 解构声明与组件态同名
// 变量，URL 模板串 ${run.id} 求值命中 const TDZ → ReferenceError 在 fetch 发起
// 前抛出、被 catch 吞进 onNotice——表现为点击无请求、无 pageerror。本用例断言
// 点击后按钮消失、终态文案（运行未完成/作者取消运行）、服务端轨迹 cancelled、
// pageerror 为空；holdModel 闸门构造 running 态（形态同「刷新接续」用例）。
test("取消运行：真实点击后按钮消失、轨迹 cancelled（QA §10.4.1 回归）", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "agent-cancel@example.test");
  const doc = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "取消运行的合成文章" },
    })
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/master`, {
    data: {
      expectedRevision: doc.revision,
      markdown: "# 待取消文章\n\n" + TARGET + "的句子。\n",
    },
  });
  const panel = page.locator('section[aria-label="agent 任务运行"]');
  await page.goto("/compose?project=" + doc.projectId);
  await expect(cm(page)).toContainText("待取消文章");
  await page.getByText("技能任务（多步 Agent）").click();
  await page.getByLabel("agent 任务要求").fill("请挂起润色正文中待推敲的句子");
  await page.getByLabel("允许本次运行调用模型与图片服务").check();
  let release;
  holdModel = new Promise((r) => {
    release = r;
  });
  try {
    await page.getByRole("button", { name: "启动运行", exact: true }).click();
    await expect(page.locator(".agent-run-steps")).toContainText("模型");
    const cancelBtn = panel.getByRole("button", { name: "取消运行" });
    await expect(cancelBtn).toBeVisible();
    // 真实用户点击（修复前：TDZ 异常被吞，按钮不消失、轨迹停在 running）
    await cancelBtn.click();
    await expect(cancelBtn).toHaveCount(0);
    await expect(panel.locator(".writing-source-note")).toContainText(
      "运行未完成"
    );
    await expect(panel.locator(".writing-source-note")).toContainText(
      "作者取消运行"
    );
    // 领域真值双确认：page.request（共享登录 cookie）复核服务端轨迹终态
    const { runs } = await page.request
      .get(`/api/creator/projects/${doc.projectId}/agent-runs`)
      .then((r) => r.json());
    expect(runs[0].status).toBe("cancelled");
    expect(runs[0].stopReason).toBe("作者取消运行");
    expect(errors).toEqual([]);
  } finally {
    if (holdModel) {
      release();
      holdModel = null;
    }
  }
});

// AG-02：article-pipeline 全流程用例。脚本化 provider 依次回
// read_brief → write_revision（标题骨架 + 正文）→ write_suggestions（1 条）→
// final content；「不过先改再交付」质量门（social-content 步骤 7 语义）由脚本里
// 编排的自审建议轮验证。修订制零文件写入：直写落新修订，自审落待审建议。
test("article-pipeline 全流程：读→直写初稿→自审建议→收尾，措辞止于导出准备", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "agent-pipeline@example.test");
  const seeded = "只有一段没有标题的起点正文。\n";
  const doc = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "全流程流水线的合成文章" },
    })
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/master`, {
    data: { expectedRevision: doc.revision, markdown: seeded },
  });
  const baseline = await stored(page, doc);
  // 流水线直写初稿需要 revisions 写模式（ag_default 种子为建议制；finally 恢复）
  await page.request.put("/api/creator/agent", {
    data: { writeMode: "revisions" },
  });
  const DRAFT =
    "# 流水线标题骨架\n\n## 第一节：问题\n\n合成模型按简报直写的完整初稿正文。\n";
  const SENTENCE = "合成模型按简报直写的完整初稿正文";
  const FINAL =
    "产出：含标题骨架的初稿新修订与 1 处自审建议。人工下一步：逐项审阅建议 → 四项人工检查 → 需要时配图 → 导出准备。";
  const call = (id, name, args) => ({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: { total_tokens: 100 },
  });
  const stop = (content) => ({
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { total_tokens: 100 },
  });
  pipelineScript = [
    call("pl_1", "read_brief", {}),
    call("pl_2", "write_revision", { markdown: DRAFT, reason: "全流程初稿" }),
    call("pl_3", "write_suggestions", {
      reason: "自审：开头补「并自审」限定，让改写可追溯",
      edits: [
        {
          from: DRAFT.indexOf(SENTENCE),
          to: DRAFT.indexOf(SENTENCE) + SENTENCE.length,
          original: SENTENCE,
          replacement: "合成模型按简报直写并自审的完整初稿正文",
        },
      ],
    }),
    stop(FINAL),
  ];
  pipelinePhase = 0;
  const panel = page.locator('section[aria-label="agent 任务运行"]'),
    skills = page.getByLabel("agent 技能");
  try {
    await page.goto("/compose?project=" + doc.projectId);
    await expect(cm(page)).toContainText("起点正文");
    await page.getByText("技能任务（多步 Agent）").click();
    await skills.selectOption("article-pipeline");
    await page.getByLabel("agent 任务要求").fill("按简报产出完整初稿，先大纲再正文");
    await page.getByLabel("允许本次运行调用模型与图片服务").check();
    await page.getByRole("button", { name: "启动运行", exact: true }).click();
    const steps = page.locator(".agent-run-steps");
    // 模型/工具步骤序列：read_brief → write_revision → write_suggestions
    await expect(steps).toContainText("read_brief");
    await expect(steps).toContainText("write_revision");
    await expect(steps).toContainText("write_suggestions");
    await expect(panel.locator(".writing-source-note")).toContainText(
      "运行完成"
    );
    // 收尾文案列出人工下一步、止于「导出准备」，无发布承诺
    await expect(panel).toContainText("人工下一步");
    await expect(panel).toContainText("导出准备");
    const panelText = await panel.innerText();
    expect(panelText).not.toContain("已发布");
    expect(panelText).not.toContain("自动发布");
    // 修订历史 +1：master 推进到含标题骨架的直写新修订
    const after = await stored(page, doc);
    expect(after.revision).toBe(baseline.revision + 1);
    expect(after.markdown).toBe(DRAFT);
    // 建议列表出现 1 条待审（自审轮；重载后建议区渲染）
    await page.reload();
    await expect(page.locator("article.writing-suggestion")).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    pipelineScript = null;
    pipelinePhase = 0;
    await page.request.put("/api/creator/agent", {
      data: { writeMode: "suggestions" },
    });
  }
});

// SC-01：同渠道第二条运行入队（queued 不再 409 死胡同）。r6.1 中间态守卫断言：
// 放行 A 前运行列表必须恰「一条 running + 一条 queued」——否则该用例对认领守卫
// 缺陷（同渠道双 loop）不可判。reload 后面板附着最新活跃行 B（排队中文案+取消），
// 放行 A 后 drain 自动补位，B 自动开始并完成。
test("排队：同渠道第二条运行入队，守卫保持单 running，前序完成后自动补位完成", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "agent-queue@example.test");
  const doc = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "排队合流的合成文章" },
    })
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/master`, {
    data: {
      expectedRevision: doc.revision,
      markdown: "# 排队文章\n\n" + TARGET + "的句子。\n",
    },
  });
  const panel = page.locator('section[aria-label="agent 任务运行"]');
  await page.goto("/compose?project=" + doc.projectId);
  await expect(cm(page)).toContainText("排队文章");
  await page.getByText("技能任务（多步 Agent）").click();
  await page.getByLabel("agent 任务要求").fill("请挂起润色正文中待推敲的句子");
  await page.getByLabel("允许本次运行调用模型与图片服务").check();
  let release;
  holdModel = new Promise((r) => {
    release = r;
  });
  try {
    await page.getByRole("button", { name: "启动运行", exact: true }).click();
    await expect(page.locator(".agent-run-steps")).toContainText("模型");
    // 同渠道第二条：201 queued（单飞命中 running 改入队，不再 409）
    const current = await stored(page, doc);
    const post = await page.request.post(
      `/api/creator/projects/${doc.projectId}/agent-runs`,
      {
        data: {
          skillId: "selection-rewriter",
          instruction: "排队第二轮",
          expectedRevision: current.revision,
          allowExternalAI: true,
        },
      }
    );
    expect(post.status()).toBe(201);
    const { run: queuedRun } = await post.json();
    expect(queuedRun.status).toBe("queued");
    // r6.1 中间态守卫断言：恰一条 running（A）+ 一条 queued（B）
    const { runs } = await page.request
      .get(`/api/creator/projects/${doc.projectId}/agent-runs`)
      .then((r) => r.json());
    expect(runs.filter((r) => r.status === "running")).toHaveLength(1);
    expect(runs.filter((r) => r.status === "queued")).toHaveLength(1);
    // reload → 面板附着最新活跃行 B：排队中文案 + 取消可见
    await page.reload();
    await expect(cm(page)).toContainText("排队文章");
    await page.getByText("技能任务（多步 Agent）").click();
    await expect(panel).toContainText("排队中（第");
    await expect(panel).toContainText("进程重启后不会自动执行");
    await expect(panel.getByRole("button", { name: "取消运行" })).toBeVisible();
    // 放行 A → loop.finally 链 drain 补位 → B 自动开始并完成
    release();
    holdModel = null;
    await expect(panel.locator(".writing-source-note")).toContainText(
      "运行完成"
    );
    expect(errors).toEqual([]);
  } finally {
    if (holdModel) {
      release();
      holdModel = null;
    }
  }
});

// AW-02：快捷指令菜单（BrushEntry 适配）——搜索收窄、选中仅预填（技能 select
// 与任务要求 textarea），consent 未勾选、启动按钮仍 disabled，证明不自动发送。
test("快捷指令菜单：搜索收窄、选中仅预填，consent 未勾选、启动仍禁用", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "agent-quick@example.test");
  const doc = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "快捷指令的合成文章" },
    })
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/master`, {
    data: {
      expectedRevision: doc.revision,
      markdown: "# 快捷指令文章\n\n正文。\n",
    },
  });
  const panel = page.locator('section[aria-label="agent 任务运行"]');
  await page.goto("/compose?project=" + doc.projectId);
  await page.getByText("技能任务（多步 Agent）").click();
  const quickMenu = panel.locator('details[aria-label="快捷指令"]');
  await quickMenu.locator("summary").click();
  await page.getByLabel("搜索快捷指令").fill("大纲");
  // 列表收窄：8 条 preset 中唯一含「大纲」的是 article-pipeline
  await expect(quickMenu.getByRole("button")).toHaveCount(1);
  await quickMenu.getByRole("button", { name: /全流程初稿流水线/ }).click();
  await expect(page.getByLabel("agent 技能")).toHaveValue("article-pipeline");
  await expect(page.getByLabel("agent 任务要求")).toHaveValue(
    "从简报到初稿一次跑完：先确保大纲，再生成初稿并自审一轮"
  );
  await expect(
    page.getByLabel("允许本次运行调用模型与图片服务")
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "启动运行", exact: true })
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
