import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function listen(server) {
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
}
const test = base.extend({
  creatorOrigin: [
    async ({}, use) => {
      const failedSeries = new Set();
      const model = createServer(async (req, res) => {
        let raw = "";
        for await (const c of req) raw += c;
        const body = JSON.parse(raw),
          input = JSON.parse(body.messages.at(-1).content);
        let result;
        if (
          input.series?.goal === "模拟准备失败一次" &&
          !failedSeries.has(input.topic.id)
        ) {
          failedSeries.add(input.topic.id);
          res.writeHead(503, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "Synthetic one-time provider failure" },
            })
          );
          return;
        }
        if (input.mode)
          result = {
            replacement:
              input.mode === "discuss"
                ? ""
                : "# 一次具体的创作实践\n\n先明确读者的问题，再通过自己的实践经历提出方法。\n\n最后收集反馈，记录下一篇的改进方向。",
            reason: "合成模型返回的测试初稿，请作者审阅。",
          };
        else if (input.message)
          result = {
            reply: "建议围绕素材中已经记录的实践过程，给读者一个可执行的步骤。",
            brief: {
              title: "从实践中建立写作流程",
              angle: "作者的实践经验",
              audience: "开始写作的独立创作者",
              outline: "## 明确读者\n\n## 实践步骤\n\n## 效果复盘",
            },
          };
        else if (input.page)
          result = {
            pages: [
              {
                title: "把方法讲具体",
                body: "先描述你实际做过的一步。",
                layout: "steps",
              },
            ],
          };
        else if (input.allowedAssets)
          result = {
            title: "我的创作流程",
            caption: "三个来自实践的写作方法，供你参考。",
            tags: ["写作实践"],
            pages: [
              {
                title: "先明确读者",
                body: "找到一个具体问题，再开始表达。",
                layout: "editorial",
              },
              {
                title: "写出自己的经历",
                body: "记录实践步骤，把观察和结论分开。",
                layout: "steps",
              },
              {
                title: "每次发布后复盘",
                body: "观察反馈，积累下一篇的改进方向。",
                layout: "quote",
              },
            ],
          };
        else if (Array.isArray(input.series) && Array.isArray(input.materials))
          result = {
            topics: [
              {
                title: "从授权素材发现具体的创作方向",
                angle: "把自己的实践转成可执行步骤",
                audience: "独立作者",
                reason: "仅参考本次作者选择的素材",
                problem: "怎样把经验写清楚？",
                keyPoints: "先记录过程，再解释方法",
                evidenceGaps: "仍需核实具体效果",
                platforms: ["wechat", "zhihu"],
                materialIds: input.materials.map((m) => m.id),
              },
            ],
          };
        else if (input.articles)
          result = {
            tone: "自然直接",
            structure: "先例子后方法",
            avoid: "夸张的保证",
            length: "千字左右",
          };
        else
          result = {
            outline: "## 具体问题\n\n## 实践过程",
            angle: "以自己的实践为切口",
            audience: "独立创作者",
          };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(result) },
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
      const root = mkdtempSync(join(tmpdir(), "studio-creator-browser-")),
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
          CONTENT_AI_MODEL: "synthetic-model",
          CONTENT_AI_API_KEY: "synthetic-model-key",
          CONTENT_IMAGE_API_KEY: "",
          CONTENT_IMAGE_OPENAI_API_KEY: "",
          CONTENT_IMAGE_GEMINI_API_KEY: "",
          CONTENT_IMAGE_QWEN_API_KEY: "",
          CONTENT_ILLUSTRATION_PLANNER_API_KEY: "",
          CONTENT_IMAGE_REVIEW_API_KEY: "",
        };
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
        if (!ready) throw Error("Creator server did not start " + logs);
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
  baseURL: async ({ creatorOrigin }, use) => use(creatorOrigin),
});
async function signup(page, email = "creator@example.test") {
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

test("author moves from profile and topic discussion through MD writing, XHS PNG export and assets", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page);
  await page.getByRole("link", { name: "偏好与连接" }).click();
  await page.getByLabel("创作领域", { exact: true }).fill("独立创作与写作实践");
  await page
    .getByLabel("希望写给谁", { exact: true })
    .fill("刚开始写作的创作者");
  await page.getByRole("button", { name: "保存作者画像", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("已保存");
  await page.getByRole("link", { name: "素材库" }).click();
  // V2 素材库：参考笔记经由「导入素材」弹窗（真实 POST /api/creator/materials）
  await page.getByRole("button", { name: "导入素材" }).click();
  await page.getByLabel("素材标题或网址").fill("我的第一轮写作实践");
  await page
    .getByLabel("内容或摘录", { exact: true })
    .fill(
      "先写下问题，再采访一位真实读者。反馈应作为观察记录，不能直接推断普遍结论。"
    );
  await page.getByRole("button", { name: "保存素材" }).click();
  await expect(page.getByRole("status").last()).toContainText("参考笔记已保存");
  await page.getByRole("link", { name: "选题发现" }).click();
  await page.getByLabel("新选题标题").fill("新作者怎样建立创作习惯");
  await page.getByRole("button", { name: "记录选题", exact: true }).click();
  // V2 选题页：参考素材选择位于「完整简报与版本历史」折叠区内
  await page.getByText("完整简报与版本历史", { exact: true }).click();
  await page.getByText("选择参考素材（0）", { exact: true }).click();
  await page.getByLabel("我的第一轮写作实践 · 素材").check();
  await page.getByRole("button", { name: "保存简报", exact: true }).click();
  // 讨论位于「与选题助手讨论」折叠区内
  await page.getByText("与选题助手讨论", { exact: true }).click();
  await page
    .getByLabel("选题讨论", { exact: true })
    .fill("请结合我的实践，帮我确定具体的写作角度和大纲");
  await page.getByLabel("允许本次向模型发送选题、所选素材与讨论内容").check();
  await page.getByRole("button", { name: "发送讨论", exact: true }).click();
  await expect(page.locator(".cv2-conversation > div")).toHaveCount(2);
  await page.getByRole("button", { name: "采纳这份简报", exact: true }).click();
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(
    "从实践中建立写作流程"
  );
  await page
    .getByRole("button", { name: "围绕这个选题开始写作", exact: true })
    .click();
  await expect(page).toHaveURL(/compose\?project=ep_/);
  await expect(
    page.getByRole("heading", {
      name: "从实践中建立写作流程",
      exact: true,
      level: 1,
    })
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get("project");
  expect(id).toMatch(/^ep_/);
  await expect(page.getByLabel("当前文章")).toHaveValue(id);
  await page
    .getByRole("button", { name: "根据这个选题撰写完整初稿", exact: true })
    .click();
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  await expect(page.locator(".writing-inline-suggestion")).toBeVisible();
  await page
    .locator(".writing-inline-suggestion")
    .getByRole("button", { name: "接受修改" })
    .click();
  await expect(page.getByLabel("文章 Markdown 正文")).toContainText(
    "一次具体的创作实践"
  );
  await page.getByRole("tab", { name: "小红书", exact: true }).click();
  await expect(page.getByLabel("小红书图文工作区")).toBeVisible();
  await page
    .getByLabel("允许本次向模型发送文章或图片页内容，费用计入请求额度")
    .check();
  await page
    .getByRole("button", { name: "AI 规划图文方案", exact: true })
    .click();
  await expect(page.locator(".xhs-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "确认文案，保存为小红书稿", exact: true })
    .click();
  await page
    .getByRole("button", { name: "生成整组成品图片", exact: true })
    .click();
  await expect(page.locator(".xhs-card img")).toHaveCount(3);
  const unchanged = await page
    .locator(".xhs-card img")
    .first()
    .getAttribute("src");
  await page
    .getByLabel("第 2 页修改要求", { exact: true })
    .fill("只修改第二页，写得更具体");
  await page
    .getByLabel("允许本次向模型发送文章或图片页内容，费用计入请求额度")
    .check();
  await page
    .locator(".xhs-card")
    .nth(1)
    .getByRole("button", { name: "只修改这一页" })
    .click();
  await expect(page.getByRole("status").last()).toContainText(
    "指定页已生成新版本"
  );
  expect(await page.locator(".xhs-card img").first().getAttribute("src")).toBe(
    unchanged
  );
  await page.getByRole("button", { name: "发布准备", exact: true }).click();
  const dialog = page.locator('section[aria-label="平台发布准备"]');
  for (const label of [
    "事实与引用已核对",
    "隐私信息已核对",
    "文字与图片使用权已核对",
    "已在目标平台核对排版",
  ])
    await dialog.getByLabel(label, { exact: true }).check();
  await dialog
    .getByRole("button", { name: "保存当前版本检查", exact: true })
    .click();
  await expect(page.getByRole("status").last()).toContainText("四项检查已保存");
  await page.getByRole("button", { name: "返回图文创作", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载图片与文案包", exact: true })
    .click();
  const download = await downloaded,
    files = unzipSync(readFileSync(await download.path()));
  expect(Object.keys(files).filter((n) => n.endsWith(".png")).length).toBe(3);
  expect(
    JSON.parse(strFromU8(files["manifest.json"])).publicationVerified
  ).toBe(false);
  // V2 统一侧栏把 /library 入口命名为「素材库」（旧创作页内导航的
  // 「资产库」链接已被统一 Shell 取代）；类型筛选为设计 chip，打开卡片
  // 进入真实详情面板查看交付记录。
  await page.getByRole("link", { name: "素材库", exact: true }).click();
  await page.getByRole("button", { name: "文章", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "从实践中建立写作流程", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "查看素材详情：从实践中建立写作流程" })
    .click();
  await expect(page.getByText(/已导出.*本地导出/)).toBeVisible();
  expect(errors).toEqual([]);
  const d = await (
    await page.request.get("/api/writing/projects/" + id + "/master")
  ).json();
  expect(d.markdown).toContain("一次具体的创作实践");
});

test("series prepares while page is closed and another author cannot see or open private resources", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL }),
    page = await context.newPage();
  await signup(page, "series-owner@example.test");
  await page.getByRole("link", { name: "选题发现" }).click();
  await page.getByRole("button", { name: "内容系列", exact: true }).click();
  await page.getByLabel("系列名称", { exact: true }).fill("独立创作方法系列");
  await page
    .getByLabel("这个系列想帮助读者完成什么")
    .fill("建立持续、可靠的写作流程");
  await page.getByRole("button", { name: "创建系列计划" }).click();
  await expect(page.getByRole("status").last()).toContainText("系列已创建");
  const owner = context.request;
  const s = (await (await owner.get("/api/creator/series")).json()).series[0];
  await page.close();
  await expect
    .poll(
      async () =>
        (
          await (await owner.get("/api/creator/series/" + s.id)).json()
        ).entries[0].status,
      { timeout: 20000 }
    )
    .toBe("ready");
  const topic = (await (await owner.get("/api/creator/series/" + s.id)).json())
    .entries[0].topic;
  const doc = await (
    await owner.post("/api/creator/topics/" + topic.id + "/start", { data: {} })
  ).json();
  const another = await browser.newContext({ baseURL }),
    other = await another.newPage();
  await signup(other, "another-author@example.test");
  expect(
    (await another.request.get("/api/creator/topics/" + topic.id)).status()
  ).toBe(404);
  expect(
    (
      await another.request.get(
        "/api/writing/projects/" + doc.projectId + "/master"
      )
    ).status()
  ).toBe(404);
  const library = await (
    await another.request.get("/api/creator/library")
  ).json();
  expect(library.assets).toEqual([]);
  await another.close();
  await context.close();
});

test("creator reviews style evidence and configures encrypted BYOK connections through settings", async ({
  page,
}) => {
  await signup(page, "settings-author@example.test");
  const created = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "风格学习的合成文章" },
    })
  ).json();
  await page.request.put(
    "/api/writing/projects/" + created.projectId + "/master",
    {
      data: {
        expectedRevision: created.revision,
        markdown: "从一个具体例子开始，讲清楚自己的写作方法。",
      },
    }
  );
  await page.getByRole("link", { name: "偏好与连接" }).click();
  await page.getByLabel("风格学习的合成文章", { exact: true }).check();
  await page
    .getByLabel("允许本次向模型发送所选文章及已接受 / 拒绝的写作建议")
    .check();
  await page.getByRole("button", { name: "提炼风格建议" }).click();
  await expect(page.getByText("依据：风格学习的合成文章 v3")).toBeVisible();
  await page.getByRole("button", { name: "采纳到画像" }).click();
  await expect(page.getByLabel("表达语气", { exact: true })).toHaveValue(
    "自然直接"
  );
  await page.getByText("画像版本与撤销", { exact: true }).click();
  await page
    .getByRole("button", { name: "恢复这个画像版本", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("表达语气", { exact: true })).toHaveValue("");
  // V2 设置页：服务连接与额度同属「模型与费用」分组（设计 settings-grid 四组）
  await page.getByRole("button", { name: "模型与费用", exact: true }).click();
  await page
    .getByRole("combobox", { name: "用途", exact: true })
    .selectOption("image");
  await page.getByLabel("连接名称", { exact: true }).fill("我的图片连接");
  await page
    .getByLabel("API Base URL", { exact: true })
    .fill("https://image.example/v1/");
  await page
    .getByLabel("默认模型", { exact: true })
    .fill("synthetic-image-model");
  await page
    .getByLabel("API Key", { exact: true })
    .fill("synthetic-private-key-not-shown");
  await page.getByRole("button", { name: "保存服务连接", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("服务连接已加密保存");
  const config = await (await page.request.get("/api/creator/services")).json();
  expect(config.connections[0].kind).toBe("image");
  expect(JSON.stringify(config)).not.toContain(
    "synthetic-private-key-not-shown"
  );
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByLabel("图片请求上限", { exact: true }).fill("5");
  await page.getByRole("button", { name: "保存额度", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("每日请求上限已更新");
  expect(
    (await (await page.request.get("/api/creator/usage")).json()).limits
      .imageLimit
  ).toBe(5);
});

test("complete briefs, explicit recommendation sources and context conflict recovery work in the browser", async ({
  page,
}) => {
  await signup(page, "followup-brief@example.test");
  const selected = await (
    await page.request.post("/api/creator/materials", {
      data: { title: "授权给本次推荐的实践", body: "作者选择的实践记录" },
    })
  ).json();
  await page.request.post("/api/creator/materials", {
    data: { title: "本次不选择的个人日记", body: "本次不要发送的个人内容" },
  });
  await page.getByRole("link", { name: "选题发现" }).click();
  // V2 选题页：批量推荐整体收进折叠区
  await page.getByText("批量推荐：从素材与模型获取候选", { exact: true }).click();
  await page
    .getByText("选择推荐可使用的私有素材（0）", { exact: true })
    .click();
  await page.getByLabel(/授权给本次推荐的实践/).check();
  await page
    .getByLabel(
      "允许本次发送画像、历史标题、系列、选题反馈和选定素材（计入请求额度）"
    )
    .check();
  await page.getByRole("button", { name: "AI 推荐选题", exact: true }).click();
  await page
    .getByRole("button", { name: "从授权素材发现具体的创作方向", exact: true })
    .click();
  await expect(page.getByLabel("读者问题", { exact: true })).toHaveValue(
    "怎样把经验写清楚？"
  );
  await page
    .getByLabel("读者问题", { exact: true })
    .fill("作者如何建立可以复用的创作流程？");
  // 核心观点/平台位于「完整简报与版本历史」折叠区内
  await page.getByText("完整简报与版本历史", { exact: true }).click();
  await page
    .getByLabel("核心观点与写作主张", { exact: true })
    .fill("先有自己的实践，再形成有证据的表达");
  await page
    .getByLabel("证据缺口", { exact: true })
    .fill("还需要验证长期效果，避免过度归因");
  await page.getByLabel("小红书", { exact: true }).check();
  await page.getByRole("button", { name: "保存简报", exact: true }).click();
  // 应用层已保证「保存期间新输入的原因不被回写清空」（save 只重置随请求提交的值）。
  // 此处保留快速失败的重试环，防御残余交错；内层断言必须短超时，否则 toPass
  // 不会真正重试（CI 上曾因 15s 内层等待吃满 5s 窗口而假性超时）。
  await expect(async () => {
    await page
      .getByLabel("选题反馈原因", { exact: true })
      .fill("这个问题来自自己的真实实践，值得继续写");
    await expect(page.getByLabel("选题反馈原因", { exact: true })).toHaveValue(
      /真实实践/,
      { timeout: 300 }
    );
  }).toPass({ timeout: 5000 });
  // 保存动作在后台 load() 完成前 busy 仍为 true，过早点击收藏会被静默忽略。
  await expect(
    page.getByRole("button", { name: "保存简报", exact: true })
  ).toBeEnabled();
  await page.getByRole("button", { name: "收藏选题", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true })
  ).toBeVisible();
  let topic = (await (await page.request.get("/api/creator/topics")).json())
    .topics[0];
  expect(topic.refs).toEqual([{ kind: "material", id: selected.id }]);
  expect(topic.platforms).toEqual(["wechat", "zhihu", "xiaohongshu"]);
  expect(topic.feedback.at(-1).reason).toContain("真实实践");
  await page.getByRole("button", { name: "查看简报版本", exact: true }).click();
  await expect(
    page.getByText("简报历史（恢复会创建新版本）", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "恢复简报为新版本", exact: true }).first()
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "围绕这个选题开始写作", exact: true })
    .click();
  await expect(page).toHaveURL(/compose\?project=ep_/);
  const projectId = new URL(page.url()).searchParams.get("project");
  // 作者设定移到「研究」阶段焦点视图（Easel 式流程）
  await page.getByRole("button", { name: "切换到研究阶段" }).click();
  await expect(
    page.locator('section[aria-label="作者设定与参考资料"]')
  ).toContainText("作者如何建立可以复用的创作流程？");
  await page.getByText("本篇与平台偏好", { exact: true }).click();
  await page
    .getByLabel("表达语气（本篇）", { exact: true })
    .fill("本地尚未保存的表达偏好");
  const contextPath = "/api/creator/projects/" + projectId + "/context";
  const current = await (await page.request.get(contextPath)).json();
  expect(
    (
      await page.request.put(contextPath, {
        data: {
          expectedRevision: current.revision,
          refs: current.refs,
          overrides: { tone: "另一个页面保存的语气" },
        },
      })
    ).status()
  ).toBe(200);
  await page
    .getByRole("button", { name: "保存创作上下文", exact: true })
    .click();
  await expect(
    page.getByText("另一个页面已更新上下文。本地选择仍在这里。", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByLabel("表达语气（本篇）", { exact: true })
  ).toHaveValue("本地尚未保存的表达偏好");
  await page
    .getByRole("button", { name: "重新载入最新上下文", exact: true })
    .click();
  await expect(
    page.getByLabel("表达语气（本篇）", { exact: true })
  ).toHaveValue("另一个页面保存的语气");
});

test("authors refine learned style before applying it and retain the original evidence", async ({
  page,
}) => {
  await signup(page, "followup-style@example.test");
  const d = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "用于修订风格建议的文章" },
    })
  ).json();
  await page.request.put("/api/writing/projects/" + d.projectId + "/master", {
    data: {
      expectedRevision: d.revision,
      markdown: "从一次具体实践开始，写出作者自己的方法和观察。",
    },
  });
  await page.getByRole("link", { name: "偏好与连接" }).click();
  await page.getByLabel("用于修订风格建议的文章", { exact: true }).check();
  await page
    .getByLabel("允许本次向模型发送所选文章及已接受 / 拒绝的写作建议")
    .check();
  await page.getByRole("button", { name: "提炼风格建议", exact: true }).click();
  await page.getByRole("button", { name: "修订后采纳", exact: true }).click();
  await page
    .getByLabel("修订建议：表达语气", { exact: true })
    .fill("简洁、克制，保留个人经验的边界");
  await page
    .getByRole("button", { name: "确认修订并采纳", exact: true })
    .click();
  await expect(page.getByLabel("表达语气", { exact: true })).toHaveValue(
    "简洁、克制，保留个人经验的边界"
  );
  await expect(
    page.getByText("依据：用于修订风格建议的文章 v3", { exact: true })
  ).toBeVisible();
  const suggestion = (
    await (await page.request.get("/api/creator/style-suggestions")).json()
  ).suggestions[0];
  expect(suggestion.data.tone).toBe("自然直接");
  expect(suggestion.decisions[0].data.accepted.tone).toContain("克制");
  await page.getByRole("button", { name: "移出建议列表", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "移出建议列表", exact: true })
  ).toHaveCount(0);
  await expect(page.getByLabel("表达语气", { exact: true })).toHaveValue(
    "简洁、克制，保留个人经验的边界"
  );
});

