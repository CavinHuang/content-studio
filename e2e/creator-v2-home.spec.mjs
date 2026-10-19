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
  await expect(continueLink).toHaveAttribute(/href/, /\/compose\?project=ep_/);
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
