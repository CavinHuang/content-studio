import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}
const test = base.extend({
  writingOrigin: [
    async ({}, use) => {
      // Genuine application API + guarded Next + SQLite; only the external LLM
      // is replaced with an explicitly synthetic loopback HTTP provider.
      const interruptedStreams = new Set();
      const model = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        if (req.url.endsWith("/images/generations")) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              data: [
                {
                  b64_json:
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=",
                },
              ],
            })
          );
          return;
        }
        const input = JSON.parse(raw),
          payload = JSON.parse(input.messages.at(-1).content);
        if (payload.instruction.includes("多处独立调整")) {
          const a = "修改第一处。",
            b = "修改第二处。",
            first = payload.article.indexOf(a),
            second = payload.article.indexOf(b);
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      reason: "分别调整两处，保留其他内容",
                      edits: [
                        {
                          from: first,
                          to: first + a.length,
                          original: a,
                          replacement: "第一处经过审阅的新表达。",
                        },
                        {
                          from: second,
                          to: second + b.length,
                          original: b,
                          replacement: "第二处经过审阅的新表达。",
                        },
                      ],
                    }),
                  },
                },
              ],
            })
          );
          return;
        }
        if (input.stream && payload.instruction.includes("流式")) {
          const content = JSON.stringify({
              replacement: "# 流式预览\n\n这是完整的流式合成初稿🌲。",
              reason: "合成 SSE 流，仍需作者确认",
            }),
            cut = content.indexOf("这是"),
            first = content.slice(0, cut),
            last = content.slice(cut),
            write = (value) =>
              res.write("data: " + JSON.stringify(value) + "\n\n");
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
          });
          write({
            choices: [{ delta: { content: first }, finish_reason: null }],
          });
          const key = payload.title,
            interrupt =
              payload.instruction.includes("中断一次") &&
              !interruptedStreams.has(key);
          if (interrupt) interruptedStreams.add(key);
          const timer = setTimeout(
            () => {
              if (res.destroyed) return;
              if (!interrupt) {
                write({
                  choices: [{ delta: { content: last }, finish_reason: null }],
                });
                write({
                  choices: [{ delta: {}, finish_reason: "stop" }],
                  usage: { total_tokens: 60 },
                });
                res.write("data: [DONE]\n\n");
              }
              res.end();
            },
            payload.instruction.includes("停止流式") ? 10000 : 1200
          );
          res.on("close", () => clearTimeout(timer));
          return;
        }
        if (payload.instruction.includes("模拟故障")) {
          res.writeHead(503);
          res.end("synthetic failure");
          return;
        }
        const replacement =
          payload.mode === "discuss"
            ? ""
            : payload.selection.text
            ? "经过审阅的新表达。"
            : "# 合成初稿\n\n这是由测试模型返回的文章，用来验证编辑流程。";
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    replacement,
                    reason: "合成模型：简化表达，保留作者审阅。",
                  }),
                },
              },
            ],
          })
        );
      });
      const modelPort = await listen(model),
        probe = createServer(),
        port = await listen(probe);
      await new Promise((resolve) => probe.close(resolve));
      const folder = mkdtempSync(join(tmpdir(), "studio-writing-browser-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_DB_PATH: join(folder, "synthetic.sqlite"),
        CONTENT_STUDIO_DEPLOY_MODE: "",
        CONTENT_STUDIO_ALLOW_REMOTE: "0",
        ENABLE_SCENARIO: "0",
        CONTENT_AI_BASE_URL: `http://127.0.0.1:${modelPort}/v1/`,
        CONTENT_AI_MODEL: "synthetic-loopback-writing",
        CONTENT_AI_API_KEY: "not-a-real-key",
        CONTENT_IMAGE_API_KEY: "",
        CONTENT_IMAGE_OPENAI_API_KEY: "synthetic-image-key",
        CONTENT_IMAGE_OPENAI_BASE_URL: `http://127.0.0.1:${modelPort}/v1/`,
        CONTENT_IMAGE_OPENAI_MODEL: "synthetic-image-model",
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
      const origin = `http://127.0.0.1:${port}`;
      try {
        let ready = false;
        for (let i = 0; i < 120; i++) {
          if (child.exitCode !== null)
            throw Error("Synthetic Next server exited: " + logs);
          try {
            const r = await fetch(origin + "/api/health");
            if (r.ok) {
              ready = true;
              break;
            }
          } catch {}
          await sleep(200);
        }
        if (!ready) throw Error("Synthetic Next readiness timeout: " + logs);
        await use(origin);
      } finally {
        const ended = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        await Promise.race([ended, sleep(5000)]);
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await ended;
        }
        await new Promise((resolve) => model.close(resolve));
        rmSync(folder, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ writingOrigin }, use) => use(writingOrigin),
});
const cm = (page) => page.getByLabel("文章 Markdown 正文");
async function create(request, title) {
  const r = await request.post("/api/writing/projects", { data: { title } });
  expect(r.ok()).toBe(true);
  return r.json();
}
async function stored(request, doc, channel = "master") {
  return (
    await request.get(`/api/writing/projects/${doc.projectId}/${channel}`)
  ).json();
}