test("blocked series tasks require author review and cost consent before a new attempt", async ({
  page,
}) => {
  await signup(page, "followup-retry@example.test");
  await page.getByRole("link", { name: "选题发现" }).click();
  await page.getByRole("button", { name: "内容系列", exact: true }).click();
  await page.getByLabel("系列名称", { exact: true }).fill("需要作者核对的系列");
  await page.getByLabel("这个系列想帮助读者完成什么").fill("模拟准备失败一次");
  await page
    .getByLabel(
      "授权这个系列按计划调用写作模型准备大纲，计入每日额度。可随时暂停。"
    )
    .check();
  await page.getByRole("button", { name: "创建系列计划", exact: true }).click();
  const series = (await (await page.request.get("/api/creator/series")).json())
    .series[0];
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get("/api/creator/jobs")).json()
        ).jobs[0]?.status,
      { timeout: 20000 }
    )
    .toBe("blocked");
  await page.getByRole("button", { name: "刷新任务状态", exact: true }).click();
  await page.getByText("核对结果并处理任务", { exact: true }).click();
  await page.getByLabel("任务处理方式", { exact: true }).selectOption("retry");
  await page
    .getByLabel("任务核对依据", { exact: true })
    .fill("已检查没有生成完整大纲，确认需要重新发起请求");
  await expect(
    page.getByRole("button", { name: "保存任务处理", exact: true })
  ).toBeDisabled();
  await page
    .getByLabel("已核对之前的结果，授权本次新的模型请求并计入额度")
    .check();
  await page.getByRole("button", { name: "保存任务处理", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText(
    "已核对原任务并建立新的执行尝试"
  );
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get("/api/creator/series/" + series.id)
          ).json()
        ).entries[0].status,
      { timeout: 20000 }
    )
    .toBe("ready");
  const jobs = (await (await page.request.get("/api/creator/jobs")).json())
    .jobs;
  expect(jobs).toHaveLength(2);
  expect(jobs.find((j) => j.status === "reconciled").review.note).toContain(
    "确认需要"
  );
  expect(jobs.find((j) => j.status === "completed")).toBeTruthy();
  await page.getByRole("button", { name: "刷新任务状态", exact: true }).click();
  await expect(
    page.getByText(/核对依据：已检查没有生成完整大纲/)
  ).toBeVisible();
});

