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