test("author creates, edits, previews, autosaves and reloads complex Markdown in the integrated doocs editor", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/compose");
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  await page.getByLabel("新文章标题").fill("浏览器中完整的 Markdown 创作");
  await page.getByRole("button", { name: "开始创作", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "浏览器中完整的 Markdown 创作" })
  ).toBeVisible();
  const markdown =
    '# 一个真实的创作入口\n\n作者自己的 **重要观点**。\n\n| 步骤 | 说明 |\n| --- | --- |\n| 写作 | 编辑与审阅 |\n\n```js\nconst message = "hello";\n```';
  await cm(page).fill(markdown);
  await expect(
    page
      .getByLabel("文章排版预览")
      .getByRole("heading", { name: "一个真实的创作入口" })
  ).toBeVisible();
  await expect(
    page.getByLabel("文章排版预览").getByRole("table")
  ).toBeVisible();
  const id = await page.getByLabel("当前文章").inputValue(),
    doc = { projectId: id };
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toBe(markdown);
  await page.getByRole("button", { name: "排版与主题" }).click();
  await page.getByLabel("文章主题").selectOption("ink");
  await expect.poll(async () => (await stored(request, doc)).theme).toBe("ink");
  await page.reload();
  await expect(cm(page)).toContainText("一个真实的创作入口");
  expect((await stored(request, doc)).markdown).toBe(markdown);
  await page.getByRole("button", { name: "版本", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "文章版本历史" })
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  expect(errors).toEqual([]);
});

test("real loopback model suggestion appears inline, changes nothing until accepted and retains undo", async ({
  page,
  request,
}) => {
  const doc = await create(request, "作者审阅局部 AI 修改");
  await page.goto("/compose?project=" + doc.projectId);
  await cm(page).fill("这是需要修改的原始句子。");
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toBe("这是需要修改的原始句子。");
  await cm(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByLabel("对选中文字提出要求").fill("请简化选中的表达");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成局部修改建议" }).click();
  await expect(page.locator(".writing-inline-suggestion")).toContainText(
    "经过审阅的新表达。"
  );
  expect((await stored(request, doc)).markdown).toBe(
    "这是需要修改的原始句子。"
  );
  await page
    .locator(".writing-inline-suggestion")
    .getByRole("button", { name: "接受修改" })
    .click();
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toBe("经过审阅的新表达。");
  await expect(cm(page)).toContainText("经过审阅的新表达。");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(cm(page)).toContainText("这是需要修改的原始句子。");
});

test("two open pages cannot overwrite newer server content; local conflicting draft remains downloadable", async ({
  page,
  context,
  request,
}) => {
  const doc = await create(request, "两个窗口的冲突保护");
  await page.goto("/compose?project=" + doc.projectId);
  await expect(cm(page)).toBeVisible();
  const other = await context.newPage();
  await other.goto("/compose?project=" + doc.projectId);
  await expect(cm(other)).toBeVisible();
  await cm(page).fill("窗口一已经保存的重要内容。");
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toBe("窗口一已经保存的重要内容。");
  await cm(other).fill("窗口二尚未合并的本地内容。");
  await expect(
    other.getByRole("button", { name: "下载本地草稿" })
  ).toBeVisible();
  await expect(cm(other)).toContainText("窗口二尚未合并的本地内容。");
  expect((await stored(request, doc)).markdown).toBe(
    "窗口一已经保存的重要内容。"
  );
  const event = other.waitForEvent("download");
  await other.getByRole("button", { name: "下载本地草稿" }).click();
  expect((await event).suggestedFilename()).toBe("local-writing-draft.md");
  await other.close();
});

test("preview strips active HTML and blocks automatic external image requests; mobile stays within viewport", async ({
  page,
  request,
}) => {
  const doc = await create(request, "安全预览与窄屏布局");
  const external = [];
  page.on("request", (r) => {
    if (r.url().includes("tracking.example")) external.push(r.url());
  });
  await page.goto("/compose?project=" + doc.projectId);
  await cm(page).fill(
    '# 安全预览\n\n<script>window.WRITING_INJECTED=true</script>\n\n![跟踪图片](https://tracking.example/pixel.png)\n\n<a href="javascript:alert(1)">危险链接</a>'
  );
  await expect(page.getByLabel("文章排版预览")).toContainText("跟踪图片");
  expect(await page.evaluate(() => window.WRITING_INJECTED)).toBeUndefined();
  expect(external).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "安全预览与窄屏布局", exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: "test-results/writing-workspace-mobile.png",
    fullPage: true,
  });
});

