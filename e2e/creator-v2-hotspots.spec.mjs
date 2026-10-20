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
// Interaction-gap round (same file): real sidebar/topbar route entries,
// drawer Esc/overlay/auto-focus paths, keyboard reachability (skip link +
// Tab/Enter row activation), the inline 查看详情与原文 control, the
// detail-panel 关注/收为候选 buttons, the /topics links, real
// external-link popup clicks (route-fulfilled synthetic origin pages —
// the sandbox has no internet), the zero-source EmptyState + drawer empty
// copy, the search no-match empty state, the no-enabled-sources refresh
// notice with persisted source toggles, and action-level inline errors
// (switch save / items load / convert). The refresh success/partial
// feedback branches stay test.fixme (@bug:deviations#4): source sync is
// pinned public-HTTPS only (src/public-http.mjs:28-60), which the
// sandbox cannot satisfy.

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
  // Relative timestamps: the page renders real sync times, so absolute
  // dates age into「昨天/M 月 D 日」and break the「同步 今天」assertion
  // on any run after the day they were written.
  const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  insItem.run(
    "csitem_a1",
    "cs_hot_a",
    "https://example-a.example/post-1",
    "当 AI Agent 真正进入工作流，大家最关心的还是可控性",
    "讨论集中在任务失败后的恢复、权限边界和结果验证。",
    ago(120),
    ago(180)
  );
  insItem.run(
    "csitem_a2",
    "cs_hot_a",
    "https://example-a.example/post-2",
    "AI 产品的成本该如何向用户解释",
    "围绕按量收费、费用透明和产品留存展开。",
    "",
    ago(125)
  );
  insItem.run(
    "csitem_b1",
    "cs_hot_b",
    "https://example-b.example/post-3",
    "开源 Agent 工作台开始重视可恢复的任务状态",
    "社区更关注版本、执行证据以及流程中断后的恢复路径。",
    ago(60 * 20),
    ago(1)
  );
  insItem.run(
    "csitem_b2",
    "cs_hot_b",
    "https://example-b.example/post-4",
    "内容创作者如何建立可持续的选题资料库",
    "围绕 RSS、来源管理和写作风格积累的实践经验。",
    "",
    ago(60 * 30)
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
  // 遮罩必须是设计的半透明暗色 #1b2138a8（回归断言：旧按钮样式的特异性
  // 曾把它盖成不透明白）；随后点遮罩本身（非面板内 X 钮）关闭
  const backdrop = page.locator(".cv2-hot-backdrop");
  await expect(backdrop).toBeVisible();
  expect(
    await backdrop.evaluate((el) => getComputedStyle(el).backgroundColor)
  ).toBe("rgba(27, 33, 56, 0.66)");
  await backdrop.click({ position: { x: 10, y: 30 } });
  await expect(sheet).toBeHidden();
  // 再次打开，面板内 X 钮关闭
  await page
    .getByRole("button", { name: "开源 Agent 工作台开始重视可恢复的任务状态", exact: true })
    .click();
  await expect(sheet).toBeVisible();
  await sheet.locator(".cv2-hot-close").click();
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

// Empty-state variant for the audit's zero-source scenario: remove every
// source (built-in cs_seed_* included) so /hotspots renders the
// noSourcesAtAll EmptyState (components/HotspotsRadar.jsx:466-476).
// Same newest-mtime workspace discovery as seedWorkspace above.
function deleteWorkspaceSources(root) {
  const wsDir = join(root, "workspaces");
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
  db.exec("DELETE FROM creator_source_items");
  db.exec("DELETE FROM creator_sources");
  db.close();
}

test("桌面侧栏「热点雷达」入口与顶栏「看热点」快捷链接：真实点击路由跳转并高亮当前项", async ({
  page,
}) => {
  // 侧栏与顶栏均为真实 <Link>（components/CreatorShell.jsx:21,165-169,207-209）。
  // ≤760px 时 .cv2-sidebar 与 .cv2-topbar-actions 均 display:none
  // （app/creator-v2.css:201-208），顶栏/侧栏入口按设计只存在于桌面形态；
  // 移动端入口由底部「热点」覆盖（见移动用例）。
  await signup(page, "hotspots-nav@example.test");
  const sidebar = page.getByRole("navigation", { name: "创作导航" });
  const radarLink = sidebar.getByRole("link", { name: "热点雷达" });
  await radarLink.click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
  await expect(radarLink).toHaveAttribute("aria-current", "page");
  // 经侧栏去选题页，再从顶栏「看热点」回到热点雷达
  await sidebar.getByRole("link", { name: "选题发现" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(
    page.getByRole("heading", { name: "选题发现", exact: true })
  ).toBeVisible();
  await page.locator(".cv2-topbar").getByRole("link", { name: "看热点" }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
});

test("键盘可达：skip link 跳主内容、顺序 Tab 到行标题 Enter 选中、行内「查看详情与原文」切换详情（桌面）", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-keyboard@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  // 首个 Tab 落在 shell 预留的 skip link 上（CreatorShell.jsx:149-151，
  // .cv2-skip 是 .cv2-app 的第一个可聚焦元素），Enter 后焦点进 #cv2-main
  await page.keyboard.press("Tab");
  await expect(page.locator(".cv2-skip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cv2-main")).toBeFocused();
  // 顺序 Tab 步进到第二行标题（页头 2 钮 → 筛选 tabs 2 → 搜索框 → 来源
  // chips 3 → 第一行标题/原文链接/查看详情/关注/收候选 5 个焦点 → 第二行
  // 标题）。用 activeElement 探测目标而非硬编码次数，避免 DOM 演进脆断。
  let reached = false;
  for (let i = 0; i < 24 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      () =>
        document.activeElement?.classList?.contains("cv2-hot-row-title") ===
          true &&
        document.activeElement.textContent.includes("AI 产品的成本")
    );
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cv2-hot-right")).toContainText(
    "AI 产品的成本该如何向用户解释"
  );
  // 行内「查看详情与原文」与标题同 select 处理器（HotspotsRadar.jsx:506-508）：
  // 点击后详情面板切回第一行，选中态随之移动
  await page
    .locator(".cv2-hot-row")
    .first()
    .getByRole("button", { name: "查看详情与原文" })
    .click();
  await expect(page.locator(".cv2-hot-right")).toContainText(
    "开源 Agent 工作台开始重视可恢复的任务状态"
  );
  await expect(page.locator(".cv2-hot-row.selected")).toHaveCount(1);
  await expect(page.locator(".cv2-hot-row.selected")).toContainText(
    "开源 Agent 工作台"
  );
});

test("信源抽屉：打开自动聚焦关闭钮，Enter/Esc 关闭，面板内点击不关闭，遮罩点击关闭（桌面）", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-drawer@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  const drawer = page.getByRole("dialog", { name: "信源与参考素材" });
  const closeBtn = drawer.getByRole("button", { name: "关闭信源面板" });

  // 打开即焦点到关闭钮（HotspotsRadar.jsx:123 closeRef.focus()），键盘用户
  // 立即可操作；Enter 直接触发关闭
  await page.getByRole("button", { name: "管理信源" }).click();
  await expect(drawer).toBeVisible();
  await expect(closeBtn).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeHidden();

  // Esc 关闭（document keydown 监听，HotspotsRadar.jsx:117-125）
  await page.getByRole("button", { name: "管理信源" }).click();
  await expect(closeBtn).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // 面板内部点击不关闭（stopPropagation，:134）；点遮罩本身才关闭（:128）。
  // 抽屉面板固定在右侧（app/creator-v2-hotspots.css:134 right:0，
  // width:min(425px,95vw)），x=10 必落在遮罩上。
  await page.getByRole("button", { name: "管理信源" }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("heading", { name: "信源与参考素材" }).click();
  await expect(drawer).toBeVisible();
  await page.locator(".cv2-drawer-overlay").click({ position: { x: 10, y: 300 } });
  await expect(drawer).toBeHidden();
});

test("详情面板「关注这个话题」双向切换与「收为选题候选」真实持久化（桌面右栏）", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-panel@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  const title = "当 AI Agent 真正进入工作流，大家最关心的还是可控性";
  await page.getByRole("button", { name: title, exact: true }).click();
  const panel = page.locator(".cv2-hot-right");
  await expect(panel).toContainText(title);
  // 面板关注按钮（HotspotsRadar.jsx:101-103）：计数 01、行内书签激活、
  // 按钮文案翻转，再取消回到 00（标签真实变化，非单向断言）
  await panel.getByRole("button", { name: "关注这个话题" }).click();
  await expect(page.locator(".cv2-hot-summary div").nth(1)).toContainText("01");
  await expect(
    panel.getByRole("button", { name: "已关注 · 点击取消" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `取消关注：${title}` })
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "已关注 · 点击取消" }).click();
  await expect(page.locator(".cv2-hot-summary div").nth(1)).toContainText("00");
  await expect(
    page.getByRole("button", { name: `关注话题：${title}` })
  ).toHaveAttribute("aria-pressed", "false");
  // 面板主按钮收为候选（:92-100）→ 真实建选题并直接打开该候选
  await panel.getByRole("button", { name: "收为选题候选", exact: true }).click();
  await expect(page).toHaveURL(/\/topics\?topic=tp_/);
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(title);
});

