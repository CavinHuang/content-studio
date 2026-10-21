import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 topic discovery (/topics) e2e — real routes, real SQLite
// domain services, no fixtures and no demo data: an isolated worker-
// scoped production server (same pattern as e2e/creator-v2-hotspots.spec.mjs)
// runs with multiuser sessions and NO model configured. Coverage per the
// page scope: design layout (step line / banner / tabbar / evidence grid),
// the editorial judgment card (读者问题/写作角度/来源依据/证据缺口) with
// real PUT + expectedRevision conflict protection, 开始创作 → real project
// creation and /compose navigation (idempotent reopen), batch recommend
// collapsed area with the AI service precondition (disabled without a
// configured model) and consent, provenance tabs (为我推荐/全部线索/已收藏),
// real status chips, honest empty/error states, and the 390×844 mobile
// layout without horizontal overflow. The demo theme chips (全部主题/
// AI 产品/独立开发/效率工具) have no backend category field and must NOT
// appear (registered design deviation).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function listen(server) {
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
}

const test = base.extend({
  topicsEnv: [
    async ({}, use) => {
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-creator-topics-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "topics.sqlite"),
        CONTENT_STUDIO_DEPLOY_MODE: "",
        CONTENT_STUDIO_ALLOW_REMOTE: "0",
        CONTENT_STUDIO_WORKER_DISABLED: "1",
        ENABLE_SCENARIO: "0",
        // 无模型配置：AI 推荐必须因「服务配置前置」不可用，而不是假装成功
        CONTENT_AI_API_KEY: "",
        CONTENT_AI_BASE_URL: "",
        CONTENT_AI_MODEL: "",
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
        if (!ready) throw Error("Topics server did not start " + logs);
        await use({ origin, root });
      } finally {
        const done = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await Promise.race([done, sleep(5000)]);
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await done;
        }
        rmSync(root, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ topicsEnv }, use) => use(topicsEnv.origin),
});

async function signup(page, email) {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成选题作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

// Real data through the same API the page uses: one material as the
// 来源依据 and one topic with all four judgment fields filled.
async function seedTopic(page, { title, withRefs = true } = {}) {
  const t = title || "桌面 AI Agent 的真正价值，可能不在“替你点鼠标”";
  let ref = null;
  if (withRefs) {
    const m = await (
      await page.request.post("/api/creator/materials", {
        data: {
          title: "开源 Agent 可靠性讨论的实践记录",
          body: "来自公开讨论的观察记录，重要事实仍需核对原文。",
        },
      })
    ).json();
    ref = { kind: "material", id: m.id };
  }
  const topic = await (
    await page.request.post("/api/creator/topics", {
      data: {
        title: t,
        problem: "下一代个人助手应该用什么标准判断是否可靠？",
        angle: "从「演示很惊艳」转向「日常可靠可用」的产品判断",
        evidenceGaps: "需要补充真实使用案例；不能以单次演示推断市场表现",
        // 真实管线（推荐/热点转入）都会写入 reason；带 reason 的候选才
        // 属于「为我推荐」provenance（src/topics-discovery.mjs）。
        reason: "来自素材库的合成候选",
        ...(ref ? { refs: [ref] } : {}),
      },
    })
  ).json();
  return topic;
}

async function openTopics(page) {
  await page.goto("/topics");
  await expect(
    page.getByRole("heading", { name: "选题发现", exact: true })
  ).toBeVisible();
}

// Second worker fixture for the one interaction that genuinely needs a
// configured writing model (讨论消息的「查看建议简报」候选)：a loopback
// synthetic OpenAI-compatible server, same pattern as e2e/creator-v1.spec.mjs.
// It never reaches a paid/external service and only answers the discussion
// payload with a fixed synthetic brief. The default `test` fixture above
// stays model-less (AI 推荐必须保持「服务配置前置」不可用)。
const testAI = base.extend({
  topicsAIEnv: [
    async ({}, use) => {
      const model = createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          let result;
          try {
            const body = JSON.parse(raw || "{}");
            const input = JSON.parse(body.messages.at(-1).content);
            result = input.message
              ? {
                  reply:
                    "建议从你自己的实践出发：先给出读者能照做的步骤，再说明为什么可靠。",
                  brief: {
                    title: "从实践中建立写作流程",
                    angle: "把个人实践整理成可执行的步骤",
                    audience: "刚开始公开写作的作者",
                    outline: "## 明确读者\n\n## 实践步骤\n\n## 效果复盘",
                  },
                }
              : { outline: "## 合成大纲", angle: "合成角度", audience: "合成读者" };
          } catch {
            result = { reply: "合成回复" };
          }
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              choices: [
                { finish_reason: "stop", message: { content: JSON.stringify(result) } },
              ],
              usage: { total_tokens: 100 },
            })
          );
        });
      });
      const mp = await listen(model);
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-creator-topics-ai-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "topics-ai.sqlite"),
        CONTENT_STUDIO_DEPLOY_MODE: "",
        CONTENT_STUDIO_ALLOW_REMOTE: "0",
        CONTENT_STUDIO_WORKER_DISABLED: "1",
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
        if (!ready) throw Error("Topics AI server did not start " + logs);
        await use({ origin, root });
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
  baseURL: async ({ topicsAIEnv }, use) => use(topicsAIEnv.origin),
});

