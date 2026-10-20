import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 home workspace (/) e2e — real routes, real SQLite domain
// services, no fixtures: an isolated worker-scoped production server
// (same pattern as e2e/creator-v1.spec.mjs) runs with multiuser sessions
// and NO model configured, which also proves basic editing works without
// AI. Assertions cover the approved V2.2 home design: hero with a real
// "继续创作" primary action, three-metric overview band (no fake KPIs),
// honest empty/first-use states, quick create, featured clues, and the
// 390×844 mobile layout without horizontal overflow.

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
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-creator-home-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "home.sqlite"),
        CONTENT_STUDIO_DEPLOY_MODE: "",
        CONTENT_STUDIO_ALLOW_REMOTE: "0",
        ENABLE_SCENARIO: "0",
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
        if (!ready) throw Error("Home server did not start " + logs);
        await use(origin);
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
  baseURL: async ({ creatorOrigin }, use) => use(creatorOrigin),
});

async function signup(page, email) {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成首页作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

test("空工作台：首屏是诚实的零状态与首次使用引导，不展示虚构 KPI", async ({
  page,
}) => {
  await signup(page, "home-empty@example.test");
  // 概览带三格全部为真实零值
  const band = page.locator(".cv2-overview-band .cv2-insight");
  await expect(band.nth(0)).toContainText(/00\s*篇/);
  await expect(band.nth(1)).toContainText(/00\s*项/);
  await expect(band.nth(2)).toContainText(/00\s*条/);
  // 没有作品时主操作是快捷建文引导，而不是假的"继续创作"
  await expect(
    page.getByRole("button", { name: /写下第一篇/ })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /继续创作/ })).toHaveCount(0);
  // 首次使用引导 + 诚实的空态文案
  await expect(
    page.getByRole("heading", { name: "为你的创作做好准备" })
  ).toBeVisible();
  await expect(page.getByText("还没有作品。写下第一个标题", { exact: false })).toBeVisible();
  await expect(page.getByText("还没有可判断的选题", { exact: false })).toBeVisible();
  await expect(
    page.getByText("创建第一篇作品后，需要核对的事实与发布检查会出现在这里。")
  ).toBeVisible();
  // 写下第一篇 → 聚焦快捷建文输入框
  await page.getByRole("button", { name: /写下第一篇/ }).click();
  await expect(page.getByLabel("文章标题")) .toBeFocused();
});

test("快捷建文：真实创建作品并进入创作空间，首页出现真实数据与继续创作", async ({
  page,
}) => {
  await signup(page, "home-create@example.test");
  await page
    .getByLabel("文章标题")
    .fill("桌面 AI 工作流的真实成本");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  // 返回工作台：概览带、最近作品、继续创作全部来自真实领域状态
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
  await expect(page.locator(".cv2-overview-band .cv2-insight").nth(0)).toContainText(
    /01\s*篇/
  );
  const continueLink = page
    .locator(".cv2-hero-actions")
    .getByRole("link", { name: /继续创作/ });
  await expect(continueLink).toBeVisible();
  await expect(continueLink).toHaveAttribute("href", /\/compose\?project=ep_/);
  await expect(page.getByRole("link", { name: "桌面 AI 工作流的真实成本" })).toBeVisible();
  await expect(page.getByText("草稿中", { exact: true })).toBeVisible();
});

