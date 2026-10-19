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

test("桌面 1440×900：设计版式齐全，判断卡呈现四个真实字段与来源依据", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "topics-desktop@example.test");
  const topic = await seedTopic(page);
  await openTopics(page);

  // 内容生产线步骤条（02 选题高亮）+ 从线索到选题 banner（design :172/:175）
  await expect(page.getByText("内容生产线", { exact: true })).toBeVisible();
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

  // 未选中时判断卡是诚实的引导，不是假数据
  await expect(page.getByText("选一个线索，打开编辑判断卡")).toBeVisible();

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
  await expect(page.getByText("选一个线索，打开编辑判断卡")).toBeVisible();
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
