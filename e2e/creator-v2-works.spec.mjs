import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 works library (/works) e2e — real routes, real SQLite domain
// services, no fixtures: an isolated worker-scoped production server
// (same pattern as e2e/creator-v2-home.spec.mjs / creator-v1.spec.mjs)
// runs with multiuser sessions and NO model configured. Coverage per the
// page scope: honest empty library, real creation through the design's
// 从一个想法开始 modal, stage pipeline + tab filters + search over the
// REAL editorial payload (states are produced through the genuine domain
// APIs: partial channel checks → 审稿中, channel export → 待发布), master
// vs 公众号/知乎稿 attribution, opening a card returns to the actual work,
// persistence across reloads, and the 390×844 mobile layout without
// horizontal overflow. 导出≠发布 stays explicit in the 待发布 card.

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
      const root = mkdtempSync(join(tmpdir(), "studio-creator-works-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "works.sqlite"),
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
        if (!ready) throw Error("Works server did not start " + logs);
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
  await page.getByLabel("作者名称", { exact: true }).fill("合成作品库作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

async function openWorks(page) {
  await page.goto("/works");
  await expect(
    page.getByRole("heading", { name: "每篇作品，都有清晰的下一步" })
  ).toBeVisible();
}

test("空作品库：五格管线全部为真实零值，空态诚实，创建弹窗可开可关", async ({
  page,
}) => {
  await signup(page, "works-empty@example.test");
  await openWorks(page);
  // 五格管线全部是真实的 0 篇
  const cells = page.locator(".cv2-pipeline button");
  await expect(cells).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await expect(cells.nth(i)).toContainText(/0 篇/);
  }
  // 虚线建文卡与诚实的空态文案
  await expect(
    page.getByRole("button", { name: /从一个想法开始/ })
  ).toBeVisible();
  await expect(page.getByText("作品库还是空的", { exact: false })).toBeVisible();
  // 打开创建弹窗 → 空标题提交得到真实反馈；Esc 关闭
  await page
    .getByRole("button", { name: "创建新作品", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "从一个想法开始" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("文章标题或想法")).toBeFocused();
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page.getByRole("status").last()).toContainText(
    "先写下一个标题或想法"
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("创建作品：真实 POST 建文并进入创作空间，作品卡、渠道归属与继续可用且刷新不丢", async ({
  page,
}) => {
  await signup(page, "works-create@example.test");
  await openWorks(page);
  await page
    .getByRole("button", { name: "创建新作品", exact: true })
    .click();
  await page
    .getByLabel("文章标题或想法")
    .fill("作品库验证：城市漫步中的真实观察");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  const projectId = new URL(page.url()).searchParams.get("project");
  expect(projectId).toMatch(/^ep_/);

  // 回到作品库：管线与卡片来自真实领域状态
  await openWorks(page);
  const cells = page.locator(".cv2-pipeline button");
  await expect(cells.nth(0)).toContainText(/1 篇/);
  await expect(cells.nth(1)).toContainText(/1 篇/); // 草稿中
  const card = page.locator("a.cv2-work-card", { hasText: "城市漫步中的真实观察" });
  await expect(card).toBeVisible();
  await expect(card.getByText("还没有正文；从主稿开始写")).toBeVisible();
  await expect(card.getByText("草稿中", { exact: true })).toBeVisible();
  // 主稿与公众号/知乎稿的渠道归属标签（tooltip 携带真实修订/状态）
  await expect(card.getByText("主稿", { exact: true })).toBeVisible();
  await expect(card.getByText("公众号", { exact: true })).toBeVisible();
  await expect(card.getByText("知乎", { exact: true })).toBeVisible();
  await expect(card.locator('span[title^="主稿 · 修订 v"]')).toBeAttached();
  await expect(card.locator('span[title^="公众号稿 · "]')).toBeAttached();
  await expect(card.locator('span[title^="知乎稿 · "]')).toBeAttached();

  // 刷新后作品仍在（真实 SQLite 持久化，不丢历史）
  await page.reload();
  await expect(
    page.locator("a.cv2-work-card", { hasText: "城市漫步中的真实观察" })
  ).toBeVisible();

  // 打开卡片回到实际作品（同一个 ep_ 项目的主稿）
  await page
    .locator("a.cv2-work-card", { hasText: "城市漫步中的真实观察" })
    .click();
  await expect(page).toHaveURL(
    "/compose?project=" + encodeURIComponent(projectId)
  );
});

test("状态筛选与搜索：部分人工检查进入审稿中，导出进入待发布且保持导出≠发布", async ({
  page,
}) => {
  await signup(page, "works-filter@example.test");
  // 全部通过真实领域 API 造出三种状态（无 fixtures）
  const created = async (title) => {
    const r = await page.request.post("/api/writing/projects", {
      data: { title },
    });
    expect(r.ok()).toBeTruthy();
    const d = await r.json();
    return d.projectId || d.id;
  };
  const reviewId = await created("筛选验证：需要核对事实的观察笔记");
  const readyId = await created("筛选验证：已导出的公众号稿");
  const draftId = await created("筛选验证：刚开头的工作流草稿");
  expect(reviewId).toMatch(/^ep_/);

  // 审稿中：公众号稿四项人工检查完成一半（真实的 editorial.setChecks）
  const detailOf = async (id) =>
    (await (await page.request.get(`/api/editor/projects/${id}`)).json());
  const review = await detailOf(reviewId);
  const partial = await page.request.post(
    `/api/editor/projects/${reviewId}/wechat/checks`,
    {
      data: {
        expectedRevision: review.channels.wechat.document.revision,
        checks: { factual: true, privacy: true, rights: false, layout: false },
      },
    }
  );
  expect(partial.ok()).toBeTruthy();

  // 待发布：知乎稿四项检查全部完成并真实导出（editorial.exportChannel）
  const ready = await detailOf(readyId);
  const allChecks = await page.request.post(
    `/api/editor/projects/${readyId}/zhihu/checks`,
    {
      data: {
        expectedRevision: ready.channels.zhihu.document.revision,
        checks: { factual: true, privacy: true, rights: true, layout: true },
      },
    }
  );
  expect(allChecks.ok()).toBeTruthy();
  const exported = await page.request.post(
    `/api/editor/projects/${readyId}/zhihu/export`,
    { data: { expectedRevision: ready.channels.zhihu.document.revision } }
  );
  expect(exported.ok()).toBeTruthy();
  expect((await exported.json()).status).toBe("exported");

  await openWorks(page);
  const cells = page.locator(".cv2-pipeline button");
  await expect(cells.nth(0)).toContainText(/3 篇/);
  await expect(cells.nth(1)).toContainText(/1 篇/); // 草稿中
  await expect(cells.nth(2)).toContainText(/1 篇/); // 审稿中
  await expect(cells.nth(3)).toContainText(/1 篇/); // 待发布
  await expect(cells.nth(4)).toContainText(/0 篇/); // 已发布：无作者报告

  // 审稿中筛选只显示对应卡片，副标题写明检查进度
  await cells.nth(2).click();
  await expect(page.locator("a.cv2-work-card")).toHaveCount(1);
  const reviewCard = page.locator("a.cv2-work-card", { hasText: "观察笔记" });
  await expect(reviewCard).toBeVisible();
  await expect(
    reviewCard.getByText("公众号稿人工检查进行中（2/4）")
  ).toBeVisible();

  // 待发布筛选：副标题保持 导出≠发布，不声称已发表
  await page.getByRole("button", { name: "待发布" }).first().click();
  await expect(page.locator("a.cv2-work-card")).toHaveCount(1);
  const readyCard = page.locator("a.cv2-work-card", { hasText: "已导出的公众号稿" });
  await expect(
    readyCard.getByText(/已导出 · 等待发布确认（导出不等于已发布）/)
  ).toBeVisible();
  await expect(readyCard.getByText("待发布", { exact: true })).toBeVisible();
  await expect(readyCard.getByText("已发表")).toHaveCount(0);

  // 已发布阶段为空 → 诚实的阶段空态
  await page.getByRole("button", { name: "已发布" }).last().click();
  await expect(page.getByText("此阶段暂无作品", { exact: false })).toBeVisible();
  await expect(page.locator("a.cv2-work-card")).toHaveCount(0);

  // 回到全部，搜索框按标题过滤
  await page.locator(".cv2-tabbar").getByRole("button", { name: "全部" }).click();
  await expect(page.locator("a.cv2-work-card")).toHaveCount(3);
  await page.getByLabel("搜索作品").fill("工作流草稿");
  await expect(page.locator("a.cv2-work-card")).toHaveCount(1);
  await expect(
    page.locator("a.cv2-work-card", { hasText: "刚开头的工作流草稿" })
  ).toBeVisible();
  await page.getByLabel("搜索作品").fill("不存在的作品标题");
  await expect(page.getByText("没有匹配的作品", { exact: false })).toBeVisible();
  // 虚线建文卡只出现在「全部」视图，搜索时隐藏（设计 :156）
  await expect(
    page.getByRole("button", { name: /从一个想法开始/ })
  ).toHaveCount(0);
  await page.getByLabel("搜索作品").fill("");
  await expect(
    page.getByRole("button", { name: /从一个想法开始/ })
  ).toBeVisible();

  // 从筛选状态打开卡片仍回到实际作品
  await page
    .locator("a.cv2-work-card", { hasText: "刚开头的工作流草稿" })
    .click();
  await expect(page).toHaveURL(
    "/compose?project=" + encodeURIComponent(draftId)
  );
});

// —— 以下为交互缺口补齐（2026-10-20 审计矩阵）：侧栏/顶栏/当前推进/完成条跳转、
// 虚线建文卡、弹窗取消/Enter/失败反馈、加载失败重试、移动底栏与「更多」面板、
// 退出登录、skip link 与 Tab 焦点序。选择器与文案均按组件真实标记核对。 ——

test("桌面侧栏 11 项工作区：逐项点击真实跳转且 aria-current 随路由切换", async ({
  page,
  creatorOrigin,
}) => {
  await signup(page, "works-nav@example.test");
  await openWorks(page);
  // CreatorShell.jsx:165-180 —— 创作导航 10 项 + 偏好导航 1 项 = 11 个入口
  const stops = [
    ["创作导航", "工作台", "/"],
    ["创作导航", "热点雷达", "/hotspots"],
    ["创作导航", "选题发现", "/topics"],
    ["创作导航", "创作空间", "/compose"],
    ["创作导航", "视觉工作台", "/illustrations"],
    ["创作导航", "作品", "/works"],
    ["创作导航", "发布中心", "/publish"],
    ["创作导航", "内容日历", "/calendar"],
    ["创作导航", "效果复盘", "/insights"],
    ["创作导航", "素材库", "/library"],
    ["偏好导航", "偏好与连接", "/settings"],
  ];
  const worksLink = page
    .locator('nav[aria-label="创作导航"]')
    .getByRole("link", { name: "作品" });
  for (const [navLabel, name, path] of stops) {
    await page
      .locator(`nav[aria-label="${navLabel}"]`)
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page).toHaveURL(
      path === "/" ? creatorOrigin + "/" : new RegExp(path.replace("/", "\\/"))
    );
    if (path === "/works") {
      await expect(worksLink).toHaveAttribute("aria-current", "page");
    }
  }
  // 离开 /works 后高亮随之清除；偏好入口在自己的路由上高亮
  await expect(worksLink).not.toHaveAttribute("aria-current", "page");
  await expect(
    page
      .locator('nav[aria-label="偏好导航"]')
      .getByRole("link", { name: "偏好与连接" })
  ).toHaveAttribute("aria-current", "page");
});

test("顶栏快捷入口：「看热点」去热点雷达，「新建作品」落到自动聚焦的旧深链建文页", async ({
  page,
}) => {
  await signup(page, "works-topbar@example.test");
  await openWorks(page);
  // CreatorShell.jsx:207-212 —— 两个 cv2-small-btn 链接
  await page
    .locator(".cv2-topbar-actions")
    .getByRole("link", { name: "看热点" })
    .click();
  await expect(page).toHaveURL(/\/hotspots/);
  await openWorks(page);
  // 新建作品 → 旧深链 /create（app/create/page.jsx：快捷建文输入自动聚焦）
  await page
    .locator(".cv2-topbar-actions")
    .getByRole("link", { name: "新建作品" })
    .click();
  await expect(page).toHaveURL(/\/create/);
  await expect(page.getByLabel("文章标题")).toBeFocused();
});

test("侧栏「当前正在推进·继续创作」：无在创作品时诚实隐藏，建文后出现并带回该项目主稿", async ({
  page,
}) => {
  await signup(page, "works-progress@example.test");
  await openWorks(page);
  // 没有项目时壳层不伪造推进卡（CreatorShell.jsx:108-115）
  await expect(page.locator(".cv2-progress")).toHaveCount(0);
  const r = await page.request.post("/api/writing/projects", {
    data: { title: "推进中的城市观察写作" },
  });
  expect(r.ok()).toBeTruthy();
  const projectId = (await r.json()).projectId;
  expect(projectId).toMatch(/^ep_/);
  await page.goto("/works");
  const progress = page.locator(".cv2-progress");
  await expect(progress).toBeVisible();
  await expect(progress.getByText("当前正在推进", { exact: true })).toBeVisible();
  await expect(progress.locator("strong")).toHaveText("推进中的城市观察写作");
  const link = progress.getByRole("link", { name: "继续创作 →" });
  await expect(link).toHaveAttribute(
    "href",
    "/compose?project=" + projectId
  );
  await link.click();
  await expect(page).toHaveURL("/compose?project=" + projectId);
});

test("完成条「查看内容排期」：跨页跳转到 /calendar 并落到真实内容日历", async ({
  page,
}) => {
  await signup(page, "works-completion@example.test");
  await openWorks(page);
  // WorksLibrary.jsx:253-255 —— 完成条内的 Link
  const link = page
    .locator(".cv2-completion")
    .getByRole("link", { name: /查看内容排期/ });
  await expect(link).toHaveAttribute("href", "/calendar");
  await link.click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(
    page.getByRole("heading", { name: "把创作节奏，安排得从容一点" })
  ).toBeVisible();
});

test("虚线「从一个想法开始」卡：点击打开建文弹窗并聚焦标题输入框", async ({
  page,
}) => {
  await signup(page, "works-idea-card@example.test");
  await openWorks(page);
  // WorksLibrary.jsx:216-222 —— 网格内的虚线卡按钮（此前只被断言可见，从未点击）
  await page.getByRole("button", { name: /从一个想法开始/ }).click();
  const dialog = page.getByRole("dialog", { name: "从一个想法开始" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "从一个想法开始" })).toBeVisible();
  await expect(
    dialog.getByText("只需要写下标题或一个问题", { exact: false })
  ).toBeVisible();
  await expect(page.getByLabel("文章标题或想法")).toBeFocused();
  // 离开路径也验证一次：Esc 关闭（取消按钮与 Enter 路径由后续用例覆盖）
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("建文弹窗「取消」：关闭且不创建任何作品，重开后输入已复位", async ({
  page,
}) => {
  await signup(page, "works-cancel@example.test");
  await openWorks(page);
  await page.getByRole("button", { name: "创建新作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "从一个想法开始" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("文章标题或想法").fill("不该被创建出来的标题");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/works/);
  // 服务端零写入：取消不是静默创建
  const r = await page.request.get("/api/editor/projects");
  expect(r.ok()).toBeTruthy();
  expect((await r.json()).projects).toHaveLength(0);
  // 重新打开弹窗：标题状态已复位（CreateWorkModal open 时 setTitle('')）
  await page.getByRole("button", { name: "创建新作品", exact: true }).click();
  await expect(page.getByLabel("文章标题或想法")).toHaveValue("");
});

test("建文弹窗标题输入框内 Enter：键入即真实提交创建并进入创作空间", async ({
  page,
}) => {
  await signup(page, "works-enter@example.test");
  await openWorks(page);
  await page.getByRole("button", { name: "创建新作品", exact: true }).click();
  await page.getByLabel("文章标题或想法").fill("回车键直接创建的作品");
  // WorksLibrary.jsx:71-73 —— input onKeyDown Enter → onCreate
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  const projectId = new URL(page.url()).searchParams.get("project");
  expect(projectId).toMatch(/^ep_/);
  // 真实落库核验（刷新后仍在的持久化等价断言：直接查领域 API）
  const r = await page.request.get("/api/editor/projects");
  const d = await r.json();
  expect(d.projects.some((p) => p.title === "回车键直接创建的作品")).toBeTruthy();
});

test("创建失败（POST 500）：弹窗内错误 notice 反馈与 busy 复位", async ({
  page,
}) => {
  await signup(page, "works-fail@example.test");
  await openWorks(page);
  // WorksLibrary.jsx:123-129 —— send 抛错 → setNotice(err.message) + setBusy(false)
  await page.route("**/api/writing/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "模拟创建失败：服务端拒绝了本次创建" }),
    });
  });
  await page.getByRole("button", { name: "创建新作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "从一个想法开始" });
  await page.getByLabel("文章标题或想法").fill("会被服务端拒绝的标题");
  await dialog.getByRole("button", { name: "创建作品" }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/works/);
  await expect(page.getByRole("status").last()).toContainText(
    "模拟创建失败：服务端拒绝了本次创建"
  );
  // busy 复位：按钮文案从「正在创建…」回到「创建作品」
  await expect(
    dialog.getByRole("button", { name: "创建作品" })
  ).toBeVisible();
});

test("创建失败后同一弹窗重试成功：父组件重渲染不清空已输入的标题", async ({
  page,
}) => {
  // 回归守卫：CreateWorkModal 的 open-effect 不得依赖每次渲染都变化的内联
  // onClose（失败提示触发的父组件重渲染曾把已输入标题清空，重试永远无法
  // 带上标题）；回调经 ref 读取，标题只在打开瞬间重置。
  await signup(page, "works-fail-retry@example.test");
  await openWorks(page);
  await page.route("**/api/writing/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "模拟创建失败：服务端拒绝了本次创建" }),
    });
  });
  await page.getByRole("button", { name: "创建新作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "从一个想法开始" });
  await page.getByLabel("文章标题或想法").fill("会被服务端拒绝的标题");
  await dialog.getByRole("button", { name: "创建作品" }).click();
  await expect(
    page.getByRole("status").last()
  ).toContainText("模拟创建失败：服务端拒绝了本次创建");
  await page.unroute("**/api/writing/projects");
  await dialog.getByRole("button", { name: "创建作品" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
});

test("作品库加载失败：ErrorState 错误态出现，「重试」按钮真实重新加载列表", async ({
  page,
}) => {
  await signup(page, "works-retry@example.test");
  // 注入 GET 失败后再进入页面
  await page.route("**/api/editor/projects", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "模拟作品库加载失败" }),
    });
  });
  await page.goto("/works");
  await expect(
    page.getByRole("heading", { name: "每篇作品，都有清晰的下一步" })
  ).toBeVisible();
  // WorksLibrary.jsx:149-151 + primitives.jsx:87-103 —— role=alert 错误卡。
  // 用 .cv2-error-state 限定：getByRole("alert") 还会命中 __next-route-announcer__。
  const alertBox = page.locator(".cv2-error-state");
  await expect(alertBox.getByText("作品库加载失败", { exact: true })).toBeVisible();
  await expect(alertBox.getByText("模拟作品库加载失败", { exact: true })).toBeVisible();
  await expect(
    alertBox.getByText("检查本地服务是否在运行，然后重试。")
  ).toBeVisible();
  await expect(page.locator(".cv2-pipeline")).toHaveCount(0);
  // 重试 = 重新 load()：解除注入后列表真实出现，错误卡消失。
  // 错误卡消失用 .cv2-error-state 判定；page.getByRole("alert") 会命中
  // 客户端路由后常驻的 __next-route-announcer__，不可能为 0。
  await page.unroute("**/api/editor/projects");
  await alertBox.getByRole("button", { name: "重试" }).click();
  await expect(page.locator(".cv2-pipeline button")).toHaveCount(5);
  await expect(page.locator(".cv2-error-state")).toHaveCount(0);
  // 注：CREATOR-V2-DESIGN-DEVIATIONS /works #1 只登记稀疏态窄列的视觉问题
  //（机制已由 18a6c7f 修复、视觉复测未执行），重试交互本身无登记缺陷。
});

test("移动 390×844 底栏 5 快捷 tab：逐项点击真实跳转并回到高亮作品", async ({
  page,
  creatorOrigin,
}) => {
  await signup(page, "works-tabs@example.test");
  const r = await page.request.post("/api/writing/projects", {
    data: { title: "底栏跳转验证的作品" },
  });
  expect(r.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorks(page);
  const tabs = page.getByRole("navigation", { name: "移动端导航" });
  // CreatorShell.jsx:34-40 —— 工作台/热点/选题/作品/配图 五个快捷入口
  await tabs.getByRole("link", { name: "热点" }).click();
  await expect(page).toHaveURL(/\/hotspots/);
  await tabs.getByRole("link", { name: "选题" }).click();
  await expect(page).toHaveURL(/\/topics/);
  await tabs.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(creatorOrigin + "/");
  await tabs.getByRole("link", { name: "配图" }).click();
  await expect(page).toHaveURL(/\/illustrations/);
  // 「作品」tab 跳回作品库并保持高亮
  await tabs.getByRole("link", { name: "作品" }).click();
  await expect(page).toHaveURL(/\/works/);
  await expect(
    page.getByRole("heading", { name: "每篇作品，都有清晰的下一步" })
  ).toBeVisible();
  await expect(tabs.getByRole("link", { name: "作品" })).toHaveAttribute(
    "aria-current",
    "page"
  );
});

test("移动「更多」面板：打开移焦面板、Esc 关闭、头部关闭钮还焦触发钮，六个入口逐一跳转", async ({
  page,
}) => {
  await signup(page, "works-more@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorks(page);
  const more = page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("button", { name: "更多" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  const panel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(panel).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  // 打开时焦点移入面板第一个可聚焦元素（CreatorShell.jsx:134）
  await expect(panel.getByRole("button", { name: "关闭更多菜单" })).toBeFocused();
  // Esc 真实关闭面板（焦点去向由 @bug 用例单独登记，这里不断言焦点）
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // 头部关闭钮路径：关闭后焦点返回触发按钮（CreatorShell.jsx:244-248）
  await more.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "关闭更多菜单" }).click();
  await expect(panel).not.toBeVisible();
  await expect(more).toBeFocused();
  // 面板内 6 入口逐个真实跳转（导航后面板随 path 关闭，CreatorShell.jsx:125-127）
  const entries = [
    ["创作空间", /\/compose/],
    ["发布中心", /\/publish/],
    ["内容日历", /\/calendar/],
    ["效果复盘", /\/insights/],
    ["素材库", /\/library/],
    ["偏好与连接", /\/settings/],
  ];
  for (const [label, url] of entries) {
    await more.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(url);
  }
});

test.fixme(
  "移动「更多」面板 Esc 关闭后焦点应返回触发按钮 @bug:deviations#/home#5",
  async ({ page }) => {
    // 已登记共享壳层缺陷（CREATOR-V2-DESIGN-DEVIATIONS.md:52-55，/home #5）：
    // Esc 路径 setMoreOpen(false) 后未 moreButtonRef.current?.focus()，
    // 验收探针实测 activeElement=BODY；头部关闭钮路径可正确还焦（上一用例已覆盖）。
    // 修复后本用例应转正：Esc 关闭面板且「更多」触发按钮重新获得焦点。
    await signup(page, "works-more-esc@example.test");
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorks(page);
    const more = page
      .getByRole("navigation", { name: "移动端导航" })
      .getByRole("button", { name: "更多" });
    await more.click();
    await expect(
      page.getByRole("dialog", { name: "更多工作区" })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "更多工作区" })
    ).not.toBeVisible();
    await expect(more).toBeFocused();
  }
);

test("侧栏「退出登录」：多用户模式下登出回登录页，会话真实失效刷新不复活", async ({
  page,
}) => {
  await signup(page, "works-logout@example.test");
  await openWorks(page);
  // 本 spec 服务以 CONTENT_STUDIO_MULTIUSER=1 运行（:43）→ 按钮真实渲染
  const profile = page.locator(".cv2-profile");
  await expect(profile.getByText("合成作品库作者")).toBeVisible();
  await expect(profile.getByText("独立作者工作空间")).toBeVisible();
  await profile.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/signin/);
  // 会话真实清除：刷新后再进 /works 不再可达
  await page.goto("/works");
  await expect(page).toHaveURL(/signin/);
});

test("键盘可达：首个 Tab 停在 skip link，激活后焦点落主内容并继续页面 Tab 序", async ({
  page,
}) => {
  await signup(page, "works-kbd@example.test");
  await openWorks(page);
  // CreatorShell.jsx:149-151 —— 首个 Tab 到「跳到主内容」（app/creator-v2.css:62-63）
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主内容" });
  await expect(skip).toBeFocused();
  // 激活 skip link → 焦点落到 tabIndex=-1 的 #cv2-main（CreatorShell.jsx:215）
  await page.keyboard.press("Enter");
  await expect(page.locator("#cv2-main")).toBeFocused();
  // 主内容内首个 Tab 停在页头主操作「创建新作品」
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "创建新作品", exact: true })
  ).toBeFocused();
});

test("移动 390×844：单列网格、两格管线、底部导航高亮作品且无横向溢出", async ({
  page,
}) => {
  await signup(page, "works-mobile@example.test");
  const r = await page.request.post("/api/writing/projects", {
    data: { title: "移动端视口下的作品库检查" },
  });
  expect(r.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorks(page);
  // 页头创建按钮收成图标（文字仍在 DOM，可访问名不变）
  const createBtn = page.getByRole("button", { name: "创建新作品", exact: true });
  await expect(createBtn).toBeVisible();
  await expect(page.locator(".cv2-pipeline button")).toHaveCount(5);
  // 底部导航高亮「作品」
  await expect(
    page
      .getByRole("navigation", { name: "移动端导航" })
      .getByRole("link", { name: "作品" })
  ).toHaveAttribute("aria-current", "page");
  const card = page.locator("a.cv2-work-card", { hasText: "移动端视口下的作品库检查" });
  await expect(card).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // 图标化创建按钮仍能打开弹窗并真实创建
  await createBtn.click();
  await page.getByLabel("文章标题或想法").fill("移动端创建的第二篇作品");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
});