test("精选线索：真实选题进入首页并可跳转选题页", async ({ page }) => {
  await signup(page, "home-clues@example.test");
  // page.request 共享已登录会话 cookie；直接走真实 API 建一条选题
  const resp = await page.request.post("/api/creator/topics", {
    data: {
      title: "从实践中总结写作流程的真实成本",
      angle: "以作者自己的实践为切口，不比较风口大小",
    },
  });
  expect(resp.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
  await expect(page.locator(".cv2-overview-band .cv2-insight").nth(2)).toContainText(
    /01\s*条/
  );
  const clue = page.getByRole("link", {
    name: "从实践中总结写作流程的真实成本",
  });
  await expect(clue).toBeVisible();
  await expect(page.getByText("以作者自己的实践为切口", { exact: false })).toBeVisible();
  await clue.click();
  await expect(page).toHaveURL(/\/topics\?topic=tp_/);
});

test("移动 390×844：单栏布局、底部导航与无横向溢出", async ({ page }) => {
  await signup(page, "home-mobile@example.test");
  await page
    .getByLabel("文章标题")
    .fill("移动端视口下的首屏检查");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
  // 桌面装饰隐藏，概览带保持三格，底部 tab 高亮工作台
  await expect(page.locator(".cv2-hero-art")).not.toBeVisible();
  await expect(page.locator(".cv2-overview-band .cv2-insight")).toHaveCount(3);
  await expect(
    page
      .getByRole("navigation", { name: "移动端导航" })
      .getByRole("link", { name: "工作台" })
  ).toHaveAttribute("aria-current", "page");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // 底部导航真实可用：热点 tab 能离开工作台
  await page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("link", { name: "热点" })
    .click();
  await expect(page).toHaveURL(/\/hotspots/);
});

// ── 交互覆盖补齐（V2.3 审计缺口）────────────────────────────────────
// 以下用例逐项覆盖 /home 审计登记的缺失交互：hero/栏目/引导/侧栏/顶栏/
// skip link 的真实点击、真实待办任务卡（部分人工检查 → 去检查）与通知
// 待办（后台系列准备 → 标为已读）、概览失败重试、快捷建文校验与失败
// 路径、退出登录，以及移动端「更多」面板开关（Esc 还焦缺陷已登记为
// CREATOR-V2-DESIGN-DEVIATIONS.md /home #5 → test.fixme）。

test("hero 与栏目链接：继续创作、看看今天的选题、最近作品、查看全部、进入选题与完成条真实点击", async ({
  page,
}) => {
  await signup(page, "home-links@example.test");
  const created = await page.request.post("/api/writing/projects", {
    data: { title: "链接点击验证：真实继续创作入口" },
  });
  expect(created.ok()).toBeTruthy();
  const { projectId } = await created.json();
  expect(projectId).toMatch(/^ep_/);
  await page.goto("/");
  // hero「继续创作」真实点击 → 对应项目创作空间（此前仅断言 href）
  const continueLink = page
    .locator(".cv2-hero-actions")
    .getByRole("link", { name: /继续创作/ });
  await expect(continueLink).toBeVisible();
  await continueLink.click();
  await expect(page).toHaveURL("/compose?project=" + encodeURIComponent(projectId));
  // hero「看看今天的选题」→ /topics
  await page.goto("/");
  await page
    .locator(".cv2-hero-actions")
    .getByRole("link", { name: "看看今天的选题" })
    .click();
  await expect(page).toHaveURL(/\/topics$/);
  // 最近的作品表格标题链接 → 同一项目
  await page.goto("/");
  await page.getByRole("link", { name: "链接点击验证：真实继续创作入口" }).click();
  await expect(page).toHaveURL("/compose?project=" + encodeURIComponent(projectId));
  // 最近的作品「查看全部 →」→ /works
  await page.goto("/");
  await page.locator(".cv2-recent").getByRole("link", { name: "查看全部 →" }).click();
  await expect(page).toHaveURL(/\/works$/);
  // 「值得研究的选题」栏「进入选题 →」→ /topics
  await page.goto("/");
  await page
    .locator(".cv2-home-side")
    .getByRole("link", { name: "进入选题 →" })
    .click();
  await expect(page).toHaveURL(/\/topics$/);
  // 完成条「前往独立热点雷达」→ /hotspots
  await page.goto("/");
  await page.getByRole("link", { name: /前往独立热点雷达/ }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
});

test("首次使用引导与选题空态入口：三步引导与空态链接真实跳转", async ({ page }) => {
  await signup(page, "home-guide@example.test");
  // 引导 01 · 画像：完善画像 → /settings
  await page.locator(".cv2-firstuse").getByRole("link", { name: "完善画像" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // 引导 02 · 模型：查看服务连接 → /settings
  await page.goto("/");
  await page
    .locator(".cv2-firstuse")
    .getByRole("link", { name: "查看服务连接" })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  // 引导 03 · 方向：打开热点雷达 → /hotspots
  await page.goto("/");
  await page
    .locator(".cv2-firstuse")
    .getByRole("link", { name: "打开热点雷达" })
    .click();
  await expect(page).toHaveURL(/\/hotspots$/);
  // 选题空态「打开热点雷达」→ /hotspots（与引导卡同名，按栏作用域区分）
  await page.goto("/");
  await page
    .locator(".cv2-home-side")
    .getByRole("link", { name: "打开热点雷达" })
    .click();
  await expect(page).toHaveURL(/\/hotspots$/);
});

test("概览接口失败：ErrorState 可操作错误与重试恢复", async ({ page }) => {
  await signup(page, "home-error@example.test");
  const overview = /\/api\/creator\/overview/;
  await page.route(overview, (route) => route.abort());
  await page.goto("/");
  const alert = page.locator("div.cv2-error-state");
  await expect(alert).toContainText("工作台加载失败");
  await expect(alert).toContainText("检查本地服务是否在运行");
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
  await page.unroute(overview);
  await alert.getByRole("button", { name: "重试" }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
});

test("快捷建文校验与失败路径：原生 minLength 拦截、空白标题提示与网络失败提示", async ({
  page,
}) => {
  await signup(page, "home-qcfail@example.test");
  const input = page.getByLabel("文章标题");
  // 过短标题（<minLength 3）被原生校验拦截：不发起请求、不出现自建 notice
  await input.fill("ab");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(input).toHaveJSProperty("validity.valid", false);
  const validationMessage = await input.evaluate((el) => el.validationMessage);
  expect(validationMessage.length).toBeGreaterThan(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  // 空白标题通过原生校验但被组件拒绝：真实 notice「先写下一个标题或想法」
  await input.fill("   ");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page.getByRole("status").last()).toContainText(
    "先写下一个标题或想法"
  );
  await expect(page).toHaveURL(/\/$/);
  // POST 网络失败：真实请求被拦截 → 错误 notice，busy 解除且仍在首页
  await page.route("**/api/writing/projects", (route) => route.abort());
  await input.fill("网络失败时的快捷建文标题");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page.getByRole("status").last()).toContainText(
    /创建未完成|Failed to fetch|Failed to load/i
  );
  await expect(page).toHaveURL(/\/$/);
  await expect(input).toBeEditable();
  await expect(
    page.getByRole("button", { name: "创建作品" })
  ).toBeEnabled();
  await page.unroute("**/api/writing/projects");
});

test("待办任务卡：真实部分人工检查产生待办，主按钮进入对应渠道创作空间", async ({
  page,
}) => {
  await signup(page, "home-pending@example.test");
  // 全部走真实领域 API 造出待办：公众号稿四项人工检查完成一半
  const created = await page.request.post("/api/writing/projects", {
    data: { title: "待办验证：需要完成公众号稿检查" },
  });
  expect(created.ok()).toBeTruthy();
  const { projectId } = await created.json();
  expect(projectId).toMatch(/^ep_/);
  const detail = await (
    await page.request.get(`/api/editor/projects/${projectId}`)
  ).json();
  const partial = await page.request.post(
    `/api/editor/projects/${projectId}/wechat/checks`,
    {
      data: {
        expectedRevision: detail.channels.wechat.document.revision,
        checks: { factual: true, privacy: true, rights: false, layout: false },
      },
    }
  );
  expect(partial.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.locator(".cv2-overview-band .cv2-insight").nth(1)).toContainText(
    /01\s*项/
  );
  await expect(page.getByText("1 件待办")).toBeVisible();
  const task = page.locator(".cv2-task-card", { hasText: "需要完成公众号稿检查" });
  await expect(task).toContainText(
    "完成《待办验证：需要完成公众号稿检查》公众号稿的人工检查"
  );
  await expect(task).toContainText("该渠道四项检查已确认 2 项，还剩 2 项。");
  await task.getByRole("link", { name: /去检查/ }).click();
  await expect(page).toHaveURL(
    "/compose?project=" + encodeURIComponent(projectId) + "&channel=wechat"
  );
});

test("通知待办：后台系列准备产生真实通知，标为已读后消失且刷新不回", async ({
  page,
}) => {
  await signup(page, "home-notify@example.test");
  // 真实产生通知的路径：创建系列（本地准备，不依赖模型）→ 入队 →
  // 生产服务后台 worker（instrumentation，3s tick）完成准备后写入
  // creator_notifications（src/creator.mjs 下一篇选题和大纲已准备）。
  const series = await (
    await page.request.post("/api/creator/series", {
      data: { name: "首页通知验证系列", goal: "验证首页通知待办的真实产生路径" },
    })
  ).json();
  expect(series.id).toMatch(/^sr_/);
  const enqueued = await page.request.post(
    `/api/creator/series/${series.id}/prepare`,
    // 边界契约：带 body 的写请求必须是 JSON（lib/creator-client.js send 同样恒发 JSON body）
    { data: {} }
  );
  expect(enqueued.status()).toBe(202);
  let notificationId = "";
  await expect(async () => {
    const res = await page.request.get("/api/creator/overview");
    expect(res.ok()).toBeTruthy();
    const unread = (await res.json()).notifications.filter((n) => !n.read);
    expect(unread.length).toBeGreaterThanOrEqual(1);
    notificationId = unread[0].id;
  }).toPass({ timeout: 25_000, intervals: [1500] });
  expect(notificationId).toMatch(/^nt_/);

  await page.goto("/");
  await expect(page.locator(".cv2-overview-band .cv2-insight").nth(1)).toContainText(
    /01\s*项/
  );
  const task = page.locator(".cv2-task-card", { hasText: "下一篇选题和大纲已准备" });
  await expect(task).toBeVisible();
  await expect(task).toContainText("系列准备或画像建议已完成，等待你查看。");
  await expect(task.getByRole("link", { name: "去查看" })).toHaveAttribute(
    "href",
    /\/topics\?topic=tp_/
  );
  // 「标为已读」真实点击 → POST /api/creator/notifications/:id → 刷新消失
  await task.getByRole("button", { name: "标为已读" }).click();
  await expect(
    page.locator(".cv2-task-card", { hasText: "下一篇选题和大纲已准备" })
  ).toHaveCount(0);
  // 持久化：刷新后仍不回来，真实存储里 read=1
  await page.reload();
  await expect(
    page.locator(".cv2-task-card", { hasText: "下一篇选题和大纲已准备" })
  ).toHaveCount(0);
  const after = await (await page.request.get("/api/creator/overview")).json();
  expect(after.notifications.find((n) => n.id === notificationId)?.read).toBe(1);
});

test("侧栏创作导航：十一个工作区入口真实跳转并高亮当前项", async ({ page }) => {
  await signup(page, "home-nav@example.test");
  const nav = page.getByRole("navigation", { name: "创作导航" });
  const entries = [
    ["热点雷达", "/hotspots"],
    ["选题发现", "/topics"],
    ["创作空间", "/compose"],
    ["视觉工作台", "/illustrations"],
    ["作品", "/works"],
    ["发布中心", "/publish"],
    ["内容日历", "/calendar"],
    ["效果复盘", "/insights"],
    ["素材库", "/library"],
  ];
  for (const [label, href] of entries) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(href);
    await expect(
      nav.getByRole("link", { name: label, exact: true })
    ).toHaveAttribute("aria-current", "page");
  }
  // 第十一项：偏好与连接在侧栏下部独立导航组
  const lower = page.getByRole("navigation", { name: "偏好导航" });
  await lower.getByRole("link", { name: "偏好与连接" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(
    lower.getByRole("link", { name: "偏好与连接" })
  ).toHaveAttribute("aria-current", "page");
  // 回到工作台并恢复高亮
  await nav.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(
    nav.getByRole("link", { name: "工作台", exact: true })
  ).toHaveAttribute("aria-current", "page");
});

test("侧栏当前正在推进卡与 logo：进入对应作品、返回首页", async ({ page }) => {
  await signup(page, "home-progress@example.test");
  const created = await page.request.post("/api/writing/projects", {
    data: { title: "侧栏推进卡验证：真实项目标题" },
  });
  expect(created.ok()).toBeTruthy();
  const { projectId } = await created.json();
  await page.goto("/");
  // 当前正在推进卡只来自真实 overview 数据（无项目时不渲染）
  const progress = page.locator(".cv2-progress");
  await expect(progress.getByText("当前正在推进")).toBeVisible();
  await expect(progress.getByText("侧栏推进卡验证：真实项目标题")).toBeVisible();
  await progress.getByRole("link", { name: "继续创作 →" }).click();
  await expect(page).toHaveURL("/compose?project=" + encodeURIComponent(projectId));
  // logo「Content Studio」点击回首页
  await page.goto("/topics");
  await expect(page.getByRole("heading", { name: "选题发现" })).toBeVisible();
  await page.locator(".cv2-logo").click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
});

test("顶栏入口：看热点与新建作品（legacy /create 自动聚焦标题输入）", async ({
  page,
}) => {
  await signup(page, "home-topbar@example.test");
  const actions = page.locator(".cv2-topbar-actions");
  await actions.getByRole("link", { name: /看热点/ }).click();
  await expect(page).toHaveURL("/hotspots");
  await page.goto("/");
  await actions.getByRole("link", { name: /新建作品/ }).click();
  await expect(page).toHaveURL("/create");
  // /create 是同一组件的 creation 变体：提示 + 面包屑 + 自动聚焦快捷建文
  await expect(
    page.getByText("把想法写成作品：写下标题即可开始", { exact: false })
  ).toBeVisible();
  await expect(page.locator(".cv2-crumb").getByText("新建作品")).toBeVisible();
  await expect(page.getByLabel("文章标题")).toBeFocused();
});

test("键盘首 Tab 停在「跳到主内容」，回车后焦点进入主内容区", async ({ page }) => {
  await signup(page, "home-skip@example.test");
  await page.goto("/"); // 全新加载，焦点从 body 开始
  await page.keyboard.press("Tab");
  await expect(page.locator(".cv2-skip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#cv2-main$/);
  await expect(page.locator("#cv2-main")).toBeFocused();
});

test("移动 390×844：更多面板打开、六项工作区可见、头部关闭按钮关闭并还焦", async ({
  page,
}) => {
  await signup(page, "home-more@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const moreButton = page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("button", { name: "更多" });
  await expect(moreButton).toHaveAttribute("aria-expanded", "false");
  await moreButton.click();
  await expect(moreButton).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(panel).toBeVisible();
  for (const label of [
    "创作空间",
    "发布中心",
    "内容日历",
    "效果复盘",
    "素材库",
    "偏好与连接",
  ]) {
    await expect(panel.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  // 打开后首个可聚焦元素（头部关闭按钮）获得焦点
  await expect(
    panel.getByRole("button", { name: "关闭更多菜单" })
  ).toBeFocused();
  // 头部关闭按钮：关闭面板并把焦点还给「更多」触发按钮
  await panel.getByRole("button", { name: "关闭更多菜单" }).click();
  await expect(panel).not.toBeVisible();
  await expect(moreButton).toHaveAttribute("aria-expanded", "false");
  await expect(moreButton).toBeFocused();
});

test.fixme(
  "移动「更多」面板 Esc 关闭后焦点应返还触发按钮 @bug:deviations#/home#5（Esc 路径 focusBack=false、activeElement=BODY，已登记待修）",
  async ({ page }) => {
    await signup(page, "home-more-esc@example.test");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const moreButton = page
      .getByRole("navigation", { name: "移动端导航" })
      .getByRole("button", { name: "更多" });
    await moreButton.click();
    const panel = page.getByRole("dialog", { name: "更多工作区" });
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    // 修复后应满足：面板关闭且焦点回到「更多」触发按钮
    await expect(panel).not.toBeVisible();
    await expect(moreButton).toBeFocused();
  }
);

test("退出登录：managed 多用户模式登出回到 /signin，首页受会话保护", async ({
  page,
}) => {
  await signup(page, "home-logout@example.test");
  // 该规范的服务以 CONTENT_STUDIO_MULTIUSER=1 启动：头像块显示独立作者工作空间
  await expect(page.getByText("独立作者工作空间")).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/signin/);
  // 会话真实失效：直接访问首页会被重定向回登录
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin/);
});
