import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 insights (/insights) e2e — real routes, real SQLite domain
// services, no fixtures: an isolated worker-scoped production server
// (same pattern as e2e/creator-v2-calendar.spec.mjs) with multiuser
// sessions and a loopback SYNTHETIC model (only the style-suggestion
// branch answers; no external calls).
// Coverage per the page scope: the honest empty state with the explicit
// 暂无已验证平台数据 banner and permanent 未连接平台统计 pill (no
// fabricated numbers — KPI shows —, not 0), recording a real 复盘 entry
// through POST /api/creator/projects/:id/metrics (KPI/trend/table update,
// persisted across reload, server-verifiable), style learning that only
// enters the profile through the author's explicit accept decision
// (decideStyle with expectedRevision; reject keeps the profile intact),
// the actionable error state, and the 390×844 mobile layout without
// horizontal overflow.

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
      const model = createServer(async (req, res) => {
        let raw = "";
        for await (const c of req) raw += c;
        const body = JSON.parse(raw),
          input = JSON.parse(body.messages.at(-1).content);
        // 仅回答画像提炼分支（合成数据，无外部调用）。
        const result = input.articles
          ? {
              tone: "自然直接",
              structure: "先例子后方法",
              avoid: "夸张的保证",
              length: "千字左右",
            }
          : { outline: "## 合成大纲", angle: "合成角度", audience: "合成读者" };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }],
            usage: { total_tokens: 12 },
          })
        );
      });
      const mp = await listen(model);
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-creator-insights-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "insights.sqlite"),
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
        if (!ready) throw Error("Insights server did not start " + logs);
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