test("discussion answers without changing the article, and model failure keeps the current draft", async ({
  page,
  request,
}) => {
  const doc = await create(request, "讨论与服务失败的正文保护");
  await page.goto("/compose?project=" + doc.projectId);
  await cm(page).fill("作者已经写下的正文。");
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toBe("作者已经写下的正文。");
  const revision = (await stored(request, doc)).revision;
  await page.getByRole("button", { name: "讨论", exact: true }).click();
  await page
    .getByLabel("与助手讨论观点和写作方向")
    .fill("先讨论这个选题的角度");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "发送讨论" }).click();
  await expect(page.locator(".writing-suggestions")).toContainText("讨论回复");
  expect((await stored(request, doc)).revision).toBe(revision);
  await page.getByLabel("与助手讨论观点和写作方向").fill("模拟故障");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "发送讨论" }).click();
  await expect(page.locator(".writing-notice")).toContainText("HTTP 503");
  await expect(cm(page)).toContainText("作者已经写下的正文。");
});

test("image insertion is persisted, platform draft stays independent and reviewed Markdown can be downloaded", async ({
  page,
  request,
}) => {
  const doc = await create(request, "配图插入与平台导出");
  await page.goto("/compose?project=" + doc.projectId);
  await cm(page).fill("# 含图文章\n\n本篇文章的正文。");
  // V2 创作空间默认展开左栏；确保打开而不是把已打开的左栏关掉。
  const railToggle = page.getByRole("button", { name: "大纲与素材" });
  if ((await railToggle.getAttribute("aria-pressed")) === "false")
    await railToggle.click();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=";
  await cm(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.getByLabel("上传文章图片").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toContain("asset://as_");
  const master = await stored(request, doc),
    assetId = master.markdown.match(/asset:\/\/(as_[a-f0-9]{32})/)[1];
  await expect(page.getByLabel("文章排版预览").getByRole("img")).toBeVisible();
  await page.getByRole("tab", { name: "微信公众号" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "从主稿创建新版本" }).click();
  await expect
    .poll(async () => (await stored(request, doc, "wechat")).markdown)
    .toBe(master.markdown);
  expect((await stored(request, doc)).revision).toBe(master.revision);
  await request.put("/api/assets/" + assetId + "/mappings/wechat", {
    data: {
      url: "https://cdn.example.org/synthetic-writing.png",
      note: "合成测试图片映射，不代表真实 CDN 访问已验证",
    },
  });
  await page.getByRole("button", { name: "发布准备", exact: true }).click();
  for (const label of [
    "事实与引用已核对",
    "隐私信息已核对",
    "文字与图片使用权已核对",
    "已在目标平台核对排版",
  ])
    await page.getByLabel(label).check();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 Markdown", exact: true })
    .click();
  expect((await event).suggestedFilename()).toMatch(/wechat-v\d+\.md/);
  const project = await (
    await request.get("/api/editor/projects/" + doc.projectId)
  ).json();
  expect(project.channels.wechat.status).toBe("exported");
  expect(project.channels.wechat.reportedUrl).toBe("");
});

test("selected paragraph image is planned, generated via loopback service and inserted without deleting the selection", async ({
  page,
  request,
}) => {
  const doc = await create(request, "主稿选段配图的完整流程");
  await page.goto("/compose?project=" + doc.projectId);
  const original =
    "这段正文需要一张说明思路的概念插画，同时保留作者已经写好的内容。";
  await cm(page).fill(original);
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toBe(original);
  await cm(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "配图", exact: true }).click();
  await page.getByRole("button", { name: "为选段规划配图" }).click();
  const panel = page.getByLabel("文章配图助手");
  await expect(panel).toContainText("当前计划 1 张");
  await panel
    .getByLabel("允许本次将标题与章节摘要发送至所选图片服务，可能产生费用")
    .check();
  await panel.getByRole("button", { name: "生成待处理图片" }).click();
  await expect(panel.getByLabel("选择这张图片")).toBeVisible();
  await panel.getByLabel("选择这张图片").check();
  await panel.getByRole("button", { name: "将选中图片插入文章" }).click();
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toContain("asset://as_");
  const result = await stored(request, doc);
  expect(result.markdown).toContain(original);
  await expect(page.getByLabel("文章排版预览").getByRole("img")).toBeVisible();
});

