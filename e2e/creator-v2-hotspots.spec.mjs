import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Creator V2 hotspot radar (/hotspots) e2e — real routes, real SQLite
// domain services, no fixtures and no demo metrics: an isolated
// worker-scoped production server (same pattern as
// e2e/creator-v2-works.spec.mjs / creator-v1.spec.mjs) runs with
// multiuser sessions and NO model configured. The RSS staging pipeline
// has no HTTP write path (items only arrive via publicRequest sync,
// src/creator.mjs:2055), so each test seeds its own author workspace
// SQLite with synthetic sources/items — the same direct-insert pattern
// the unit suite uses (test/creator-v1.test.mjs:57). Built-in seed
// sources are disabled in that workspace so network sync attempts stay
// deterministic inside the sandbox. Coverage per the page scope: real
// stream (title/source/sync time/original link), search + source chips,
// detail panel, honest NO heat/trend metrics, sources drawer with real
// sync status, honest refresh failure, convert-to-topic landing on
// /topics?topic=… with a persistent candidate (duplicate-safe), load
// failure with retry, and the 390×844 mobile bottom-sheet detail.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function listen(server) {
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
}

const test = base.extend({
  hotspotsEnv: [
    async ({}, use) => {
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-creator-hotspots-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "hotspots.sqlite"),
        CONTENT_STUDIO_DEPLOY_MODE: "",
        CONTENT_STUDIO_ALLOW_REMOTE: "0",
        // The 3s background scheduler would sync the six built-in public
        // sources for real (network-dependent, nondeterministic in CI and
        // it would race the test's own seeds). Tests drive sync explicitly
        // through the 刷新热点 button instead.
        CONTENT_STUDIO_WORKER_DISABLED: "1",
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
        if (!ready) throw Error("Hotspots server did not start " + logs);
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
  baseURL: async ({ hotspotsEnv }, use) => use(hotspotsEnv.origin),
});

async function signup(page, email) {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成热点作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

// Seed the signed-in author's workspace SQLite with two synthetic sources
// and four staged items (direct insert like test/creator-v1.test.mjs:57).
// Built-in cs_seed_* sources are disabled so the sandbox never performs
// real network syncs; the two fake .example sources keep last_run fresh
// so the background scheduler skips them too.
function seedWorkspace(root) {
  const wsDir = join(root, "workspaces");
  // 每个用例注册了新作者：刚注册作者的 studio.sqlite 拥有最新 mtime，
  // 不能用目录枚举顺序猜（readdir 顺序不保证创建顺序）。
  const ws = readdirSync(wsDir)
    .map((d) => join(wsDir, d, "studio.sqlite"))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!ws) throw Error("author workspace not found under " + wsDir);
  const db = new DatabaseSync(ws);
  db.exec("UPDATE creator_sources SET enabled=0 WHERE id LIKE 'cs_seed_%'");
  const insSource = db.prepare(
    "INSERT OR IGNORE INTO creator_sources(id,name,url,enabled,last_run,status) VALUES(?,?,?,1,?,?)"
  );
  const now = new Date().toISOString();
  insSource.run(
    "cs_hot_a",
    "合成信源甲 · 行业动态",
    "https://feeds.example-a.example/rss.xml",
    now,
    "暂存 2 条新条目"
  );
  insSource.run(
    "cs_hot_b",
    "合成信源乙 · 研究线索",
    "https://feeds.example-b.example/rss.xml",
    now,
    "暂存 2 条新条目"
  );
  const insItem = db.prepare(
    "INSERT OR IGNORE INTO creator_source_items(id,source_id,url,title,summary,published_at,synced_at) VALUES(?,?,?,?,?,?,?)"
  );
  insItem.run(
    "csitem_a1",
    "cs_hot_a",
    "https://example-a.example/post-1",
    "当 AI Agent 真正进入工作流，大家最关心的还是可控性",
    "讨论集中在任务失败后的恢复、权限边界和结果验证。",
    "2026-10-19T00:00:00Z",
    "2026-10-19T09:10:00Z"
  );
  insItem.run(
    "csitem_a2",
    "cs_hot_a",
    "https://example-a.example/post-2",
    "AI 产品的成本该如何向用户解释",
    "围绕按量收费、费用透明和产品留存展开。",
    "",
    "2026-10-19T09:11:00Z"
  );
  insItem.run(
    "csitem_b1",
    "cs_hot_b",
    "https://example-b.example/post-3",
    "开源 Agent 工作台开始重视可恢复的任务状态",
    "社区更关注版本、执行证据以及流程中断后的恢复路径。",
    "2026-10-18T15:00:00Z",
    "2026-10-19T09:12:00Z"
  );
  insItem.run(
    "csitem_b2",
    "cs_hot_b",
    "https://example-b.example/post-4",
    "内容创作者如何建立可持续的选题资料库",
    "围绕 RSS、来源管理和写作风格积累的实践经验。",
    "",
    "2026-10-18T08:00:00Z"
  );
  db.close();
}

async function openHotspots(page) {
  await page.goto("/hotspots");
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();
}

test("桌面 1440×900：真实信源流、搜索/来源筛选、详情面板，且无虚构热度指标", async ({
  page,
  hotspotsEnv,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "hotspots-desktop@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);

  // masthead 两个真实计数：4 条线索 / 0 关注
  await expect(page.locator(".cv2-hot-summary div").first()).toContainText("04");
  await expect(page.locator(".cv2-hot-summary div").nth(1)).toContainText("00");
  // 监控带 + 流程线
  await expect(page.getByText("来源更新时间", { exact: true })).toBeVisible();
  await expect(page.getByText("最近一次同步", { exact: false })).toBeVisible();
  await expect(page.getByText("01 热点监控", { exact: false })).toBeVisible();
  // 来源 chip 来自真实信源
  await expect(
    page.getByRole("button", { name: "合成信源甲 · 行业动态" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "合成信源乙 · 研究线索" })
  ).toBeVisible();
  // 行内真实字段：标题 / 来源 / 同步时间 / 原文链接（按同步时间倒序，
  // 最新一条是 09:12 的乙源条目）
  const firstRow = page.locator(".cv2-hot-row").first();
  await expect(firstRow).toContainText("开源 Agent 工作台开始重视可恢复的任务状态");
  await expect(firstRow).toContainText("来源：合成信源乙 · 研究线索");
  await expect(firstRow).toContainText(/同步 (今天|10 月)/);
  await expect(
    firstRow.getByRole("link", { name: "原文链接" })
  ).toHaveAttribute("href", "https://example-b.example/post-3");
  // 无可信计算依据 → 页面不出现趋势/热度演示指标（说明文案可以解释“为什么不展示”）
  await expect(page.getByText("升温中")).toHaveCount(0);
  await expect(page.getByText("新出现")).toHaveCount(0);
  await expect(page.getByText("持续讨论")).toHaveCount(0);
  await expect(page.locator(".cv2-hot-trend")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /与我相关/ })).toHaveCount(0);

  // 详情面板：默认第一条；点「当 AI Agent…」切换后 href/来源随之更新
  await expect(page.locator(".cv2-hot-right")).toContainText(
    "开源 Agent 工作台开始重视可恢复的任务状态"
  );
  await page
    .getByRole("button", { name: "当 AI Agent 真正进入工作流，大家最关心的还是可控性", exact: true })
    .click();
  await expect(page.locator(".cv2-hot-right")).toContainText(
    "当 AI Agent 真正进入工作流"
  );
  await expect(
    page.locator(".cv2-hot-right").getByRole("link", { name: /打开原文/ })
  ).toHaveAttribute("href", "https://example-a.example/post-1");
  await expect(page.locator(".cv2-hot-evidence")).toContainText("未验证");
  await expect(page.locator(".cv2-hot-evidence")).toContainText(
    "合成信源甲 · 行业动态"
  );

  // 搜索：真实字段上的本地过滤
  await page.getByLabel("搜索热点").fill("费用透明");
  await expect(page.locator(".cv2-hot-row")).toHaveCount(1);
  await expect(page.locator(".cv2-hot-row").first()).toContainText(
    "AI 产品的成本该如何向用户解释"
  );
  await page.getByLabel("搜索热点").fill("");

  // 来源 chip：服务端 ?source= 过滤（乙源两条，甲源两条；甲源最新是 09:11 的成本条目）
  await page.getByRole("button", { name: "合成信源乙 · 研究线索" }).click();
  await expect(page.locator(".cv2-hot-row")).toHaveCount(2);
  await expect(page.locator(".cv2-hot-row").first()).toContainText(
    "开源 Agent 工作台"
  );
  await page.getByRole("button", { name: "合成信源甲 · 行业动态" }).click();
  await expect(page.locator(".cv2-hot-row")).toHaveCount(2);
  await expect(page.locator(".cv2-hot-row").first()).toContainText(
    "AI 产品的成本该如何向用户解释"
  );
  await page.getByRole("button", { name: "全部来源" }).click();
  await expect(page.locator(".cv2-hot-row")).toHaveCount(4);

  // 关注（会话态）→ 我关注的 tab + 计数 01
  await page
    .getByRole("button", { name: "关注话题：当 AI Agent 真正进入工作流" })
    .click();
  await expect(page.locator(".cv2-hot-summary div").nth(1)).toContainText("01");
  await page.getByRole("button", { name: "我关注的" }).click();
  await expect(page.locator(".cv2-hot-row")).toHaveCount(1);
  await page.getByRole("button", { name: "全部热点" }).click();

  // 管理信源抽屉：真实状态与开关（切换后 aria-label 会变，用行内稳定定位）
  await page.getByRole("button", { name: "管理信源" }).click();
  const drawer = page.getByRole("dialog", { name: "信源与参考素材" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("暂存 2 条新条目");
  const rowA = drawer.locator(".cv2-source-item", { hasText: "合成信源甲 · 行业动态" });
  const switchA = rowA.getByRole("switch");
  await expect(switchA).toHaveAttribute("aria-checked", "true");
  await switchA.click();
  await expect(switchA).toHaveAttribute("aria-checked", "false");
  await expect(switchA).toHaveAttribute("aria-label", "启用信源 合成信源甲 · 行业动态");
  await drawer.getByRole("button", { name: "完成" }).click();
  await expect(drawer).toBeHidden();

  expect(errors).toEqual([]);
});

test("刷新热点：网络不可用时诚实报告失败并保留既有条目，不伪造成功", async ({
  page,
  hotspotsEnv,
}) => {
  test.setTimeout(90_000);
  await signup(page, "hotspots-refresh@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  await page
    .getByRole("button", { name: /刷新热点/ })
    .click();
  // 两个 .example 信源都无法读取（沙箱无外网），状态必须如实失败
  await expect(page.getByRole("status")).toContainText(
    /同步失败.*已保留现有条目/s,
    { timeout: 60_000 }
  );
  // 既有条目仍在，未被清空或替换成演示数据
  await expect(page.locator(".cv2-hot-row").first()).toContainText(
    "开源 Agent 工作台"
  );
});

test("收为选题候选：真实持久化为选题并跳转 /topics 打开该候选；重复收起不新建", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-convert@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  const title = "当 AI Agent 真正进入工作流，大家最关心的还是可控性";
  await page
    .getByRole("button", { name: `收为选题候选：${title}` })
    .click();
  await expect(page).toHaveURL(/\/topics\?topic=tp_/);
  // 选题页直接打开该候选：简报标题 = 条目标题，来源可追溯（热点雷达转入）
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(title);
  await expect(page.getByText(/热点雷达转入 · 合成信源甲/).first()).toBeVisible();
  // 服务端持久化证据：选题带 material 引用（原文 URL 在素材上）
  const topics = await (
    await page.request.get("/api/creator/topics")
  ).json();
  const topic = topics.topics.find((t) => t.title === title);
  expect(topic).toBeTruthy();
  expect(topic.refs).toHaveLength(1);
  expect(topic.refs[0].kind).toBe("material");
  const material = await (
    await page.request.get("/api/creator/materials/" + topic.refs[0].id)
  ).json();
  expect(material.url).toBe("https://example-a.example/post-1");

  // 重复收起：回到热点页再次转换 → 打开同一候选，不新建
  await page.goto("/hotspots");
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();
  await page.getByRole("button", { name: `收为选题候选：${title}` }).click();
  await expect(page).toHaveURL(new RegExp("/topics\\?topic=" + topic.id));
  const again = await (await page.request.get("/api/creator/topics")).json();
  expect(again.topics.filter((t) => t.title === title)).toHaveLength(1);
});

test("加载失败：网络错误显示可重试的错误态；空信源条目给出诚实空态", async ({
  page,
}) => {
  await signup(page, "hotspots-empty@example.test");
  // 未注入任何条目：真实空态（信源存在——内置种子，但还没有同步条目）
  await page.goto("/hotspots");
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
  await expect(page.locator(".cv2-hot-empty")).toContainText(
    "信源还没有同步到条目"
  );
  await expect(page.locator(".cv2-hot-summary div").first()).toContainText("00");

  // 请求层故障 → 错误态 + 重试恢复
  await page.route("**/api/creator/source-items**", (route) => route.abort());
  await page.goto("/hotspots");
  await expect(page.getByText("热点雷达加载失败")).toBeVisible({ timeout: 15_000 });
  await page.unroute("**/api/creator/source-items**");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.locator(".cv2-hot-empty")).toContainText(
    "信源还没有同步到条目",
    { timeout: 15_000 }
  );
});

test("移动 390×844：无横向溢出，点条目弹出底部详情抽屉并可关闭", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-mobile@example.test");
  seedWorkspace(hotspotsEnv.root);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hotspots");
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(0);
  // 桌面右栏在移动端隐藏；点条目 → 底部抽屉
  await expect(page.locator(".cv2-hot-right")).toBeHidden();
  await page
    .getByRole("button", { name: "开源 Agent 工作台开始重视可恢复的任务状态", exact: true })
    .click();
  const sheet = page.locator(".cv2-hot-right.is-open");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("开源 Agent 工作台开始重视可恢复的任务状态");
  await expect(sheet.getByRole("button", { name: /收为选题候选/ })).toBeVisible();
  // 遮罩关闭
  await page.getByRole("button", { name: "关闭热点详情" }).last().click();
  await expect(sheet).toBeHidden();
  // 底部导航高亮「热点」
  await expect(
    page.locator(".cv2-mobile-tabs a[aria-current='page']")
  ).toHaveText(/热点/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(0);
});