test("搜索无匹配的诚实空态；「查看我的选题库」「进入选题研究」跳转 /topics（桌面）", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-links@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  // 搜索无匹配：给出「其他来源或清空搜索」的指引（HotspotsRadar.jsx:542-544）
  await page.getByLabel("搜索热点").fill("查无此词的检索串");
  await expect(page.locator(".cv2-hot-empty")).toContainText("没有匹配的话题");
  await page.getByLabel("搜索热点").fill("");
  await expect(page.locator(".cv2-hot-row")).toHaveCount(4);

  // 面板「查看我的选题库」（:104-106）→ /topics，打开选题页本身（无 query）
  await page
    .locator(".cv2-hot-right")
    .getByRole("link", { name: "查看我的选题库" })
    .click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(
    page.getByRole("heading", { name: "选题发现", exact: true })
  ).toBeVisible();
  // 顶栏「看热点」回到热点页，再点完成条「进入选题研究」（:571-573）
  await page.locator(".cv2-topbar").getByRole("link", { name: "看热点" }).click();
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();
  await page
    .locator(".cv2-completion")
    .getByRole("link", { name: "进入选题研究" })
    .click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(
    page.getByRole("heading", { name: "选题发现", exact: true })
  ).toBeVisible();
});

test("「原文链接」「打开原文」真实点击新窗打开，不替换当前页（拦截为合成原文页）", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-origin@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  // 沙箱无外网：外跳域名在路由层拦下并回一个合成原文页，只验证「点击经
  // target=_blank 在新窗打开」的行为本身，不访问真实公网。
  // page.route 不覆盖 target=_blank 新开的 popup，必须用 context.route。
  await page.context().route(/https:\/\/example-[ab]\.example\//, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<title>synthetic-origin</title><h1>合成原文占位页</h1>",
    })
  );
  const firstRow = page.locator(".cv2-hot-row").first();
  const [rowPopup] = await Promise.all([
    page.waitForEvent("popup"),
    firstRow.getByRole("link", { name: "原文链接" }).click(),
  ]);
  await rowPopup.waitForLoadState("load");
  await expect(rowPopup).toHaveURL("https://example-b.example/post-3");
  await expect(
    rowPopup.getByRole("heading", { name: "合成原文占位页" })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/hotspots$/);

  // 详情面板「打开原文」（:70-72）跟随当前选中条目：切到甲源条目后新窗打开其原文
  await page
    .getByRole("button", {
      name: "当 AI Agent 真正进入工作流，大家最关心的还是可控性",
      exact: true,
    })
    .click();
  const [panelPopup] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator(".cv2-hot-right").getByRole("link", { name: "打开原文" }).click(),
  ]);
  await panelPopup.waitForLoadState("load");
  await expect(panelPopup).toHaveURL("https://example-a.example/post-1");
  await expect(
    panelPopup.getByRole("heading", { name: "合成原文占位页" })
  ).toBeVisible();
});