test("桌面 1440×900：设计版式齐全，判断卡呈现四个真实字段与来源依据", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "topics-desktop@example.test");
  const topic = await seedTopic(page);
  await openTopics(page);

  // 内容生产主线步骤条（02 选题高亮）+ 从线索到选题 banner（design :172/:175）
  await expect(page.getByText("内容生产主线", { exact: true })).toBeVisible();
  await expect(page.getByText("02 选题", { exact: true })).toBeVisible();
  await expect(
    page.getByText("现在最需要决定：值不值得写？", { exact: true })
  ).toBeVisible();
  // tabbar 三项 + 真实状态 chips；设计的演示主题分类无后端字段，不得出现
  for (const name of ["为我推荐", "全部线索", "已收藏"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部状态", exact: true })).toBeVisible();
  await expect(page.getByText("全部主题", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AI 产品", exact: true })).toHaveCount(0);
  // 底部证据卡（design :175）
  await expect(page.getByText("01 / NEED", { exact: true })).toBeVisible();
  await expect(page.getByText("证据与来源账本", { exact: true })).toBeVisible();

  // 设计构图：进入页面即预选第一条线索、判断面板已填充；选中是纯视图状态，
  // 面板内容仍全部来自真实 API（e2e 断言其值与种子一致）
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(topic.title);

  // 线索卡：真实字段（状态 tag、标题、来源行、判断入口）
  const card = page.locator(".cv2-story-card").first();
  await expect(card).toContainText("待讨论");
  await expect(card).toContainText(topic.title);
  await expect(card).toContainText("1 条参考素材");
  await page.getByRole("button", { name: topic.title, exact: true }).click();

  // 判断卡四字段全部来自真实 API 数据
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(topic.title);
  await expect(page.getByLabel("写作角度", { exact: true })).toHaveValue(
    "从「演示很惊艳」转向「日常可靠可用」的产品判断"
  );
  await expect(page.getByLabel("读者问题", { exact: true })).toHaveValue(
    "下一代个人助手应该用什么标准判断是否可靠？"
  );
  await expect(page.getByLabel("证据缺口", { exact: true })).toHaveValue(
    /需要补充真实使用案例/
  );
  await expect(page.locator(".cv2-refs-list")).toContainText(
    "开源 Agent 可靠性讨论的实践记录"
  );
  // 四字段齐全 → 不显示缺口提醒
  await expect(page.locator(".cv2-judgment-hint")).toHaveCount(0);

  // 批量推荐折叠区：AI 因服务配置前置不可用（无模型配置），本地发现可用
  await page.getByText("批量推荐：从素材与模型获取候选", { exact: true }).click();
  await expect(page.getByText(/未检测到已配置的写作模型/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "AI 推荐选题", exact: true })
  ).toBeDisabled();
  await page.getByRole("button", { name: "从现有素材发现", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/已根据现有素材与信源整理候选/);
  // 本地候选的 provenance = 素材库推荐 → 进入「为我推荐」tab
  await expect(
    page.locator(".cv2-story-card", { hasText: "开源 Agent 可靠性讨论的实践记录" })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("编辑判断卡：保存走真实 PUT；版本落后时诚实报告冲突而不是覆盖", async ({
  page,
}) => {
  await signup(page, "topics-edit@example.test");
  const topic = await seedTopic(page, {
    title: "一个人做产品时，最容易忽略的三种成本",
  });
  await openTopics(page);
  await page.getByRole("button", { name: topic.title, exact: true }).click();
  await page
    .getByLabel("读者问题", { exact: true })
    .fill("独立开发者如何判断一件事值不值得自己做？");
  await page.getByLabel("写作角度", { exact: true }).fill("从试错成本切入，不比较风口大小");
  await page
    .getByLabel("证据缺口", { exact: true })
    .fill("行业趋势属于待验证假设，应避免将个例写成普遍结论");
  await page.getByRole("button", { name: "保存简报", exact: true }).click();
  // 服务端持久化证据：新版本字段 + revision 前进
  const saved = await (await page.request.get("/api/creator/topics/" + topic.id)).json();
  expect(saved.problem).toBe("独立开发者如何判断一件事值不值得自己做？");
  expect(saved.angle).toBe("从试错成本切入，不比较风口大小");
  expect(saved.evidenceGaps).toContain("待验证假设");
  expect(saved.revision).toBe(topic.revision + 1);

  // 另一个页面悄悄推进版本后，本页仍持有旧 revision → 保存必须 409 并给出指引
  await page.request.put("/api/creator/topics/" + topic.id, {
    data: { expectedRevision: saved.revision, angle: "另一个页面保存的角度" },
  });
  await page
    .getByLabel("写作角度", { exact: true })
    .fill("本页未同步的本地修改");
  await page.getByRole("button", { name: "保存简报", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    /选题已变化.*重新载入最新版本/s
  );
  // 服务端内容未被本页覆盖
  const after = await (await page.request.get("/api/creator/topics/" + topic.id)).json();
  expect(after.angle).toBe("另一个页面保存的角度");
});

test("开始创作：真实创建 project 并跳转 /compose；返回后状态为写作中且可继续创作", async ({
  page,
}) => {
  await signup(page, "topics-start@example.test");
  const topic = await seedTopic(page, {
    title: "从收藏到行动：信息工作台究竟该替你完成哪一步？",
  });
  await openTopics(page);
  await page.getByRole("button", { name: topic.title, exact: true }).click();
  await page
    .getByRole("button", { name: "围绕这个选题开始写作", exact: true })
    .click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  const projectId = new URL(page.url()).searchParams.get("project");
  await expect(
    page.getByRole("heading", {
      name: "从收藏到行动：信息工作台究竟该替你完成哪一步？",
      level: 1,
    })
  ).toBeVisible();

  // 服务端事实：同一选题关联同一作品，状态写作中
  const started = await (await page.request.get("/api/creator/topics/" + topic.id)).json();
  expect(started.projectId).toBe(projectId);
  expect(started.status).toBe("writing");

  await openTopics(page);
  const card = page.locator(".cv2-story-card", { hasText: topic.title });
  await expect(card).toContainText("写作中");
  await expect(
    card.getByRole("link", { name: "继续创作", exact: true })
  ).toHaveAttribute("href", "/compose?project=" + projectId);
  // 状态 chips 是真实筛选
  await page.getByRole("button", { name: "写作中", exact: true }).click();
  await expect(page.locator(".cv2-story-card")).toHaveCount(1);
  await page.getByRole("button", { name: "待讨论", exact: true }).click();
  await expect(page.locator(".cv2-tplist-empty")).toBeVisible();
});

test("收藏：判断卡收藏走真实持久化，「已收藏」tab 与卡片收藏态一致", async ({
  page,
}) => {
  await signup(page, "topics-favorite@example.test");
  const topic = await seedTopic(page, { title: "AI 产品的成本该如何向用户解释" });
  await openTopics(page);
  await page.getByRole("button", { name: topic.title, exact: true }).click();
  await page.getByRole("button", { name: "收藏选题", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true })
  ).toBeVisible();
  const saved = await (await page.request.get("/api/creator/topics/" + topic.id)).json();
  expect(saved.favorite).toBe(true);
  // 「已收藏」tab 只显示已收藏线索
  await page.locator(".cv2-tabbar").getByRole("button", { name: "已收藏" }).click();
  await expect(
    page.locator(".cv2-story-card", { hasText: topic.title })
  ).toBeVisible();
  // 设计语义：收藏是星标视图，不把线索从其他 tab 移除；卡片出现收藏态
  await page.locator(".cv2-tabbar").getByRole("button", { name: "为我推荐" }).click();
  const favCard = page.locator(".cv2-story-card", { hasText: topic.title });
  await expect(favCard).toBeVisible();
  await expect(favCard.getByRole("button", { name: "已收藏", exact: true })).toBeVisible();
  await expect(favCard.locator(".cv2-story-title")).toContainText("☆");
});

test("空态与加载失败：无选题时诚实为空；接口故障显示可重试错误态", async ({
  page,
}) => {
  await signup(page, "topics-empty@example.test");
  await openTopics(page);
  await expect(page.getByText("还没有选题线索")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "去热点雷达找线索" })
  ).toBeVisible();

  await page.route("**/api/creator/topics", (route) => route.abort());
  await page.goto("/topics");
  await expect(page.getByText("选题发现加载失败")).toBeVisible({ timeout: 15_000 });
  await page.unroute("**/api/creator/topics");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("还没有选题线索")).toBeVisible({ timeout: 15_000 });
});

test("记录选题：真实 POST 创建并直接打开判断卡，标题可继续编辑保存", async ({
  page,
}) => {
  await signup(page, "topics-record@example.test");
  await openTopics(page);
  await page.getByLabel("新选题标题").fill("新作者怎样建立创作习惯");
  await page.getByRole("button", { name: "记录选题", exact: true }).click();
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(
    "新作者怎样建立创作习惯"
  );
  // 手动记录的 provenance 是「作者提出」→ 不进为我推荐，全部线索可见
  await expect(page.getByText("来源记录：作者提出的选题")).toBeVisible();
  // 四字段为空 → 诚实缺口提醒
  await expect(page.locator(".cv2-judgment-hint")).toContainText(
    /读者问题、写作角度、来源依据、证据缺口/
  );
  const topics = (await (await page.request.get("/api/creator/topics")).json()).topics;
  expect(topics).toHaveLength(1);
  expect(topics[0].status).toBe("draft");
});

test("移动 390×844：单列布局无横向溢出，判断卡在列表下方，底部导航高亮选题", async ({
  page,
}) => {
  await signup(page, "topics-mobile@example.test");
  const topic = await seedTopic(page, { title: "信息工作台的行动闭环" });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTopics(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(0);
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(topic.title);
  await page.getByRole("button", { name: topic.title, exact: true }).click();
  await expect(page.getByLabel("读者问题", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(0);
  // 底部 tab「选题」高亮
  await expect(
    page.locator(".cv2-mobile-tabs a[aria-current='page']")
  ).toHaveText(/选题/);
});

// ---------------------------------------------------------------------------
// 以下为 2026-10-20 交互审计缺口的补齐用例（只新增，不改上方既有用例）。
// 所有选择器均对照 components/TopicsDiscovery.jsx 与 components/CreatorShell.jsx
// 的真实标记/文案；数据一律走页面同款真实 API；持久化交互断言「刷新后仍在」。
// ---------------------------------------------------------------------------

// 真实 API：把选题推进到指定状态（expectedRevision 保护，与页面保存同路径）
async function putStatus(page, topic, status) {
  const r = await page.request.put("/api/creator/topics/" + topic.id, {
    data: { expectedRevision: topic.revision, status },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}

// 真实 API 建系列（POST /api/creator/series）：留空 entries 时服务端会按
// 目标生成 4 篇默认条目（src/creator.mjs createSeries），每条都是真实选题。
async function seedSeries(page, { name, goal, entries } = {}) {
  const r = await page.request.post("/api/creator/series", {
    data: { name, goal, ...(entries ? { entries } : {}) },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}

test("状态筛选 chips：大纲已准备/已确认/暂不创作 三档真实筛选，全部状态复位", async ({
  page,
}) => {
  await signup(page, "topics-chips@example.test");
  // 三档状态全部经真实 PUT 产生（此前只有 写作中/待讨论 两档被真实点过）
  const prepared = await seedTopic(page, {
    title: "状态筛选验证：先备好大纲的选题",
    withRefs: false,
  });
  const confirmed = await seedTopic(page, {
    title: "状态筛选验证：确认动笔的选题",
    withRefs: false,
  });
  const dismissed = await seedTopic(page, {
    title: "状态筛选验证：暂时搁置的选题",
    withRefs: false,
  });
  await putStatus(page, prepared, "prepared");
  await putStatus(page, confirmed, "confirmed");
  await putStatus(page, dismissed, "dismissed");
  await openTopics(page);

  const chips = page.getByRole("group", { name: "按状态筛选" });
  await expect(
    chips.getByRole("button", { name: "全部状态", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cv2-story-card")).toHaveCount(3);

  for (const [chip, topic] of [
    ["大纲已准备", prepared],
    ["已确认", confirmed],
    ["暂不创作", dismissed],
  ]) {
    await chips.getByRole("button", { name: chip, exact: true }).click();
    await expect(
      chips.getByRole("button", { name: chip, exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      chips.getByRole("button", { name: "全部状态", exact: true })
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".cv2-story-card")).toHaveCount(1);
    await expect(
      page.locator(".cv2-story-card", { hasText: topic.title })
    ).toBeVisible();
  }

  // 复位到全部状态：三档全部回来
  await chips.getByRole("button", { name: "全部状态", exact: true }).click();
  await expect(page.locator(".cv2-story-card")).toHaveCount(3);
});

test("「全部线索」tab：按 provenance 真实过滤；记录选题后自动切回全部线索", async ({
  page,
}) => {
  await signup(page, "topics-tabbar@example.test");
  // 有 reason 的候选 → 为我推荐；默认 reason「作者提出的选题」→ 只在全部线索
  await seedTopic(page, { title: "推荐来源：素材转化的候选", withRefs: false });
  await page.request.post("/api/creator/topics", {
    data: { title: "作者随手记下的另一个问题" },
  });
  await openTopics(page);

  const tabbar = page.locator(".cv2-tabbar");
  await expect(
    tabbar.getByRole("button", { name: "为我推荐", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cv2-story-card")).toHaveCount(1);

  // 首次真实点击「全部线索」：两档 provenance 都可见
  await tabbar.getByRole("button", { name: "全部线索", exact: true }).click();
  await expect(
    tabbar.getByRole("button", { name: "全部线索", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cv2-story-card")).toHaveCount(2);
  await expect(
    page.locator(".cv2-story-card", { hasText: "作者随手记下的另一个问题" })
  ).toBeVisible();

  // 切到已收藏（空）后，用记录选题表单新增 → 组件 setTab("all") 自动切 tab
  await tabbar.getByRole("button", { name: "已收藏", exact: true }).click();
  await expect(page.locator(".cv2-tplist-empty")).toBeVisible();
  await page.getByLabel("新选题标题").fill("切 tab 验证：键盘外补记的选题");
  await page.getByRole("button", { name: "记录选题", exact: true }).click();
  await expect(
    page.locator(".cv2-story-card", { hasText: "切 tab 验证：键盘外补记的选题" })
  ).toBeVisible();
  await expect(
    tabbar.getByRole("button", { name: "全部线索", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
});

test("线索卡收藏快捷钮：真实 toggle 持久化；有未保存修改时先警告不落库", async ({
  page,
}) => {
  await signup(page, "topics-cardfav@example.test");
  const topic = await seedTopic(page, {
    title: "卡片收藏验证：可执行承诺的边界",
    withRefs: false,
  });
  await openTopics(page);
  const card = page.locator(".cv2-story-card", { hasText: topic.title });

  // 卡片上的收藏快捷钮（此前只点过判断卡内的「收藏选题」）
  await card.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "已收藏", exact: true })
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/creator/topics/" + topic.id)).json())
      .favorite
  ).toBe(true);

  // 刷新后仍在（真实 SQLite 持久化）
  await page.reload();
  const reloaded = page.locator(".cv2-story-card", { hasText: topic.title });
  await expect(
    reloaded.getByRole("button", { name: "已收藏", exact: true })
  ).toBeVisible();

  // 脏检查分支：本卡已选中且有未保存修改 → 只警告，不改收藏。
  // 收藏后标题钮的可达名带「☆ 」前缀（TopicsDiscovery.jsx cv2-story-title），不能用 exact 匹配。
  await reloaded.getByRole("button", { name: topic.title }).click();
  await page.getByLabel("读者问题", { exact: true }).fill("未保存的临时修改");
  await reloaded.getByRole("button", { name: "已收藏", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "这条线索有未保存的修改，请先「保存简报」再收藏。"
  );
  expect(
    (await (await page.request.get("/api/creator/topics/" + topic.id)).json())
      .favorite
  ).toBe(true);

  // 丢弃脏修改（重新载入）后再点一次 → 真实取消收藏
  await page.reload();
  const fresh = page.locator(".cv2-story-card", { hasText: topic.title });
  await fresh.getByRole("button", { name: "已收藏", exact: true }).click();
  await expect(
    fresh.getByRole("button", { name: "收藏", exact: true })
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/creator/topics/" + topic.id)).json())
      .favorite
  ).toBe(false);
});

test("判断卡「暂不创作」：status=dismissed 真实保存，刷新与状态筛选一致", async ({
  page,
}) => {
  await signup(page, "topics-dismiss@example.test");
  const topic = await seedTopic(page, {
    title: "暂不创作验证：先搁置的热点追随",
    withRefs: false,
  });
  await openTopics(page);
  // 折叠区内的「暂不创作」（判断卡动作，非筛选 chip）
  await page.getByText("完整简报与版本历史", { exact: true }).click();
  await page
    .locator("details.cv2-detail-details", { hasText: "完整简报与版本历史" })
    .getByRole("button", { name: "暂不创作", exact: true })
    .click();
  const card = page.locator(".cv2-story-card", { hasText: topic.title });
  await expect(card).toContainText("暂不创作");
  expect(
    (await (await page.request.get("/api/creator/topics/" + topic.id)).json())
      .status
  ).toBe("dismissed");

  // 刷新后仍是暂不创作；状态 chips 筛选与之联动
  await page.reload();
  await expect(
    page.locator(".cv2-story-card", { hasText: topic.title })
  ).toContainText("暂不创作");
  await page
    .getByRole("group", { name: "按状态筛选" })
    .getByRole("button", { name: "暂不创作", exact: true })
    .click();
  await expect(page.locator(".cv2-story-card")).toHaveCount(1);
});

test("恢复简报为新版本：正向恢复产生 v3，当前版恢复钮保持禁用", async ({
  page,
}) => {
  await signup(page, "topics-restore@example.test");
  const topic = await seedTopic(page, {
    title: "版本恢复验证：可回退的判断卡",
    withRefs: false,
  });
  const v1Problem = "下一代个人助手应该用什么标准判断是否可靠？";
  await openTopics(page);
  await page
    .getByLabel("读者问题", { exact: true })
    .fill("第二版问题：什么才算可靠的进步？");
  await page.getByRole("button", { name: "保存简报", exact: true }).click();
  await expect(page.getByLabel("读者问题", { exact: true })).toHaveValue(
    "第二版问题：什么才算可靠的进步？"
  );

  // 展开版本历史：v2 是当前版（禁用），v1 可恢复
  await page.getByText("完整简报与版本历史", { exact: true }).click();
  await page.getByRole("button", { name: "查看简报版本", exact: true }).click();
  const v2row = page.locator(".cv2-history-item", { hasText: "v2 ·" });
  const v1row = page.locator(".cv2-history-item", { hasText: "v1 ·" });
  await expect(v2row).toBeVisible();
  await expect(
    v2row.getByRole("button", { name: "恢复简报为新版本" })
  ).toBeDisabled();
  await expect(
    v1row.getByRole("button", { name: "恢复简报为新版本" })
  ).toBeEnabled();

  // 正向恢复 v1：产生新版本 v3（不可变修订，不覆写历史）
  await v1row.getByRole("button", { name: "恢复简报为新版本" }).click();
  await expect(page.getByLabel("读者问题", { exact: true })).toHaveValue(
    v1Problem
  );
  const after = await (
    await page.request.get("/api/creator/topics/" + topic.id)
  ).json();
  expect(after.revision).toBe(3);
  expect(after.problem).toBe(v1Problem);

  // 重新打开版本列表：v3 成为当前版（禁用），v1/v2 仍可恢复
  await page.getByRole("button", { name: "查看简报版本", exact: true }).click();
  const v3row = page.locator(".cv2-history-item", { hasText: "v3 ·" });
  await expect(v3row).toBeVisible();
  await expect(
    v3row.getByRole("button", { name: "恢复简报为新版本" })
  ).toBeDisabled();
  await expect(
    page.locator(".cv2-history-item", { hasText: "v1 ·" }).getByRole("button", {
      name: "恢复简报为新版本",
    })
  ).toBeEnabled();
});

test("键盘可达性：首个 Tab 停在「跳到主内容」，Enter 触发跳转并提交记录选题表单", async ({
  page,
}) => {
  await signup(page, "topics-keyboard@example.test");
  await openTopics(page);
  // CreatorShell 的 skip link 是本页第一个可聚焦元素
  await page.keyboard.press("Tab");
  await expect(page.locator(".cv2-skip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cv2-main")).toBeFocused();
  // 记录选题表单支持 Enter 提交（form onSubmit → 真实 POST + 打开判断卡）
  await page.getByLabel("新选题标题").fill("用键盘记录的一个选题");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(
    "用键盘记录的一个选题"
  );
});

test("跨页入口：banner「查看全部热点」与页头「查看热点雷达」真实跳转", async ({
  page,
}) => {
  await signup(page, "topics-links@example.test");
  await seedTopic(page, { title: "跨页入口验证：一条真实线索", withRefs: false });
  await openTopics(page);
  await page.getByRole("link", { name: "查看全部热点", exact: true }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
  await openTopics(page);
  await page.getByRole("link", { name: "查看热点雷达", exact: true }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
});

test("内容主线步骤条：01 热点/03 创作/04 交付/05 复盘 四个链接真实跳转", async ({
  page,
}) => {
  await signup(page, "topics-steps@example.test");
  const stops = [
    [
      "01 热点",
      /\/hotspots$/,
      () =>
        expect(
          page.getByRole("heading", { name: "热点雷达", exact: true })
        ).toBeVisible(),
    ],
    [
      "03 创作",
      /\/compose$/,
      () =>
        expect(
          page.getByRole("heading", { name: "创作空间", level: 1 })
        ).toBeVisible(),
    ],
    [
      "04 交付",
      /\/publish$/,
      () =>
        expect(
          page.getByRole("heading", { name: "发布之前，再确认一次" })
        ).toBeVisible(),
    ],
    [
      "05 复盘",
      /\/insights$/,
      () =>
        expect(
          page.getByRole("heading", { name: "发布后，让经验回到下一篇" })
        ).toBeVisible(),
    ],
  ];
  for (const [label, url, check] of stops) {
    await openTopics(page);
    await page.locator(".cv2-step-line").getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(url);
    await check();
  }
});

test("空态与 AI 提示内的跨页链接：去热点雷达找线索 / 偏好与连接 真实跳转", async ({
  page,
}) => {
  await signup(page, "topics-hintlinks@example.test");
  await openTopics(page);
  await expect(page.getByText("还没有选题线索")).toBeVisible();
  await page.getByRole("link", { name: "去热点雷达找线索", exact: true }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await openTopics(page);
  await page
    .getByText("批量推荐：从素材与模型获取候选", { exact: true })
    .click();
  // AI 不可用提示内的「偏好与连接」（作用域限定提示行，避开侧栏同名链接）
  await page
    .locator(".cv2-recommend-hint", { hasText: "未检测到已配置的写作模型" })
    .getByRole("link", { name: "偏好与连接" })
    .click();
  // 产品契约：链接指向 /settings（默认打开创作画像组）；连接配置在「模型与费用」
  // 分组内，需要再点一次进入（TopicsDiscovery.jsx 链接 href="/settings"）。
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: "让工作台逐渐了解你的风格", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "设置分组" }).getByRole("button", { name: "模型与费用", exact: true })
  ).toBeVisible();
});

test("继续创作两处入口：线索卡与判断卡链接真实打开同一篇作品", async ({
  page,
}) => {
  await signup(page, "topics-continue@example.test");
  const topic = await seedTopic(page, {
    title: "继续创作验证：从选题回到同一篇作品",
    withRefs: false,
  });
  const started = await (
    await page.request.post("/api/creator/topics/" + topic.id + "/start", { data: {} }) // 写请求必须携带 JSON body（V58 边界契约，同 UI send）
  ).json();
  expect(started.projectId).toMatch(/^ep_/);
  await openTopics(page);
  const card = page.locator(".cv2-story-card", { hasText: topic.title });
  await expect(card).toContainText("写作中");
  await card.getByRole("link", { name: "继续创作", exact: true }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  expect(new URL(page.url()).searchParams.get("project")).toBe(
    started.projectId
  );
  await expect(
    page.getByRole("heading", { name: topic.title, level: 1 })
  ).toBeVisible();

  // 判断卡内的「继续创作（已有作品）」：同一作品，不重复建档
  await openTopics(page);
  await page.getByRole("button", { name: topic.title, exact: true }).click();
  await page
    .getByRole("link", { name: "继续创作（已有作品）" })
    .click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  expect(new URL(page.url()).searchParams.get("project")).toBe(
    started.projectId
  );
});

test("系列计划动作：现在准备下一篇真实入队，暂停/恢复计划持久化", async ({
  page,
}) => {
  await signup(page, "topics-series-actions@example.test");
  const s = await seedSeries(page, {
    name: "行动系列：把方法写成专栏",
    goal: "把个人方法整理成可执行的专栏",
  });
  await openTopics(page);
  await page.getByRole("button", { name: "内容系列" }).click();
  const card = page.locator(".cv2-surface", { hasText: s.name });
  await expect(card.getByText("进行中", { exact: true })).toBeVisible();

  // 现在准备下一篇：真实入队；本环境 worker 关闭 → 任务保持「等待准备」
  await card.getByRole("button", { name: "现在准备下一篇" }).click();
  await expect(page.getByRole("status")).toContainText(
    "已排入服务端准备队列，关闭页面后仍会执行。"
  );
  await expect(page.locator(".cv2-series-jobrow").first()).toContainText(
    "等待准备"
  );
  const jobs = (await (await page.request.get("/api/creator/jobs")).json()).jobs;
  expect(jobs[0].status).toBe("queued");

  // 暂停计划：tag 变化 + 服务端持久化 + 准备按钮禁用
  await card.getByRole("button", { name: "暂停计划" }).click();
  await expect(card.getByText("已暂停", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "现在准备下一篇" })).toBeDisabled();
  expect(
    (await (await page.request.get("/api/creator/series/" + s.id)).json()).status
  ).toBe("paused");

  // 刷新后仍为已暂停（经页头按钮重进系列视图）
  await page.reload();
  await page.getByRole("button", { name: "内容系列" }).click();
  const paused = page.locator(".cv2-surface", { hasText: s.name });
  await expect(paused.getByText("已暂停", { exact: true })).toBeVisible();

  // 恢复计划
  await paused.getByRole("button", { name: "恢复计划" }).click();
  await expect(paused.getByText("进行中", { exact: true })).toBeVisible();
  expect(
    (await (await page.request.get("/api/creator/series/" + s.id)).json()).status
  ).toBe("active");
});

test("系列计划维护：调整下次准备时间、从选题池加入一篇、结束系列计划", async ({
  page,
}) => {
  await signup(page, "topics-series-edit@example.test");
  const s = await seedSeries(page, {
    name: "复盘系列：从记录到方法",
    goal: "把每次实践复盘沉淀成方法",
  });
  const extra = await (
    await page.request.post("/api/creator/topics", {
      data: { title: "系列外候选：写作节奏实验" },
    })
  ).json();
  await openTopics(page);
  await page.getByRole("button", { name: "内容系列" }).click();
  const card = page.locator(".cv2-surface", { hasText: s.name });

  // 调整系列计划：含 nextRunAt 的表单真实 PUT（北京时间 → UTC 存储）
  await card.getByText("调整系列计划").click();
  await page
    .getByLabel("下次准备时间（北京时间，可留空）")
    .fill("2026-11-03T09:00");
  await card.getByRole("button", { name: "保存系列调整" }).click();
  await expect(page.getByRole("status")).toContainText("系列计划已更新。");
  const updated = await (
    await page.request.get("/api/creator/series/" + s.id)
  ).json();
  // 北京时间 2026-11-03 09:00 = UTC 2026-11-03T01:00（UI 以 ":00+08:00" 解析后
  // toISOString 存储，TopicsDiscovery.jsx:1186；卡片经 when() 以北京时间+秒显示）。
  expect(updated.nextRunAt.startsWith("2026-11-03T01:00")).toBe(true);
  await expect(card).toContainText(/下次准备：2026\/11\/3 09:00:00（北京时间）/);

  // 从选题池添加一篇 → 加入系列（真实 PUT entries）
  await page.getByLabel("从选题池添加一篇").selectOption({ label: extra.title });
  await card.getByRole("button", { name: "加入系列" }).click();
  await expect(
    page.locator(".cv2-series-card", { hasText: extra.title })
  ).toBeVisible();
  const joined = await (
    await page.request.get("/api/creator/series/" + s.id)
  ).json();
  expect(joined.entries).toHaveLength(5);

  // 结束系列计划：状态持久化，准备入口随之禁用
  await card.getByRole("button", { name: "结束系列计划" }).click();
  await expect(card.getByText("已结束", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "现在准备下一篇" })).toBeDisabled();
  expect(
    (await (await page.request.get("/api/creator/series/" + s.id)).json()).status
  ).toBe("completed");
});

test("系列条目管理：上移排序、移出系列、条目打开判断卡、继续写作与返回选题线索", async ({
  page,
}) => {
  await signup(page, "topics-series-entries@example.test");
  const s = await seedSeries(page, {
    name: "条目系列：三篇一组",
    goal: "三篇一组验证条目管理",
    entries: [
      "系列篇一：记录一次完整的写作循环",
      "系列篇二：把反馈变成下一篇的输入",
      "系列篇三：复盘哪些方法可复用",
    ],
  });
  await openTopics(page);
  await page.getByRole("button", { name: "内容系列" }).click();
  const cards = page.locator(".cv2-series-card");
  await expect(cards).toHaveCount(3);

  // 上移：第二篇提到第一位（真实 PUT entries 顺序，服务端核对）
  await cards.nth(1).getByRole("button", { name: "上移" }).click();
  await expect(cards.nth(0)).toContainText("系列篇二");
  await expect(cards.nth(1)).toContainText("系列篇一");
  const reordered = await (
    await page.request.get("/api/creator/series/" + s.id)
  ).json();
  expect(reordered.entries.map((e) => e.topic.title)).toEqual([
    "系列篇二：把反馈变成下一篇的输入",
    "系列篇一：记录一次完整的写作循环",
    "系列篇三：复盘哪些方法可复用",
  ]);

  // 移出系列：第三篇移出后只剩两篇
  await page
    .locator(".cv2-series-card", { hasText: "系列篇三" })
    .getByRole("button", { name: "移出系列" })
    .click();
  await expect(cards).toHaveCount(2);

  // 真实开始第一篇（篇二）写作 → 条目出现「继续写作 →」并打开同一篇作品
  const first = reordered.entries[0];
  const started = await (
    await page.request.post("/api/creator/topics/" + first.topic.id + "/start", { data: {} }) // 写请求必须携带 JSON body（V58 边界契约，同 UI send）
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "内容系列" }).click();
  const writing = page.locator(".cv2-series-card", { hasText: "系列篇二" });
  await expect(writing.getByText("写作中", { exact: true })).toBeVisible();
  await writing.getByRole("link", { name: "继续写作 →" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  expect(new URL(page.url()).searchParams.get("project")).toBe(
    started.projectId
  );

  // 条目标题按钮：跳回选题视图并打开该条目的判断卡
  await openTopics(page);
  await page.getByRole("button", { name: "内容系列" }).click();
  await page
    .getByRole("button", { name: "2. 系列篇一：记录一次完整的写作循环" })
    .click();
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(
    "系列篇一：记录一次完整的写作循环"
  );
  await expect(page.getByRole("button", { name: "内容系列" })).toBeVisible();

  // 页头「返回选题线索」：series → topics 切换钮真实点击
  await page.getByRole("button", { name: "内容系列" }).click();
  await expect(page.getByRole("button", { name: "返回选题线索" })).toBeVisible();
  await page.getByRole("button", { name: "返回选题线索" }).click();
  await expect(page.locator(".cv2-tabbar")).toBeVisible();
});

test("深链 ?view=series 与 ?series= 直达系列视图（桌面+移动）", async ({
  page,
}) => {
  await signup(page, "topics-series-deeplink@example.test");
  const s = await seedSeries(page, {
    name: "深链系列：直达系列规划",
    goal: "从链接直接进入系列视图",
  });
  await page.goto("/topics?view=series");
  await expect(page.getByRole("heading", { name: "规划内容系列" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回选题线索" })).toBeVisible();
  await expect(page.locator(".cv2-surface", { hasText: s.name })).toBeVisible();
  await expect(page.locator(".cv2-tabbar")).toHaveCount(0);

  await page.goto("/topics?series=" + s.id);
  await expect(page.getByRole("heading", { name: "规划内容系列" })).toBeVisible();
  await expect(page.locator(".cv2-surface", { hasText: s.name })).toBeVisible();

  // 移动视口：深链同样直达且无横向溢出
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/topics?series=" + s.id);
  await expect(page.getByRole("heading", { name: "规划内容系列" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(0);
});

test("移动 390×844：状态 chips 真实筛选，卡片收藏快捷钮刷新后仍在", async ({
  page,
}) => {
  await signup(page, "topics-mobile-chips@example.test");
  const dismissed = await seedTopic(page, {
    title: "移动筛选：被搁置的选题",
    withRefs: false,
  });
  await putStatus(page, dismissed, "dismissed");
  const kept = await seedTopic(page, {
    title: "移动筛选：仍在讨论的选题",
    withRefs: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTopics(page);

  const chips = page.getByRole("group", { name: "按状态筛选" });
  await chips.getByRole("button", { name: "暂不创作", exact: true }).click();
  await expect(
    chips.getByRole("button", { name: "暂不创作", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cv2-story-card")).toHaveCount(1);
  await expect(
    page.locator(".cv2-story-card", { hasText: dismissed.title })
  ).toBeVisible();
  await chips.getByRole("button", { name: "全部状态", exact: true }).click();

  // 移动端的卡片收藏快捷钮 toggle + 持久化
  const card = page.locator(".cv2-story-card", { hasText: kept.title });
  await card.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "已收藏", exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator(".cv2-story-card", { hasText: kept.title })
      .getByRole("button", { name: "已收藏", exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(0);
});

test("移动 390×844：空态、AI 提示与继续创作的跨页链接真实跳转", async ({
  page,
}) => {
  await signup(page, "topics-mobile-links@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await openTopics(page);
  await expect(page.getByText("还没有选题线索")).toBeVisible();
  await page.getByRole("link", { name: "去热点雷达找线索", exact: true }).click();
  await expect(page).toHaveURL(/\/hotspots$/);

  await openTopics(page);
  await page
    .getByText("批量推荐：从素材与模型获取候选", { exact: true })
    .click();
  await page
    .locator(".cv2-recommend-hint", { hasText: "未检测到已配置的写作模型" })
    .getByRole("link", { name: "偏好与连接" })
    .click();
  await expect(page).toHaveURL(/\/settings$/);

  await openTopics(page);
  const topic = await seedTopic(page, {
    title: "移动继续创作：同一篇作品的入口",
    withRefs: false,
  });
  const started = await (
    await page.request.post("/api/creator/topics/" + topic.id + "/start", { data: {} }) // 写请求必须携带 JSON body（V58 边界契约，同 UI send）
  ).json();
  await page.reload();
  const card = page.locator(".cv2-story-card", { hasText: topic.title });
  await card.getByRole("link", { name: "继续创作", exact: true }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  expect(new URL(page.url()).searchParams.get("project")).toBe(
    started.projectId
  );
  await openTopics(page);
  await page.getByRole("button", { name: topic.title, exact: true }).click();
  await page.getByRole("link", { name: "继续创作（已有作品）" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
});

test("移动「更多」面板：打开、关闭按钮并把焦点还给触发钮", async ({ page }) => {
  await signup(page, "topics-mobile-more@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await openTopics(page);
  const more = page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("button", { name: "更多" });
  await more.click();
  const panel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(panel).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("link", { name: /内容日历/ })).toBeVisible();
  await panel.getByRole("button", { name: "关闭更多菜单" }).click();
  await expect(panel).not.toBeVisible();
  // 关闭按钮路径会正确还焦（CreatorShell.jsx:244-248）
  await expect(more).toBeFocused();
});

// 已登记功能缺陷（CREATOR-V2-DESIGN-DEVIATIONS.md /home 工作台节 #5，:52-55）：
// Esc 关闭路径（CreatorShell.jsx:128-136）只 setMoreOpen(false)，未调用
// moreButtonRef.current?.focus()——焦点留在 BODY。修复前该断言必失败，
// 故登记为 test.fixme，不删记录、不写会失败的常跑断言。
test.fixme("移动「更多」面板 Esc 关闭后焦点未返回触发按钮 @bug:deviations#工作台#5", async ({
  page,
}) => {
  await signup(page, "topics-mobile-more-esc@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await openTopics(page);
  const more = page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("button", { name: "更多" });
  await more.click();
  const panel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(more).toBeFocused(); // 修复前：焦点落在 BODY，此行会失败
});

testAI("讨论候选预览：真实模型往返后「查看建议简报」展开候选全文，刷新后仍在", async ({
  page,
}) => {
  await signup(page, "topics-discuss@example.test");
  const topic = await seedTopic(page, {
    title: "讨论验证：从实践里长出来的写作角度",
  });
  await openTopics(page);
  await page.getByText("与选题助手讨论", { exact: true }).click();
  await page
    .getByLabel("选题讨论", { exact: true })
    .fill("请帮我判断这个选题适合谁，并给一个大纲建议");
  await page
    .getByLabel("允许本次向模型发送选题、所选素材与讨论内容")
    .check();
  await page.getByRole("button", { name: "发送讨论", exact: true }).click();
  await expect(page.locator(".cv2-conversation > div")).toHaveCount(2);

  // 候选预览折叠（此前从未展开）：展开后是候选简报全文
  await page.getByText("查看建议简报", { exact: true }).click();
  await expect(page.locator(".cv2-conversation pre")).toContainText(
    "从实践中建立写作流程"
  );
  await expect(page.locator(".cv2-conversation pre")).toContainText("## 明确读者");

  // 服务端持久化：候选已随消息落库
  const msgs = (
    await (
      await page.request.get("/api/creator/topics/" + topic.id + "/messages")
    ).json()
  ).messages;
  expect(msgs).toHaveLength(2);
  expect(msgs[1].candidate.title).toBe("从实践中建立写作流程");

  // 刷新后讨论与候选仍在，可再次展开
  await page.reload();
  await page.getByText("与选题助手讨论", { exact: true }).click();
  await expect(page.locator(".cv2-conversation > div")).toHaveCount(2);
  await page.getByText("查看建议简报", { exact: true }).click();
  await expect(page.locator(".cv2-conversation pre")).toContainText(
    "从实践中建立写作流程"
  );
});
