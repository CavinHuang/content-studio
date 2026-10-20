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
const TARGET = "等待润色建议";
const REPLACEMENT = "已经过审阅润色的表达";
const test = base.extend({
  agentOrigin: [
    async ({}, use) => {
      const model = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw),
          last = body.messages.at(-1);
        res.setHeader("content-type", "application/json");
        if (last.role === "tool") {
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
  const panel = page.locator('section[aria-label="agent 任务运行"]'),
    skills = page.getByLabel("agent 技能");
  await expect(skills.locator("option")).toHaveCount(4);
  await skills.selectOption("selection-rewriter");
  await expect(panel).toContainText(
    "将加载工具：read_document、read_brief、write_suggestions"
  );
  await page.getByLabel("agent 任务要求").fill("请润色正文中待推敲的句子");
  await page
    .getByLabel(
      "允许本次运行调用模型与图片服务，可能产生费用；v1 不设次数上限，逐次记账"
    )
    .check();
  await page.getByRole("button", { name: "启动运行", exact: true }).click();
  const steps = page.locator(".agent-run-steps");
  await expect(steps).toContainText("工具");
  await expect(steps).toContainText("write_suggestions");
  await expect(panel.locator(".writing-source-note")).toContainText("运行完成");
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