test("author configures a publication account style and explicitly selects it for future writing", async ({
  page,
}) => {
  await signup(page, "remaining-account@example.test");
  await page.getByRole("link", { name: "偏好与连接" }).click();
  await page.getByRole("button", { name: "发布账号", exact: true }).click();
  await page.getByLabel("发布平台", { exact: true }).selectOption("zhihu");
  await page
    .getByLabel("账号名称", { exact: true })
    .fill("面向开发者的知乎账号");
  await page.getByRole("button", { name: "保存发布账号", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("平台账号已保存");
  await page.getByText("账号独立定位与风格 · v0", { exact: true }).click();
  await page
    .getByLabel("账号 面向开发者的知乎账号 的账号定位", { exact: true })
    .fill("面向独立开发者，解释实践背后的原因");
  await page
    .getByLabel("账号 面向开发者的知乎账号 的表达语气", { exact: true })
    .fill("严谨、自然，区分观察与结论");
  await page
    .getByRole("button", { name: "保存账号定位与风格", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("账号定位已保存");
  const account = (
      await (await page.request.get("/api/creator/platforms")).json()
    ).accounts[0],
    doc = await (
      await page.request.post("/api/writing/projects", {
        data: { title: "采用账号独立定位的文章" },
      })
    ).json();
  const draft = await (
    await page.request.get(`/api/writing/projects/${doc.projectId}/zhihu`)
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/zhihu`, {
    data: {
      expectedRevision: draft.revision,
      markdown: "作者已经写好的知乎正文。",
      sourceMasterRevision: doc.revision,
    },
  });
  await page.goto("/compose?project=" + doc.projectId + "&channel=zhihu");
  // 作者设定在「研究」阶段；设定完成后回写作阶段核对发送上下文与正文
  await page.getByRole("button", { name: "切换到研究阶段" }).click();
  await page.getByText("本篇与平台偏好", { exact: true }).click();
  await page
    .getByLabel("本篇写作定位账号", { exact: true })
    .selectOption(account.id);
  await page
    .getByRole("button", { name: "保存创作上下文", exact: true })
    .click();
  await page.getByRole("button", { name: "切换到写作阶段" }).click();
  const context = page.locator('details[aria-label="本次写作上下文"]');
  await context.getByText("本次将发送的画像与素材", { exact: true }).click();
  await expect(context).toContainText("面向开发者的知乎账号");
  await expect(context).toContainText("严谨、自然，区分观察与结论");
  await expect(page.getByLabel("文章 Markdown 正文")).toContainText(
    "作者已经写好的知乎正文。"
  );
});

test("source removal previews impact, revokes learned style and keeps article history", async ({
  page,
}) => {
  await signup(page, "remaining-removal@example.test");
  const doc = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "与被移除素材关联的文章" },
    })
  ).json();
  await page.request.put(`/api/writing/projects/${doc.projectId}/master`, {
    data: {
      expectedRevision: doc.revision,
      markdown: "作者自己记录的实践观察与方法。",
    },
  });
  const material = await (
    await page.request.post("/api/creator/materials", {
      data: {
        title: "准备移除的参考笔记",
        body: "这段参考资料在确认移除后不再用于画像推断。",
      },
    })
  ).json();
  await page.request.put(
    "/api/creator/projects/" + doc.projectId + "/context",
    {
      data: {
        expectedRevision: 0,
        refs: [{ kind: "material", id: material.id }],
      },
    }
  );
  const suggestion = await (
    await page.request.post("/api/creator/style-suggestions", {
      data: { projectIds: [doc.projectId], allowExternalAI: true },
    })
  ).json();
  await page.request.post("/api/creator/style-suggestions/" + suggestion.id, {
    data: { action: "accept", expectedRevision: 1 },
  });
  await page.getByRole("link", { name: "素材库" }).click();
  await page.getByLabel("搜索素材或作品").fill(material.title);
  await expect(
    page.getByRole("heading", { name: material.title, exact: true })
  ).toBeVisible();
  // V2 素材库：卡片打开真实详情，移除影响流在详情内渐进披露
  await page
    .getByRole("button", { name: `查看素材详情：${material.title}` })
    .click();
  await page.getByText("移除素材并查看画像影响").click();
  await page.getByRole("button", { name: "查看影响范围", exact: true }).click();
  await expect(page.getByText(/涉及 1 篇文章，1 条风格建议/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "确认移除来源并撤销相关推断",
      exact: true,
    })
  ).toBeDisabled();
  await page.getByLabel("我已核对影响范围，并理解历史与备份保留").check();
  await page
    .getByRole("button", { name: "确认移除来源并撤销相关推断", exact: true })
    .click();
  await expect(page.getByRole("status").last()).toContainText("来源已移除");
  expect(
    (await (await page.request.get("/api/creator/profile")).json()).tone
  ).toBe("");
  expect(
    (await (await page.request.get("/api/creator/style-suggestions")).json())
      .suggestions[0].status
  ).toBe("revoked");
  expect(
    (
      await (
        await page.request.get(`/api/writing/projects/${doc.projectId}/master`)
      ).json()
    ).markdown
  ).toContain("作者自己记录的实践观察");
});