test("refresh before autosave can recover the tab-local draft without silently overwriting server content", async ({
  page,
  request,
}) => {
  const doc = await create(request, "自动保存前刷新后的恢复");
  await page.goto("/compose?project=" + doc.projectId);
  await expect(cm(page)).toBeVisible();
  await cm(page).fill("刷新之前尚未自动保存的作者草稿。");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "恢复本地未保存草稿" })
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复本地未保存草稿" }).click();
  await expect(cm(page)).toContainText("刷新之前尚未自动保存的作者草稿。");
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toBe("刷新之前尚未自动保存的作者草稿。");
});

test("author reviews master changes, merges clean edits and preserves overlapping platform adaptations", async ({
  page,
  request,
}) => {
  const doc = await create(request, "审阅并合并平台稿"),
    id = doc.projectId,
    original =
      "# 独立创作\n\n原来的开头。\n\n共同保留的桥段。\n\n原来的结尾。\n";
  const master = await (
    await request.put(`/api/writing/projects/${id}/master`, {
      data: { expectedRevision: doc.revision, markdown: original },
    })
  ).json();
  const channel = await stored(request, doc, "wechat"),
    local = original.replace("原来的结尾。", "公众号自己的结尾。");
  await request.put(`/api/writing/projects/${id}/wechat`, {
    data: {
      expectedRevision: channel.revision,
      markdown: local,
      sourceMasterRevision: master.revision,
    },
  });
  await request.put(`/api/writing/projects/${id}/master`, {
    data: {
      expectedRevision: master.revision,
      markdown: original
        .replace("原来的开头。", "主稿新的开头。")
        .replace("原来的结尾。", "主稿新的结尾。"),
    },
  });
  await page.goto("/compose?project=" + id + "&channel=wechat");
  await page
    .getByRole("button", { name: "查看并合并主稿差异", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "主稿更新审阅" });
  await expect(dialog).toContainText("与平台改写重叠");
  await expect(
    dialog.getByRole("button", {
      name: "确认选择并保存平台新版本",
      exact: true,
    })
  ).toBeDisabled();
  await expect(dialog).toContainText("公众号自己的结尾。");
  await dialog
    .getByLabel("已审阅修改 2，保留平台表达", { exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "确认选择并保存平台新版本", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(cm(page)).toContainText("主稿新的开头。");
  await expect(cm(page)).toContainText("公众号自己的结尾。");
  const merged = await stored(request, doc, "wechat");
  expect(merged.markdown).toBe(local.replace("原来的开头。", "主稿新的开头。"));
  expect(Object.values(merged.checks)).toEqual([false, false, false, false]);
  await page.getByRole("button", { name: "版本", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "文章版本历史" })
  ).toContainText("合入 1 处，保留 1 处");
  await page
    .getByRole("dialog", { name: "文章版本历史" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const m = await stored(request, doc);
  await request.put(`/api/writing/projects/${id}/master`, {
    data: {
      expectedRevision: m.revision,
      markdown: m.markdown.replace(
        "共同保留的桥段。",
        "新增了待核实的实践观察。"
      ),
    },
  });
  await page
    .getByRole("button", { name: "查看并合并主稿差异", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await request.put(`/api/writing/projects/${id}/wechat`, {
    data: {
      expectedRevision: merged.revision,
      markdown: merged.markdown + "另一个页面新写的附言。",
    },
  });
  await dialog
    .getByRole("button", { name: "确认选择并保存平台新版本", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("主稿或平台稿已变化");
  expect((await stored(request, doc, "wechat")).markdown).toContain(
    "另一个页面新写的附言。"
  );
  await dialog
    .getByRole("button", { name: "关闭差异审阅", exact: true })
    .click();
});

test("writer sees actual source context and must reconfirm changed context before a model request", async ({
  page,
  request,
}) => {
  const doc = await create(request, "发送前核对写作上下文"),
    id = doc.projectId;
  const a = await (
      await request.post("/api/creator/materials", {
        data: {
          title: "本次允许使用的创作笔记",
          body: "只描述一次写作实践，不推断长期效果。",
        },
      })
    ).json(),
    b = await (
      await request.post("/api/creator/materials", {
        data: {
          title: "本次不使用的个人日记",
          body: "这份日记不参与本次写作。",
        },
      })
    ).json();
  const path = "/api/creator/projects/" + id + "/context";
  await request.put(path, {
    data: {
      expectedRevision: 0,
      refs: [
        { kind: "material", id: a.id },
        { kind: "material", id: b.id },
      ],
      excluded: [b.id],
      overrides: { tone: "只写实践观察" },
    },
  });
  await page.goto("/compose?project=" + id);
  const context = page.locator('details[aria-label="本次写作上下文"]');
  await context.getByText("本次将发送的画像与素材", { exact: true }).click();
  await expect(context).toContainText("本次允许使用的创作笔记");
  await expect(context).toContainText("已排除 1 项素材正文");
  await expect(context).toContainText("只写实践观察");
  await request.put(path, {
    data: {
      expectedRevision: 1,
      refs: [{ kind: "material", id: a.id }],
      overrides: { tone: "后续经确认才使用的新语气" },
    },
  });
  const before = (await (await request.get("/api/creator/usage")).json()).recent
    .length;
  await page
    .getByRole("button", { name: "根据这个选题撰写完整初稿", exact: true })
    .click();
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  await expect(page.locator(".writing-notice")).toContainText(
    "写作上下文已变化"
  );
  expect(
    (await (await request.get("/api/creator/usage")).json()).recent.length
  ).toBe(before);
  await context
    .getByRole("button", { name: "刷新本次上下文", exact: true })
    .click();
  await expect(context).toContainText("后续经确认才使用的新语气");
  await expect(
    page.getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
  ).not.toBeChecked();
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  const historical = page.locator('details[aria-label="生成时使用的上下文"]');
  await historical.getByText("生成时使用的上下文", { exact: true }).click();
  await expect(historical).toContainText("后续经确认才使用的新语气");
  await expect(historical).toContainText("本次允许使用的创作笔记");
  expect((await stored(request, doc)).markdown).toBe("");
});

test("multiple suggestions from one request can be accepted individually without invalidating siblings", async ({
  page,
  request,
}) => {
  const doc = await create(request, "多处独立调整的文章");
  await page.goto("/compose?project=" + doc.projectId);
  await cm(page).fill(
    "保留开头。\n\n修改第一处。\n\n保留过渡。\n\n修改第二处。\n\n保留结尾。"
  );
  await expect
    .poll(async () => (await stored(request, doc)).markdown)
    .toContain("修改第二处。");
  await page
    .getByLabel("与助手讨论或提出写作要求")
    .fill("请做多处独立调整，其他段落保持不变");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  const suggestions = page.locator(".writing-suggestions");
  await expect(
    suggestions.getByRole("button", { name: "接受修改", exact: true })
  ).toHaveCount(2);
  await suggestions
    .getByRole("button", { name: "接受修改", exact: true })
    .first()
    .click();
  await expect(
    suggestions.getByRole("button", { name: "接受修改", exact: true })
  ).toHaveCount(1);
  await expect(
    suggestions.getByRole("button", { name: "接受修改", exact: true })
  ).toBeEnabled();
  await suggestions
    .getByRole("button", { name: "接受修改", exact: true })
    .click();
  const final = await stored(request, doc);
  expect(final.markdown).toContain("第一处经过审阅的新表达。");
  expect(final.markdown).toContain("第二处经过审阅的新表达。");
  expect(final.markdown).toContain("保留过渡。");
  expect(final.markdown).toContain("保留结尾。");
});

test("real SSE preview remains outside the article and an interrupted request resumes only after renewed consent", async ({
  page,
  request,
}) => {
  const doc = await create(request, "流式中断后恢复的文章");
  await page.goto("/compose?project=" + doc.projectId);
  await page
    .getByLabel("与助手讨论或提出写作要求")
    .fill("请做一次中断一次流式演示");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  await expect(page.locator(".writing-live-generation")).toContainText(
    "流式预览"
  );
  expect((await stored(request, doc)).markdown).toBe("");
  await expect(page.locator(".writing-notice")).toContainText("未完成");
  await page.getByText(/生成记录与恢复（1）/).click();
  await page
    .getByRole("button", { name: "恢复请求到助手", exact: true })
    .click();
  await expect(
    page.getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "生成写作建议", exact: true })
  ).toBeDisabled();
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  await expect(page.locator(".writing-inline-suggestion")).toBeVisible();
  expect((await stored(request, doc)).markdown).toBe("");
  const records = (
    await (
      await request.get(
        `/api/writing/projects/${doc.projectId}/master/generations`
      )
    ).json()
  ).generations;
  expect(records.map((g) => g.status)).toEqual(["completed", "failed"]);
  await page
    .locator(".writing-inline-suggestion")
    .getByRole("button", { name: "接受修改", exact: true })
    .click();
  await expect(cm(page)).toContainText("完整的流式合成初稿🌲");
});

test("stopping a live generation retains an interrupted record without saving a draft or retrying", async ({
  page,
  request,
}) => {
  const doc = await create(request, "明确停止流式生成的文章");
  await page.goto("/compose?project=" + doc.projectId);
  await page
    .getByLabel("与助手讨论或提出写作要求")
    .fill("开始一个可以停止流式生成的请求");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  await expect(page.locator(".writing-live-generation")).toContainText(
    "流式预览"
  );
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.locator(".writing-live-generation")).toHaveCount(0);
  expect((await stored(request, doc)).markdown).toBe("");
  const records = (
    await (
      await request.get(
        `/api/writing/projects/${doc.projectId}/master/generations`
      )
    ).json()
  ).generations;
  expect(records).toHaveLength(1);
  expect(records[0].status).toBe("interrupted");
  expect(records[0].partial).toContain("流式预览");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  await expect(page.locator(".writing-live-generation")).toContainText(
    "流式预览"
  );
  const next = await create(request, "生成期间切换的新文章");
  await page.evaluate(
    (project) => history.pushState({}, "", "/compose?project=" + project),
    next.projectId
  );
  await expect(
    page.getByRole("heading", {
      name: "生成期间切换的新文章",
      exact: true,
      level: 1,
    })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "根据这个选题撰写完整初稿", exact: true })
    .click();
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await expect(
    page.getByRole("button", { name: "生成写作建议", exact: true })
  ).toBeEnabled();
});
