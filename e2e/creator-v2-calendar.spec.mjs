import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDays, todayKey, weekdayLabel, dayLabel, isoToDayKey } from "../src/calendar-view.mjs";

// Creator V2 calendar (/calendar) e2e — real routes, real SQLite domain
// services, no fixtures: an isolated worker-scoped production server
// (same pattern as e2e/creator-v2-library.spec.mjs) runs with multiuser
// sessions and NO model/image provider configured.
// Coverage per the page scope: the honest empty state (no fabricated
// events, no default dates), the shared week/month toolbar (fixed
// prototype bug: the toolbar must survive the month view), scheduling a
// real topic through POST /api/creator/topics with an author-chosen
// targetDate (persisted, visible in both views, honest "计划非发布" lab
// els), the 长期内容系列 card over a REAL series with 调整安排 moving
// next_run_at through PUT /api/creator/series/:id (expectedRevision),
// unscheduled works listed honestly OUTSIDE the calendar grid, the
// actionable error state when the overview API fails, and the 390×844
// mobile layout without horizontal overflow.

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
      const root = mkdtempSync(join(tmpdir(), "studio-creator-calendar-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "calendar.sqlite"),
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
        if (!ready) throw Error("Calendar server did not start " + logs);
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
  await page.getByLabel("作者名称", { exact: true }).fill("合成日历作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

async function openCalendar(page) {
  await page.goto("/calendar");
  await expect(
    page.getByRole("heading", { name: "把创作节奏，安排得从容一点" })
  ).toBeVisible();
}

const dayButton = (page, key) =>
  page.getByRole("button", { name: new RegExp(`^${escapeRegExp(dayLabel(key))} ${weekdayLabel(key)}，`) });

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("空日历：诚实空态、共用工具栏与安排弹窗门槛，无捏造事件", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-empty@example.test");
  await openCalendar(page);

  // 工具栏：周/月分段 + 真实计数 pill（空数据=暂无排期）
  const segments = page.getByRole("group", { name: "日历视图" });
  await expect(segments.getByRole("button", { name: "周视图" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cv2-insight-bar .v2-pill")).toHaveText("暂无排期");

  // 周视图 7 日条 + 当日安排诚实空态
  const week = page.getByRole("group", { name: "本周日程" });
  await expect(week.getByRole("button")).toHaveCount(7);
  await expect(dayButton(page, today)).toHaveAttribute("aria-pressed", "true");
  const detail = page.getByRole("region", { name: "当日安排" });
  await expect(detail.getByText("还没有已排定的计划", { exact: false })).toBeVisible();

  // 无捏造事件、无系列、无未排期作品区
  await expect(page.locator(".cv2-day-event")).toHaveCount(0);
  await expect(page.getByText("还没有长期内容系列", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "未排期的进行中作品" })).toHaveCount(0);

  // 安排弹窗：标题与日期都必填（无默认发布日期），Esc 可关闭
  await page.getByRole("button", { name: "安排内容" }).click();
  const dialog = page.getByRole("dialog", { name: "安排下一篇" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("内容主题")).toBeFocused();
  await expect(page.getByLabel("目标日期")).toHaveValue(today); // 预填=当前选中日，作者可改
  await expect(dialog.getByRole("button", { name: /保存计划/ })).toBeDisabled();
  await page.getByLabel("目标日期").fill("");
  await page.getByLabel("内容主题").fill("桌面 AI 工作流的可靠性观察");
  await expect(dialog.getByRole("button", { name: /保存计划/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("排期选题真实落库：周视图事件、当日安排与月视图共用工具栏", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-schedule@example.test");
  await openCalendar(page);

  await page.getByRole("button", { name: "安排内容" }).click();
  const dialog = page.getByRole("dialog", { name: "安排下一篇" });
  await page.getByLabel("内容主题").fill("小而确定工具的选题计划");
  await page.getByLabel("目标日期").fill(today);
  await dialog.getByRole("button", { name: /保存计划/ }).click();
  await expect(page.getByRole("status").last()).toContainText("已加入内容日历");

  // 周视图：事件胶囊 + 当日安排列出真实计划（明确“计划日期，非发布日期”）
  const week = page.getByRole("group", { name: "本周日程" });
  await expect(week.getByRole("button", { name: new RegExp(escapeRegExp(dayLabel(today))) })).toContainText(
    "小而确定工具的选题计划"
  );
  const detail = page.getByRole("region", { name: "当日安排" });
  await expect(detail.getByText("小而确定工具的选题计划")).toBeVisible();
  await expect(detail.getByText("计划日期，非发布日期")).toBeVisible();
  await expect(detail.getByRole("link", { name: /去选题/ })).toBeVisible();

  // 服务端事实：targetDate 持久化在 SQLite 领域服务里
  const listed = await (await page.request.get("/api/creator/topics")).json();
  const topic = listed.topics.find((t) => t.title === "小而确定工具的选题计划");
  expect(topic.targetDate).toBe(today);

  // 月视图：工具栏常驻（原型 replace 缺陷修正）+ 事件胶囊 + 切换选中日
  await page.getByRole("group", { name: "日历视图" }).getByRole("button", { name: "月视图" }).click();
  // 当日安排区嵌在全月计划区内：胶囊用类名限定，避免严格模式双匹配
  await expect(page.getByRole("region", { name: "全月计划" }).locator(".cv2-month-event")).toHaveText(
    "小而确定工具的选题计划"
  );
  await expect(page.locator(".cv2-insight-bar .v2-pill")).toHaveText("1 项计划");
  // 点同月另一天（无事件）：选中态与安排行更新，事件只在已排期日出现
  const otherKey = [addDays(today, 1), addDays(today, -1)].find(
    (k) => k.slice(0, 7) === today.slice(0, 7)
  );
  await page
    .getByRole("group", { name: /月历/ })
    .getByRole("button", { name: new RegExp(`^${escapeRegExp(dayLabel(otherKey))}`) })
    .click();
  await expect(
    page.getByRole("region", { name: "当日安排" }).getByRole("heading", { name: dayLabel(otherKey) + "的安排" })
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "当日安排" }).getByText("还没有已排定的计划", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "当日安排" }).getByText("小而确定工具的选题计划")).toHaveCount(0);

  // 刷新后计划仍在（真实持久化，非会话态）：默认选中今天即可见
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "把创作节奏，安排得从容一点" })
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "当日安排" }).getByText("小而确定工具的选题计划")).toBeVisible();
});

test("长期内容系列：真实系列进卡与日历，调整安排经 expectedRevision 真实更新", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-series@example.test");
  // 真实建系列：下次准备日期放在本周内（Asia/Shanghai 语义）
  const runAt = new Date(Date.parse(today + "T04:00:00.000Z") + 86400000).toISOString(); // 明天 12:00 上海
  const series = await (
    await page.request.post("/api/creator/series", {
      data: {
        name: "独立开发者的真实工作流",
        goal: "持续输出可核对的工作流文章",
        cadenceDays: 7,
        nextRunAt: runAt,
      },
    })
  ).json();
  expect(series.id).toMatch(/^sr_/);
  const plannedKey = isoToDayKey(runAt, "Asia/Shanghai");

  await openCalendar(page);
  const card = page.getByRole("region", { name: "长期内容系列" });
  await expect(card.getByText("独立开发者的真实工作流")).toBeVisible();
  await expect(card.getByText("计划中", { exact: true })).toBeVisible();
  await expect(card.getByText(`下次准备 ${dayLabel(plannedKey)}`, { exact: false })).toBeVisible();

  // 系列准备是真实计划事件：周条出现“系列准备”胶囊，当日安排给出下一篇
  const seriesDay = dayButton(page, plannedKey);
  await expect(seriesDay).toContainText("系列准备 · 独立开发者的真实工作流");
  await seriesDay.click();
  const detail = page.getByRole("region", { name: "当日安排" });
  await expect(detail.getByText("系列准备", { exact: true })).toBeVisible();
  await expect(detail.getByText(/下一篇：/)).toBeVisible();

  // 调整安排：改到后天 + 间隔 3 天 → 真实 PUT，服务端 next_run_at 移动
  const adjusted = new Date(Date.parse(today + "T04:00:00.000Z") + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  await card.getByRole("button", { name: "调整安排" }).click();
  const dialog = page.getByRole("dialog", { name: "调整系列安排" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("下次准备日期").fill(adjusted);
  await page.getByLabel("准备间隔天数").fill("3");
  await dialog.getByRole("button", { name: "保存安排" }).click();
  await expect(page.getByRole("status").last()).toContainText("系列安排已更新");

  const after = await (await page.request.get("/api/creator/series/" + series.id)).json();
  expect(isoToDayKey(after.nextRunAt, after.timezone)).toBe(adjusted);
  expect(after.cadenceDays).toBe(3);
  // 页面数据刷新：新日期出现在系列卡
  await expect(card.getByText(`下次准备 ${dayLabel(adjusted)}`, { exact: false })).toBeVisible();

  // API 层修订冲突保护仍然生效：旧 revision 的调整必须 409
  const conflict = await page.request.put("/api/creator/series/" + series.id, {
    data: { expectedRevision: after.revision - 1, cadenceDays: 7 },
  });
  expect(conflict.status()).toBe(409);
});

test("未排期作品：真实作品只进诚实清单，不伪装成日历事件", async ({ page }) => {
  await signup(page, "calendar-works@example.test");
  await page.request.post("/api/writing/projects", {
    data: { title: "城市漫步写作实践" },
  });
  await openCalendar(page);
  const works = page.getByRole("region", { name: "未排期的进行中作品" });
  await expect(works.getByText("城市漫步写作实践")).toBeVisible();
  await expect(works.getByText("草稿中", { exact: true })).toBeVisible();
  await expect(works.getByRole("link", { name: /继续创作/ })).toBeVisible();
  // 作品没有排期字段：日历网格不出现任何事件
  await expect(page.locator(".cv2-day-event")).toHaveCount(0);
  await expect(page.locator(".cv2-insight-bar .v2-pill")).toHaveText("暂无排期");
});

test("概览接口失败：可操作错误与重试恢复", async ({ page }) => {
  await signup(page, "calendar-error@example.test");
  const overview = /\/api\/creator\/overview/;
  await page.route(overview, (route) => route.abort());
  await openCalendar(page);
  const alert = page.locator("div.cv2-error-state");
  await expect(alert).toContainText("内容日历加载失败");
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
  await page.unroute(overview);
  await alert.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("group", { name: "本周日程" })).toBeVisible();
});

test("移动 390×844：周/月视图无横向溢出，更多面板高亮内容日历", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-mobile@example.test");
  await page.request.post("/api/creator/topics", {
    data: { title: "移动端的排期计划", targetDate: today, reason: "内容日历排期计划" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("group", { name: "本周日程" }).getByRole("button")).toHaveCount(7);
  await expect(page.getByText("移动端的排期计划").first()).toBeVisible();

  await page.getByRole("group", { name: "日历视图" }).getByRole("button", { name: "月视图" }).click();
  const overflowMonth = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflowMonth).toBeLessThanOrEqual(0);

  // 底部导航：内容日历属于「更多」面板
  const moreNav = page.getByRole("navigation", { name: "移动端导航" });
  await moreNav.getByRole("button", { name: "更多" }).click();
  await expect(
    page.getByRole("dialog", { name: "更多工作区" }).getByRole("link", { name: "内容日历" })
  ).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");

  // 移动端也能完成安排
  await page.getByRole("button", { name: "安排内容" }).click();
  const dialog = page.getByRole("dialog", { name: "安排下一篇" });
  await page.getByLabel("内容主题").fill("移动端新计划");
  await page.getByLabel("目标日期").fill(today);
  await dialog.getByRole("button", { name: /保存计划/ }).click();
  await expect(page.getByRole("status").last()).toContainText("已加入内容日历");
});