async function signup(page, email) {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成复盘作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

async function openInsights(page) {
  await page.goto("/insights");
  await expect(
    page.getByRole("heading", { name: "发布后，让经验回到下一篇" })
  ).toBeVisible();
}

test("空数据：暂无已验证平台数据、未连接 pill 常驻，KPI 显示 — 而非伪造数字", async ({ page }) => {
  await signup(page, "insights-empty@example.test");
  await openInsights(page);

  // 数据来源声明 + 永久的未连接 pill（产品没有平台统计接入）。
  await expect(page.locator(".cv2-ins-note")).toContainText("没有连接任何平台的自动统计");
  const bar = page.locator(".cv2-ins-bar");
  await expect(bar.getByText("未连接平台统计")).toBeVisible();
  await expect(bar.getByRole("group", { name: "统计范围" }).getByRole("button", { name: "7 天" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(bar.getByText("选中的范围：7 天", { exact: false })).toBeVisible();

  // KPI：没有录入 → 阅读量/互动显示 —；已发表=0 是真实计数。
  const kpis = page.locator(".cv2-ins-kpis");
  await expect(kpis.locator(".cv2-surface").nth(0).locator("strong")).toHaveText("—");
  await expect(kpis.locator(".cv2-surface").nth(1).locator("strong")).toHaveText("—");
  await expect(kpis.locator(".cv2-surface").nth(2).locator("strong")).toHaveText("0");

  // 趋势区显式空态，不渲染任何柱子。
  await expect(page.getByText("暂无已验证平台数据")).toBeVisible();
  await expect(page.locator(".cv2-ins-trend")).toHaveCount(0);
  await expect(page.locator(".cv2-ins-table")).toHaveCount(0);

  // 风格学习空态 + 三张学习原则卡。
  await expect(page.getByText("还没有风格学习记录")).toBeVisible();
  const learning = page.locator(".cv2-learning");
  await expect(learning.locator("article")).toHaveCount(3);

  // 范围切换只改选中态与说明文本，不产生任何假数据。
  await page.getByRole("group", { name: "统计范围" }).getByRole("button", { name: "90 天" }).click();
  await expect(bar.getByText("选中的范围：90 天", { exact: false })).toBeVisible();
  await expect(page.locator(".cv2-ins-trend")).toHaveCount(0);
});

test("记录复盘真实落库：KPI/趋势/表格更新、服务端可核对、刷新与范围切换后仍在", async ({ page }) => {
  await signup(page, "insights-record@example.test");
  const project = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "城市漫步的复盘文章" },
    })
  ).json();
  expect(project.projectId).toMatch(/^ep_/);

  await openInsights(page);
  await page.getByRole("button", { name: "记录复盘数据" }).click();
  const dialog = page.getByRole("dialog", { name: "记录复盘数据" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("复盘作品")).toBeFocused();

  // 未选作品不能保存；Esc 可关闭。
  await expect(dialog.getByRole("button", { name: /保存复盘记录/ })).toBeEnabled();
  await dialog.getByRole("button", { name: /保存复盘记录/ }).click();
  await expect(dialog.getByText("请选择要复盘的作品")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  // 真实录入：公众号 阅读 2480 · 赞 126。
  await page.getByRole("button", { name: "记录复盘数据" }).click();
  await page.getByLabel("复盘作品").selectOption({ label: "城市漫步的复盘文章" });
  await page.getByLabel("复盘渠道").selectOption({ label: "微信公众号" });
  await page.getByLabel("阅读量").fill("2480");
  await page.getByLabel("点赞数").fill("126");
  await page.getByLabel("复盘备注").fill("开头的故事段被转发最多");
  await dialog.getByRole("button", { name: /保存复盘记录/ }).click();
  await expect(page.getByRole("status").last()).toContainText("复盘数据已保存");

  // KPI 更新（各渠道最新一次录入合计），趋势柱与记录表出现。
  const kpis = page.locator(".cv2-ins-kpis");
  await expect(kpis.locator(".cv2-surface").nth(0).locator("strong")).toHaveText("2,480");
  await expect(kpis.locator(".cv2-surface").nth(1).locator("strong")).toHaveText("126");
  await expect(page.locator(".cv2-ins-trend")).toHaveCount(1);
  await expect(page.locator(".cv2-ins-trend span")).toHaveCount(1);
  const row = page.locator(".cv2-ins-table tr").first();
  await expect(row.getByRole("link", { name: "城市漫步的复盘文章" })).toBeVisible();
  await expect(row.getByText("微信公众号", { exact: true })).toBeVisible();
  await expect(row.getByText("阅读 2,480")).toBeVisible();
  // 内容表现卡片的范围标注（toast 也含“人工录入”，此处限定卡片内）。
  await expect(
    page.locator(".cv2-ins-cols section").first().getByText("人工录入")
  ).toBeVisible();

  // 服务端事实：creator_metrics 里就是这条人工记录。
  const metrics = await (
    await page.request.get("/api/creator/projects/" + project.projectId + "/metrics")
  ).json();
  expect(metrics.metrics).toHaveLength(1);
  expect(metrics.metrics[0]).toMatchObject({ channel: "wechat", views: 2480, likes: 126 });

  // 刷新后仍在（真实持久化）；切到 90 天范围记录同样计入。
  await page.reload();
  await expect(kpis.locator(".cv2-surface").nth(0).locator("strong")).toHaveText("2,480");
  await page.getByRole("group", { name: "统计范围" }).getByRole("button", { name: "90 天" }).click();
  await expect(page.locator(".cv2-ins-trend span")).toHaveCount(1);
});

test("风格学习只来自作者确认：采纳写入画像、拒绝不影响画像、旧修订 409", async ({ page }) => {
  await signup(page, "insights-style@example.test");
  const project = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "风格观察的文章" },
    })
  ).json();

  // 真实提炼一条建议（环回合成模型，无外部调用）。
  const created = await (
    await page.request.post("/api/creator/style-suggestions", {
      data: { projectIds: [project.projectId], allowExternalAI: true },
    })
  ).json();
  expect(created.status).toBe("pending");

  await openInsights(page);
  const pendingCard = page.locator(".cv2-ins-suggest");
  await expect(pendingCard.getByText("表达语气", { exact: true })).toBeVisible();
  await expect(pendingCard.getByText("自然直接", { exact: true })).toBeVisible();
  await expect(pendingCard.getByText("依据：风格观察的文章", { exact: false })).toBeVisible();
  // 确认前画像不含建议内容。
  let profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.tone).toBe("");

  // 拒绝第二条建议：画像不受影响。
  const second = await (
    await page.request.post("/api/creator/style-suggestions", {
      data: { projectIds: [project.projectId], allowExternalAI: true },
    })
  ).json();
  void second;
  await page.reload();
  await page.locator(".cv2-ins-suggest").first().getByRole("button", { name: "暂不采纳" }).click();
  await expect(page.getByRole("status").last()).toContainText("已暂不采纳");
  await expect(page.getByText("已拒绝", { exact: true })).toBeVisible();
  profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.tone).toBe("");

  // 采纳第一条建议：画像真实更新（expectedRevision 冲突保护在 API 层验证）。
  await page.locator(".cv2-ins-suggest").first().getByRole("button", { name: "采纳到画像" }).click();
  await expect(page.getByRole("status").last()).toContainText("已按你确认的内容更新创作画像");
  await expect(page.getByText("已采纳", { exact: true })).toBeVisible();
  await expect(page.locator(".cv2-ins-suggest")).toHaveCount(0);
  profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.tone).toBe("自然直接");
  expect(profile.structure).toBe("先例子后方法");

  // API 层：旧 revision 的采纳必须 409（与页面共用同一保护）。
  const conflict = await page.request.post(
    "/api/creator/style-suggestions/" + created.id,
    { data: { action: "accept", expectedRevision: profile.revision - 1 } }
  );
  expect(conflict.status()).toBe(409);

  // 刷新后：已采纳偏好行保留（决策记录与依据可展开核对）。
  await page.reload();
  const acceptedRow = page.locator(".cv2-ins-pref").first();
  await expect(acceptedRow.getByText("已采纳", { exact: true })).toBeVisible();
  await acceptedRow.locator("summary").click();
  await expect(acceptedRow.getByText("依据：", { exact: false })).toBeVisible();
});