test("无任何信源：EmptyState 引导去偏好与连接，信源抽屉空态如实说明", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-nosources@example.test");
  deleteWorkspaceSources(hotspotsEnv.root);
  await page.goto("/hotspots");
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
  // 零信源走 noSourcesAtAll 的 EmptyState（.cv2-empty），不是列表内空态
  const empty = page.locator(".cv2-empty");
  await expect(empty).toContainText("还没有信源");
  await expect(page.locator(".cv2-hot-summary div").first()).toContainText("00");
  // 无任何同步记录 → 监控带如实说明，不展示伪造的最近同步时间
  await expect(page.locator(".cv2-hot-monitor")).toContainText(
    "信源还没有同步记录"
  );
  // EmptyState 链接真实跳转偏好与连接
  await empty.getByRole("link", { name: "去偏好与连接添加信源" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: "让工作台逐渐了解你的风格" })
  ).toBeVisible();
  // 回热点页打开信源抽屉：空态文案指明去哪里添加（:169-172）
  await page.goto("/hotspots");
  await page.getByRole("button", { name: "管理信源" }).click();
  const drawer = page.getByRole("dialog", { name: "信源与参考素材" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(
    "还没有信源；在偏好与连接中添加公开 RSS/Atom 信源后"
  );
});

test("全部信源暂停：刷新热点如实提示「没有已启用的信源」；暂停状态刷新页面后仍在", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-alloff@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);
  const drawer = page.getByRole("dialog", { name: "信源与参考素材" });
  await page.getByRole("button", { name: "管理信源" }).click();
  await expect(drawer).toBeVisible();
  for (const name of ["合成信源甲 · 行业动态", "合成信源乙 · 研究线索"]) {
    const row = drawer.locator(".cv2-source-item", { hasText: name });
    await row.getByRole("switch").click();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  }
  await drawer.getByRole("button", { name: "完成" }).click();
  await expect(drawer).toBeHidden();
  // 持久化断言：刷新页面后两个信源仍是暂停态（PUT 已落库，非会话态）
  await page.reload();
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();
  await page.getByRole("button", { name: "管理信源" }).click();
  await expect(drawer).toBeVisible();
  for (const name of ["合成信源甲 · 行业动态", "合成信源乙 · 研究线索"]) {
    await expect(
      drawer.locator(".cv2-source-item", { hasText: name }).getByRole("switch")
    ).toHaveAttribute("aria-checked", "false");
  }
  await drawer.getByRole("button", { name: "完成" }).click();
  // 无启用信源 → 同步前的客户端守卫提示（HotspotsRadar.jsx:241-244），
  // 不发起网络请求也不伪造成功
  await page.getByRole("button", { name: /刷新热点/ }).click();
  await expect(page.getByRole("status")).toContainText("没有已启用的信源");
});

