import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  monthLabel,
  todayKey,
  weekdayLabel,
  dayLabel,
  isoToDayKey,
  weekOf,
} from "../src/calendar-view.mjs";

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
//
// 2026-10 审计缺口补齐（既有用例保持不动，在其后扩展）：上一/下一周期
// 与「今天」重置；安排弹窗「取消」与保存失败（注入 500）的弹窗内错误与
// 恢复；调整系列安排弹窗 Esc/「取消」、间隔天数 1–365 边界门槛、409 时
// 弹窗内「系列已变化」提示；当日安排/系列/作品区/完成条的全部跳转真实
// 落地（去选题/打开作品/去系列/去作品库/全部作品/继续创作/查看待交付
// 内容/去规划系列）；壳层「跳到主内容」skip link、顶栏看热点/新建作品、
// 受管模式退出登录、侧栏 11 工作区导航高亮；移动端快捷 tab 逐个跳转与
// 「更多」面板头部「关闭」还焦。已知缺陷（Esc 关「更多」面板不还焦，
// CREATOR-V2-DESIGN-DEVIATIONS.md /home #5 + FEATURE-MATRIX 横切 #1）
// 按登记写为 test.fixme，不断言会失败的行为。

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

test("桌面：上一/下一周期切换周与月周期，「今天」重置周期与选中日", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-step@example.test");
  await page.request.post("/api/creator/topics", {
    data: { title: "周期切换验证计划", targetDate: today, reason: "内容日历排期计划" },
  });
  await openCalendar(page);

  const step = page.getByRole("group", { name: "切换周期" });
  const weekRegion = page.getByRole("region", { name: "本周安排" });
  const pill = page.locator(".cv2-insight-bar .v2-pill");
  const rangeOf = (keys) => `${dayLabel(keys[0])} — ${dayLabel(keys[6])}`;
  await expect(weekRegion.locator(".cv2-section-top p").first()).toHaveText(rangeOf(weekOf(today)));
  await expect(pill).toHaveText("1 项计划");

  // 先选中本周另一天，稍后用「今天」验证选中日一并重置
  const other = weekOf(today).find((k) => k !== today);
  await dayButton(page, other).click();
  await expect(
    page.getByRole("region", { name: "当日安排" }).getByRole("heading", { name: dayLabel(other) + "的安排" })
  ).toBeVisible();

  // 下一周期 → 下周：今天的计划移出视野，计数归零
  await step.getByRole("button", { name: "下一周期" }).click();
  await expect(weekRegion.locator(".cv2-section-top p").first()).toHaveText(rangeOf(weekOf(addDays(today, 7))));
  await expect(pill).toHaveText("暂无排期");

  // 上一周期两次 → 上周
  await step.getByRole("button", { name: "上一周期" }).click();
  await step.getByRole("button", { name: "上一周期" }).click();
  await expect(weekRegion.locator(".cv2-section-top p").first()).toHaveText(rangeOf(weekOf(addDays(today, -7))));

  // 「今天」：周期与选中日一起回到今天
  await step.getByRole("button", { name: "今天" }).click();
  await expect(weekRegion.locator(".cv2-section-top p").first()).toHaveText(rangeOf(weekOf(today)));
  await expect(dayButton(page, today)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("region", { name: "当日安排" }).getByRole("heading", { name: dayLabel(today) + "的安排" })
  ).toBeVisible();
  await expect(pill).toHaveText("1 项计划");

  // 月视图共用同一组切换按钮：步进一个月
  await page.getByRole("group", { name: "日历视图" }).getByRole("button", { name: "月视图" }).click();
  const shiftMonthKey = (key, dir) => {
    const [y, m] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + dir, 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-01`;
  };
  await step.getByRole("button", { name: "下一周期" }).click();
  await expect(page.getByRole("group", { name: monthLabel(shiftMonthKey(today, 1)) + "月历" })).toBeVisible();
  await expect(page.locator(".cv2-insight-bar span").first()).toHaveText(monthLabel(shiftMonthKey(today, 1)));
  await expect(pill).toHaveText("暂无排期");
  await step.getByRole("button", { name: "今天" }).click();
  await expect(page.getByRole("group", { name: monthLabel(today) + "月历" })).toBeVisible();
  await expect(pill).toHaveText("1 项计划");
});

test("桌面：安排弹窗「取消」关闭；保存失败弹窗内报错且不关，解除故障后可保存并持久化", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-modal@example.test");
  await openCalendar(page);

  await page.getByRole("button", { name: "安排内容" }).click();
  const dialog = page.getByRole("dialog", { name: "安排下一篇" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).not.toBeVisible();

  // 真实故障注入：服务端 500 → 弹窗内错误提示，弹窗保持打开
  await page.route("**/api/creator/topics", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "合成故障：保存服务暂不可用" }),
    })
  );
  await page.getByRole("button", { name: "安排内容" }).click();
  await page.getByLabel("内容主题").fill("先失败一次的排期计划");
  await page.getByLabel("目标日期").fill(today);
  await dialog.getByRole("button", { name: /保存计划/ }).click();
  await expect(dialog.locator(".cv2-status.is-error")).toContainText("合成故障：保存服务暂不可用");
  await expect(dialog).toBeVisible();

  // 解除故障后同一弹窗可完成保存：真实落库，刷新后仍在
  await page.unroute("**/api/creator/topics");
  await dialog.getByRole("button", { name: /保存计划/ }).click();
  await expect(page.getByRole("status").last()).toContainText("已加入内容日历");
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "当日安排" }).getByText("先失败一次的排期计划")
  ).toBeVisible();
});

test("桌面：调整系列安排 Esc 与「取消」关闭弹窗且不落库；间隔天数非法时禁用保存", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-series-modal@example.test");
  const runAt = new Date(Date.parse(today + "T04:00:00.000Z") + 86400000).toISOString();
  const series = await (
    await page.request.post("/api/creator/series", {
      data: { name: "弹窗门槛验证系列", goal: "持续核对弹窗行为", cadenceDays: 7, nextRunAt: runAt },
    })
  ).json();
  expect(series.id).toMatch(/^sr_/);
  await openCalendar(page);

  const card = page.getByRole("region", { name: "长期内容系列" });
  await card.getByRole("button", { name: "调整安排" }).click();
  const dialog = page.getByRole("dialog", { name: "调整系列安排" });
  const save = dialog.getByRole("button", { name: "保存安排" });
  const cadence = page.getByLabel("准备间隔天数");
  await expect(dialog).toBeVisible();

  // 间隔天数边界门槛：<1、>365、非整数都禁用保存；1/365 合法
  for (const [value, enabled] of [["0", false], ["1", true], ["365", true], ["366", false], ["2.5", false]]) {
    await cadence.fill(value);
    if (enabled) await expect(save).toBeEnabled();
    else await expect(save).toBeDisabled();
  }

  // Esc 关闭（此前 e2e 只覆盖排期弹窗的 Esc 路径）
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  // 重新打开后「取消」同样关闭
  await card.getByRole("button", { name: "调整安排" }).click();
  await expect(dialog).toBeVisible();
  await expect(cadence).toHaveValue("7"); // 重开后回到当前真实值
  await cadence.fill("99");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).not.toBeVisible();

  const after = await (await page.request.get("/api/creator/series/" + series.id)).json();
  expect(after.revision).toBe(1); // Esc/取消只是关窗，不产生服务端写入
  expect(after.cadenceDays).toBe(7);
});

test("桌面：调整安排提交遇 409（系列已变化）→ 弹窗内提示重新打开，服务端无部分写入", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-series-409@example.test");
  const runAt = new Date(Date.parse(today + "T04:00:00.000Z") + 86400000).toISOString();
  const series = await (
    await page.request.post("/api/creator/series", {
      data: { name: "修订冲突验证系列", goal: "验证 expectedRevision 冲突的 UI 路径", cadenceDays: 7, nextRunAt: runAt },
    })
  ).json();
  await openCalendar(page);
  const card = page.getByRole("region", { name: "长期内容系列" });
  await card.getByRole("button", { name: "调整安排" }).click();
  const dialog = page.getByRole("dialog", { name: "调整系列安排" });
  await expect(dialog).toBeVisible();

  // 弹窗打开期间，系列被另一处真实更新一次（revision +1）
  const current = await (await page.request.get("/api/creator/series/" + series.id)).json();
  const bump = await page.request.put("/api/creator/series/" + series.id, {
    data: { expectedRevision: current.revision, cadenceDays: 2 },
  });
  expect(bump.ok()).toBeTruthy();

  // 旧弹窗仍持旧 revision：保存 → 真实 409 → 弹窗内可操作提示（此前仅 API 层验证）
  await dialog.getByRole("button", { name: "保存安排" }).click();
  await expect(dialog.locator(".cv2-status.is-error")).toContainText("系列已变化，请重新打开后调整");
  await expect(dialog).toBeVisible();

  const after = await (await page.request.get("/api/creator/series/" + series.id)).json();
  expect(after.revision).toBe(current.revision + 1); // 冲突保存没有部分写入
  expect(after.cadenceDays).toBe(2);
});

test("桌面：当日安排与页面区块的跳转全部真实落地（去选题/打开作品/去系列/去作品库/全部作品/继续创作/查看待交付内容）", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-links@example.test");
  const plain = await (
    await page.request.post("/api/creator/topics", {
      data: { title: "链接验证：去选题的排期", targetDate: today, reason: "内容日历排期计划" },
    })
  ).json();
  const linked = await (
    await page.request.post("/api/creator/topics", {
      data: { title: "链接验证：已开作品的排期", targetDate: today, reason: "内容日历排期计划" },
    })
  ).json();
  // startTopic：真实建项目并关联选题（projectId），状态进入创作中
  const started = await page.request.post(
    `/api/creator/topics/${linked.id}/start`,
    { data: {} } // 写请求必须携带 JSON body（V58 边界契约，同 UI send）
  );
  expect(started.ok()).toBeTruthy();
  const runAt = new Date(Date.parse(today + "T04:00:00.000Z")).toISOString(); // 今天 12:00 上海
  const series = await (
    await page.request.post("/api/creator/series", {
      data: { name: "链接验证系列", goal: "验证去系列跳转", cadenceDays: 7, nextRunAt: runAt },
    })
  ).json();
  expect(series.id).toMatch(/^sr_/);

  await openCalendar(page);
  const detail = page.getByRole("region", { name: "当日安排" });
  await expect(detail.getByText("链接验证：去选题的排期")).toBeVisible();
  await expect(detail.getByText("链接验证：已开作品的排期")).toBeVisible();

  // 未关联作品的排期选题 → 去选题 → /topics?topic=tp_…
  await detail.getByRole("link", { name: "去选题" }).click();
  await expect(page).toHaveURL("/topics?topic=" + plain.id);
  await expect(page.getByRole("heading", { name: "选题发现" })).toBeVisible();

  // 已关联作品的排期选题 → 打开作品 → /compose?project=ep_…
  await page.goto("/calendar");
  await page.getByRole("region", { name: "当日安排" }).getByRole("link", { name: "打开作品" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  const projectId = new URL(page.url()).searchParams.get("project");

  // 系列事件 → 去系列 → /topics?view=series
  await page.goto("/calendar");
  await page.getByRole("region", { name: "当日安排" }).getByRole("link", { name: "去系列" }).click();
  await expect(page).toHaveURL(/\/topics\?view=series$/);
  await expect(page.getByRole("heading", { name: "选题发现" })).toBeVisible();

  // 当日安排头部 → 去作品库 → /works
  await page.goto("/calendar");
  await page.getByRole("region", { name: "当日安排" }).getByRole("link", { name: "去作品库" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await expect(page.getByRole("heading", { name: "每篇作品，都有清晰的下一步" })).toBeVisible();

  // 未排期作品区 → 全部作品 → /works；继续创作 → /compose?project=…
  await page.goto("/calendar");
  const works = page.getByRole("region", { name: "未排期的进行中作品" });
  await expect(works.getByText("链接验证：已开作品的排期")).toBeVisible();
  await works.getByRole("link", { name: "全部作品" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await page.goto("/calendar");
  await page
    .getByRole("region", { name: "未排期的进行中作品" })
    .getByRole("link", { name: "继续创作" })
    .click();
  await expect(page).toHaveURL("/compose?project=" + encodeURIComponent(projectId));

  // 完成条 → 查看待交付内容 → /publish
  await page.goto("/calendar");
  await page.getByRole("link", { name: "查看待交付内容" }).click();
  await expect(page).toHaveURL(/\/publish$/);
  await expect(page.getByRole("heading", { name: "发布之前，再确认一次" })).toBeVisible();
});

test("桌面：系列空态「去规划系列」与壳层次级入口（跳到主内容、看热点、新建作品）", async ({ page }) => {
  await signup(page, "calendar-shell@example.test");
  await openCalendar(page);

  // 系列空态 CTA → /topics?view=series
  await page.getByRole("link", { name: "去规划系列" }).click();
  await expect(page).toHaveURL(/\/topics\?view=series$/);
  await expect(page.getByRole("heading", { name: "选题发现" })).toBeVisible();

  // skip link：首个 Tab 聚焦「跳到主内容」，Enter 后主内容获焦
  await page.goto("/calendar");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主内容" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cv2-main")).toBeFocused();

  // 顶栏次级入口：看热点 → /hotspots；新建作品 → /create（legacy 深链）
  await page.getByRole("link", { name: "看热点" }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await page.goto("/calendar");
  await page.getByRole("link", { name: "新建作品" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("navigation", { name: "面包屑" })).toContainText("新建作品");
});

test("桌面：侧栏 11 个工作区导航逐个跳转且高亮随路径移动，受管模式可退出登录", async ({ page }) => {
  await signup(page, "calendar-nav@example.test");
  await openCalendar(page);
  const primary = page.getByRole("navigation", { name: "创作导航" });
  const prefer = page.getByRole("navigation", { name: "偏好导航" });
  await expect(primary.getByRole("link")).toHaveCount(10);
  await expect(prefer.getByRole("link")).toHaveCount(1);
  await expect(primary.getByRole("link", { name: "内容日历" })).toHaveAttribute("aria-current", "page");

  const entries = [
    ["工作台", /\/$/],
    ["热点雷达", /\/hotspots$/],
    ["选题发现", /\/topics$/],
    ["创作空间", /\/compose$/],
    ["视觉工作台", /\/illustrations$/],
    ["作品", /\/works$/],
    ["发布中心", /\/publish$/],
    ["效果复盘", /\/insights$/],
    ["素材库", /\/library$/],
  ];
  for (const [label, pattern] of entries) {
    await primary.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(pattern);
    await expect(primary.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await prefer.getByRole("link", { name: "偏好与连接" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(prefer.getByRole("link", { name: "偏好与连接" })).toHaveAttribute("aria-current", "page");

  // 回到内容日历，高亮回归本页
  await primary.getByRole("link", { name: "内容日历" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(primary.getByRole("link", { name: "内容日历" })).toHaveAttribute("aria-current", "page");

  // 受管模式（CONTENT_STUDIO_MULTIUSER=1）作者可退出登录并回到登录页
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/signin/);
  await expect(page.getByRole("heading", { name: "回到你的创作空间" })).toBeVisible();
});

test("移动 390×844：「更多」面板头部「关闭」可关且焦点返还触发按钮；底部 5 个快捷 tab 逐个跳转", async ({ page }) => {
  await signup(page, "calendar-mobile-shell@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);
  const tabs = page.getByRole("navigation", { name: "移动端导航" });
  const moreButton = tabs.getByRole("button", { name: "更多" });

  // 头部「关闭」按钮路径：面板消失且焦点返还「更多」触发按钮
  await moreButton.click();
  const panel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "关闭更多菜单" }).click();
  await expect(panel).not.toBeVisible();
  await expect(moreButton).toBeFocused();

  // 底部 5 个快捷 tab：逐个真实跳转，高亮随路径移动
  const quick = [
    ["工作台", /\/$/],
    ["热点", /\/hotspots$/],
    ["选题", /\/topics$/],
    ["作品", /\/works$/],
    ["配图", /\/illustrations$/],
  ];
  for (const [label, pattern] of quick) {
    await tabs.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(pattern);
    await expect(tabs.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
});

test.fixme("移动：「更多」面板 Esc 关闭后焦点未返回「更多」触发按钮 @bug:deviations#5", async ({ page }) => {
  // 缺陷登记：CREATOR-V2-DESIGN-DEVIATIONS.md /home #5（功能缺陷登记）+
  // CREATOR-V2-FEATURE-MATRIX.md 横切 #1。Esc 分支只 setMoreOpen(false)
  // （components/CreatorShell.jsx:128-136），未像头部「关闭」按钮路径
  // （CreatorShell.jsx:244-248）那样调用 moreButtonRef.current?.focus()，
  // 实测 Esc 后 activeElement=BODY；面板底部锚定，Esc 后的后续点击不能
  // 证明面板已关，故 Esc 关闭本身也在此一并显式断言。修复后取消 fixme
  // 并补回末尾的还焦断言。
  await signup(page, "calendar-mobile-esc@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);
  const moreButton = page.getByRole("navigation", { name: "移动端导航" }).getByRole("button", { name: "更多" });
  await moreButton.click();
  const panel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  // TODO(@bug:deviations#5)：修复后应断言 await expect(moreButton).toBeFocused()；
  // 当前 Esc 路径不还焦，该断言会失败，故整条用例保持 fixme。
});

test("移动 390×844：当日安排「去选题/打开作品」与未排期作品「继续创作」真实落地", async ({ page }) => {
  const today = todayKey();
  await signup(page, "calendar-mobile-links@example.test");
  const plain = await (
    await page.request.post("/api/creator/topics", {
      data: { title: "移动端去选题的排期", targetDate: today, reason: "内容日历排期计划" },
    })
  ).json();
  const linked = await (
    await page.request.post("/api/creator/topics", {
      data: { title: "移动端已开作品的排期", targetDate: today, reason: "内容日历排期计划" },
    })
  ).json();
  const started = await page.request.post(`/api/creator/topics/${linked.id}/start`, {
    data: {}, // 写请求必须携带 JSON body（V58 边界契约，同 UI send）
  });
  expect(started.ok()).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);
  const detail = page.getByRole("region", { name: "当日安排" });
  await expect(detail.getByText("移动端去选题的排期")).toBeVisible();

  // 去选题 → /topics?topic=tp_…
  await detail.getByRole("link", { name: "去选题" }).click();
  await expect(page).toHaveURL("/topics?topic=" + plain.id);

  // 打开作品 → /compose?project=ep_…
  await page.goto("/calendar");
  await page.getByRole("region", { name: "当日安排" }).getByRole("link", { name: "打开作品" }).click();
  await expect(page).toHaveURL(/\/compose\?project=ep_/);
  const projectId = new URL(page.url()).searchParams.get("project");

  // 未排期作品区 继续创作 → 同一 ep_ 作品
  await page.goto("/calendar");
  await page
    .getByRole("region", { name: "未排期的进行中作品" })
    .getByRole("link", { name: "继续创作" })
    .click();
  await expect(page).toHaveURL("/compose?project=" + encodeURIComponent(projectId));
});