test("概览接口失败：可操作错误与重试恢复", async ({ page }) => {
  await signup(page, "insights-error@example.test");
  const insightsApi = /\/api\/creator\/insights/;
  await page.route(insightsApi, (route) => route.abort());
  await openInsights(page);
  const alert = page.locator("div.cv2-error-state");
  await expect(alert).toContainText("效果复盘加载失败");
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
  await page.unroute(insightsApi);
  await alert.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("暂无已验证平台数据")).toBeVisible();
});

test("移动 390×844：KPI 单列、无横向溢出、更多面板高亮效果复盘", async ({ page }) => {
  await signup(page, "insights-mobile@example.test");
  const project = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "移动端复盘的文章" },
    })
  ).json();
  await page.request.post("/api/creator/projects/" + project.projectId + "/metrics", {
    data: { channel: "zhihu", views: 520, likes: 31, comments: 9, note: "移动端核对" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openInsights(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // KPI 三卡纵向堆叠（设计 :118 单列）。
  const boxes = [];
  for (const el of await page.locator(".cv2-ins-kpis > div").all())
    boxes.push(await el.boundingBox());
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeGreaterThan(40);
  expect(boxes[0].x).toBeCloseTo(boxes[1].x, 0);

  // 真实数据可见；记录弹窗在移动端可完成。
  await expect(page.locator(".cv2-ins-trend span")).toHaveCount(1);
  await page.getByRole("button", { name: "记录复盘数据" }).click();
  const dialog = page.getByRole("dialog", { name: "记录复盘数据" });
  await page.getByLabel("复盘作品").selectOption({ label: "移动端复盘的文章" });
  await page.getByLabel("复盘渠道").selectOption({ label: "知乎" });
  await dialog.getByRole("button", { name: /保存复盘记录/ }).click();
  await expect(page.getByRole("status").last()).toContainText("复盘数据已保存");
  const overflowAfter = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflowAfter).toBeLessThanOrEqual(0);

  // 底部导航：效果复盘属于「更多」面板且高亮当前页。
  const moreNav = page.getByRole("navigation", { name: "移动端导航" });
  await moreNav.getByRole("button", { name: "更多" }).click();
  await expect(
    page.getByRole("dialog", { name: "更多工作区" }).getByRole("link", { name: "效果复盘" })
  ).toHaveAttribute("aria-current", "page");
});