test("动作级失败行内提示：信源开关保存失败、来源条目加载失败、收为候选失败均如实报错且可恢复", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-actionfail@example.test");
  seedWorkspace(hotspotsEnv.root);
  await openHotspots(page);

  // 1) 开关保存失败（PUT 被拦）：行内错误提示，开关状态不变（无乐观更新，
  //    HotspotsRadar.jsx:282-283）；放行后重拨开关真实保存为暂停
  await page.route("**/api/creator/sources/**", (route) => route.abort());
  await page.getByRole("button", { name: "管理信源" }).click();
  const drawer = page.getByRole("dialog", { name: "信源与参考素材" });
  const switchA = drawer
    .locator(".cv2-source-item", { hasText: "合成信源甲 · 行业动态" })
    .getByRole("switch");
  await switchA.click();
  await expect(page.getByRole("status")).toContainText(
    /Failed to fetch|信源状态未保存/
  );
  await expect(switchA).toHaveAttribute("aria-checked", "true");
  await expect(switchA).toBeEnabled();
  await page.unroute("**/api/creator/sources/**");
  await switchA.click();
  await expect(switchA).toHaveAttribute("aria-checked", "false");
  await drawer.getByRole("button", { name: "完成" }).click();
  await expect(drawer).toBeHidden();

  // 2) 来源条目加载失败（GET 被拦）：行内错误提示，既有列表不被清空
  //    （:295-296）；放行后回全部来源，提示消失、列表完整
  await page.route("**/api/creator/source-items**", (route) => route.abort());
  await page.getByRole("button", { name: "合成信源乙 · 研究线索" }).click();
  await expect(page.getByRole("status")).toContainText(
    /Failed to fetch|条目加载失败/
  );
  await expect(page.locator(".cv2-hot-row")).toHaveCount(4);
  await page.unroute("**/api/creator/source-items**");
  await page.getByRole("button", { name: "全部来源" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator(".cv2-hot-row")).toHaveCount(4);

  // 3) 收为选题候选失败（POST 被拦）：行内错误、停留在热点页、按钮恢复可用
  //    （:311-313），不产生半建的选题跳转
  await page.route("**/api/creator/source-items/topic", (route) => route.abort());
  await page
    .getByRole("button", {
      name: "收为选题候选：当 AI Agent 真正进入工作流，大家最关心的还是可控性",
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /Failed to fetch|收为选题候选未完成/
  );
  await expect(page).toHaveURL(/\/hotspots$/);
  await expect(
    page.getByRole("button", {
      name: "收为选题候选：当 AI Agent 真正进入工作流，大家最关心的还是可控性",
    })
  ).toBeEnabled();
});

// 审计缺口（knownDefect 登记）：刷新热点的「全成功」「部分失败」反馈分支
// （components/HotspotsRadar.jsx:265-272）要求至少一个真实可同步的已启用信源。
// 信源同步走公网 HTTPS 边界（src/creator.mjs syncSource → publicResource /
// publicRequest，src/public-http.mjs:28-60：非 HTTPS、带内网端口/回环主机名
// 一律拒绝），沙箱无外网无法构造能成功的同步。该语义即设计偏差登记
// CREATOR-V2-DESIGN-DEVIATIONS.md /hotspots #4（:208-212）：刷新=真实同步并
// 如实报告，绝不伪造成功 toast。「无启用信源提示」分支不依赖网络，已由
// 上一条用例真实覆盖；这里保留缺口记录，不写会失败的断言。
test.fixme(
  "刷新热点：全成功与部分失败的反馈分支（需真实公网 HTTPS 信源，沙箱无外网） @bug:deviations#4",
  () => {
    // 需要真实可同步信源才能执行；见上方说明。
  }
);

test("移动 390×844：底部「热点」真实进入，行内「查看详情与原文」开抽屉、关闭钮自动聚焦、Esc 关闭、搜索无匹配空态", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-mobile-sheet@example.test");
  seedWorkspace(hotspotsEnv.root);
  await page.setViewportSize({ width: 390, height: 844 });
  // 桌面侧栏/顶栏在移动端隐藏（app/creator-v2.css:201-208）；移动入口 =
  // 底部导航「热点」（CreatorShell.jsx:36），真实点击进入而非 goto
  await page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("link", { name: "热点" })
    .click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await expect(
    page.getByRole("heading", { name: "热点雷达", exact: true })
  ).toBeVisible();
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();

  // 行内「查看详情与原文」打开底部抽屉；打开即焦点到关闭钮（:224
  // closeRef.focus()），Esc 关闭（:218-226 的 document keydown 监听）
  await page
    .locator(".cv2-hot-row")
    .first()
    .getByRole("button", { name: "查看详情与原文" })
    .click();
  const sheet = page.locator(".cv2-hot-right.is-open");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(
    "开源 Agent 工作台开始重视可恢复的任务状态"
  );
  await expect(sheet.locator(".cv2-hot-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // 搜索无匹配：移动端同样的诚实空态
  await page.getByLabel("搜索热点").fill("查无此词的检索串");
  await expect(page.locator(".cv2-hot-empty")).toContainText("没有匹配的话题");
  await page.getByLabel("搜索热点").fill("");
  await expect(page.locator(".cv2-hot-row")).toHaveCount(4);
});

test("移动 390×844：抽屉内「关注这个话题」「收为选题候选」与「原文链接」新窗点击", async ({
  page,
  hotspotsEnv,
}) => {
  await signup(page, "hotspots-mobile-panel@example.test");
  seedWorkspace(hotspotsEnv.root);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("link", { name: "热点" })
    .click();
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();
  // 同上：popup 不继承 page.route，需 context.route 拦截外跳域名
  await page.context().route(/https:\/\/example-[ab]\.example\//, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<title>synthetic-origin</title><h1>合成原文占位页</h1>",
    })
  );

  const title = "当 AI Agent 真正进入工作流，大家最关心的还是可控性";
  await page.getByRole("button", { name: title, exact: true }).click();
  const sheet = page.locator(".cv2-hot-right.is-open");
  await expect(sheet).toBeVisible();
  // 抽屉内关注（面板按钮，桌面用例的移动等价路径）：按钮文案翻转 + 行内
  // 书签激活。移动端 .cv2-hot-summary 为 display:none，计数断言在桌面用例覆盖。
  await sheet.getByRole("button", { name: "关注这个话题" }).click();
  await expect(
    sheet.getByRole("button", { name: "已关注 · 点击取消" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `取消关注：${title}` })
  ).toHaveAttribute("aria-pressed", "true");
  // 抽屉内收为候选：真实持久化并跳转选题页打开该候选
  await sheet.getByRole("button", { name: "收为选题候选", exact: true }).click();
  await expect(page).toHaveURL(/\/topics\?topic=tp_/);
  await expect(page.getByLabel("选题标题", { exact: true })).toHaveValue(title);

  // 行内「原文链接」点击新窗打开（外跳域名路由层拦下，验证行为不依赖外网）
  await page.goto("/hotspots");
  await expect(page.locator(".cv2-hot-row").first()).toBeVisible();
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page
      .locator(".cv2-hot-row")
      .first()
      .getByRole("link", { name: "原文链接" })
      .click(),
  ]);
  await popup.waitForLoadState("load");
  await expect(popup).toHaveURL("https://example-b.example/post-3");
  await expect(
    popup.getByRole("heading", { name: "合成原文占位页" })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/hotspots$/);
});
