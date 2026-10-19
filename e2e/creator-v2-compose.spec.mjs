import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 compose (/compose) e2e — the real 创作空间. Worker-scoped
// guarded production server (same pattern as e2e/creator-v2-works.spec.mjs)
// with multiuser sessions and NO text model; the only synthetic piece is a
// loopback OpenAI-compatible image endpoint so an illustration plan can be
// generated if a test chooses to. Coverage per the page scope:
//   1. V2.2 three-column editor chrome (header / step strip / ribbon /
//      channel tabs / paper) on a real empty draft, honest empty states,
//      real autosave into SQLite and outline/step facts updating;
//   2. master vs 公众号/知乎 independent revisions with expectedRevision
//      conflict protection surviving a second tab;
//   3. the V2.3 配图 entry: honest empty board, a REAL plan via the
//      illustration domain API, slot statuses and planner hand-off;
//   4. 390×844: mobile pane split, in-workflow bottom nav above the global
//      tabs and no horizontal overflow.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function listen(server) {
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
}

const test = base.extend({
  composeOrigin: [
    async ({}, use) => {
      // Synthetic loopback image provider (never a real external service).
      const images = createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ b64_json: PNG_1X1 }] }));
      });
      const imagePort = await listen(images);
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-creator-compose-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "compose.sqlite"),
        CONTENT_STUDIO_DEPLOY_MODE: "",
        CONTENT_STUDIO_ALLOW_REMOTE: "0",
        ENABLE_SCENARIO: "0",
        CONTENT_AI_API_KEY: "",
        CONTENT_AI_BASE_URL: "",
        CONTENT_AI_MODEL: "",
        CONTENT_IMAGE_API_KEY: "",
        CONTENT_IMAGE_OPENAI_API_KEY: "",
        CONTENT_IMAGE_OPENAI_BASE_URL: "",
        CONTENT_IMAGE_OPENAI_MODEL: "",
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
        if (!ready) throw Error("Compose server did not start " + logs);
        await use(origin);
      } finally {
        const done = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await Promise.race([done, sleep(5000)]);
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await done;
        }
        await new Promise((r) => images.close(r));
        rmSync(root, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ composeOrigin }, use) => use(composeOrigin),
});

async function signup(page, email) {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成创作空间作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

async function createProject(request, title) {
  const r = await request.post("/api/writing/projects", {
    data: { title },
  });
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  expect(d.projectId).toMatch(/^ep_/);
  return d.projectId;
}

async function stored(request, id, channel = "master") {
  return (
    await (await request.get(`/api/writing/projects/${id}/${channel}`)).json()
  );
}

const cm = (page) => page.getByLabel("文章 Markdown 正文");

test("V2 版式：真实空稿的诚实空态、阶段条与 ribbon，正文输入真实自动保存", async ({
  page,
  request,
}) => {
  const id = await createProject(request, "创作空间验证：城市步行观察笔记");
  await page.goto("/compose?project=" + id);

  // 头部：eyebrow 用真实渠道与标题；保存状态来自真实修订
  await expect(
    page.getByRole("heading", { name: "创作空间验证：城市步行观察笔记" })
  ).toBeVisible();
  await expect(page.locator(".cv2-compose-header .cv2-eyebrow")).toContainText(
    "作品 / 主稿"
  );
  await expect(page.locator(".cv2-compose-save")).toHaveText(/已保存 · v\d+/);

  // 渠道分段：主稿 / 公众号 / 知乎 / 小红书（现有第四渠道保留）
  const tabs = page.getByRole("tablist", { name: "稿件渠道" });
  await expect(tabs.getByRole("tab", { name: "主稿" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  for (const name of ["微信公众号", "知乎", "小红书"])
    await expect(tabs.getByRole("tab", { name })).toBeAttached();

  // 阶段条：空稿 → 大纲是当前步骤，其余是数字，不谎报完成
  const steps = page.locator(".cv2-compose-steps .cv2-compose-step");
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(1)).toHaveClass(/now/);
  await expect(steps.nth(0)).toHaveClass(/todo/);

  // ribbon：真实的检查计数 + 不变量声明
  await expect(page.locator(".cv2-compose-ribbon")).toContainText(
    "待完成人工检查"
  );
  await expect(page.locator(".cv2-compose-ribbon")).toContainText("4 项");
  await expect(
    page.locator(".cv2-compose-ribbon").getByText("主稿 / 平台稿独立")
  ).toBeAttached();

  // 诚实空态：结构/配图定位都没有编造内容；稿纸标注 MASTER DRAFT
  await expect(page.getByText("正文中的 # 标题会显示在这里。")).toBeVisible();
  await expect(
    page.getByText("还没有配图计划；在配图助手里依据主稿规划封面和插图。")
  ).toBeVisible();
  await expect(page.locator(".cv2-paper-label")).toContainText("Master Draft");
  await expect(cm(page)).toBeVisible();

  // 真实自动保存：输入落入 SQLite；大纲与阶段条随之由真实事实驱动
  const markdown = "# 城市步行观察\n\n第一段真实观察记录。";
  await cm(page).fill(markdown);
  await expect
    .poll(async () => (await stored(request, id)).markdown)
    .toBe(markdown);
  await expect(
    page.locator(".cv2-compose-outline-link", { hasText: "城市步行观察" })
  ).toBeVisible();
  await expect(steps.nth(0)).toHaveClass(/todo/); // 无简报：研究不谎报完成
  await expect(steps.nth(1)).toHaveClass(/done/);
  await expect(steps.nth(2)).toHaveClass(/now/);

  // 刷新后内容仍在（真实持久化，修订推进）
  await page.reload();
  await expect(cm(page)).toContainText("城市步行观察");
  await expect(page.locator(".cv2-compose-save")).toHaveText(
    /已保存 · v\d+/
  );
});

test("渠道独立与冲突保护：主稿/公众号独立修订，expectedRevision 冲突不覆盖", async ({
  page,
  request,
}) => {
  const id = await createProject(request, "渠道独立与冲突保护验证");
  const masterText = "# 主稿标题\n\n主稿的原始表达。";
  await page.goto("/compose?project=" + id);
  await cm(page).fill(masterText);
  await expect
    .poll(async () => (await stored(request, id)).markdown)
    .toBe(masterText);
  const masterBefore = await stored(request, id);

  // 切到公众号：独立文档 + 平台稿提示行
  await page.getByRole("tab", { name: "微信公众号" }).click();
  await expect(page.locator(".cv2-paper-label")).toContainText("Wechat Draft");
  await expect(page.getByText("平台稿独立保存，主稿不会被自动改写。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "从主稿创建新版本" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看并合并主稿差异" })
  ).toBeVisible();

  // 从主稿创建新版本（保留历史）：公众号稿获得内容，主稿修订不变
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "从主稿创建新版本" }).click();
  await expect
    .poll(async () => (await stored(request, id, "wechat")).markdown)
    .toBe(masterText);
  expect((await stored(request, id)).revision).toBe(masterBefore.revision);

  // 平台稿上的独立编辑不回写主稿
  await cm(page).fill("# 公众号标题\n\n公众号自己的开头。");
  await expect
    .poll(async () => (await stored(request, id, "wechat")).markdown)
    .toBe("# 公众号标题\n\n公众号自己的开头。");
  expect((await stored(request, id)).markdown).toBe(masterText);

  // 回主稿，用第二个页面制造 expectedRevision 冲突：本地内容保留、可下载
  await page.getByRole("tab", { name: "主稿" }).click();
  await expect(page.locator(".cv2-paper-label")).toContainText("Master Draft");
  const other = await page.context().newPage();
  await other.goto("/compose?project=" + id);
  await expect(cm(other)).toBeVisible();
  await cm(other).fill("第二个窗口尚未合并的本地内容。");
  await expect(
    other.getByRole("button", { name: "下载本地草稿" })
  ).toBeVisible();
  await expect(cm(other)).toContainText("第二个窗口尚未合并的本地内容。");
  // 服务端仍是第一个窗口的已保存版本（不可变修订未被强覆盖）
  expect((await stored(request, id)).markdown).toBe(masterText);
  await other.close();
});

test("V2.3 配图入口：空态诚实，真实计划出现真实图位状态并可去工作台", async ({
  page,
  request,
}) => {
  const id = await createProject(request, "配图计划与图位状态验证");
  const markdown =
    "# 配图验证文章\n\n第一节需要解释一个结构概念，用一段足够长的文字描述任务的执行顺序与边界，方便读者理解流程。\n\n## 第二节\n\n第二节给出对照说明，同样写足长度：通过对照两种做法的差异，说明为什么可靠性比单次演示更加重要。\n\n## 第三节\n\n第三节补充边界情况，继续使用足够长的段落描述失败恢复与人工确认的位置，避免正文过短无法规划。";
  await page.goto("/compose?project=" + id);
  await cm(page).fill(markdown);
  await expect
    .poll(async () => (await stored(request, id)).markdown)
    .toBe(markdown);

  // 打开配图视图：没有计划 → 诚实空态 + 指向配图助手
  await page.getByRole("button", { name: "切换到配图" }).click();
  const board = page.getByLabel("配图工作台视图");
  await expect(board).toBeVisible();
  await expect(board.getByText("这篇文章还没有配图计划")).toBeVisible();

  // 通过真实领域 API 创建计划（不经过任何付费调用）
  const master = await stored(request, id);
  const planned = await page.request.post(
    `/api/illustrations/projects/${id}/plan`,
    { data: { expectedMasterRevision: master.revision } }
  );
  expect(planned.ok()).toBeTruthy();
  expect((await planned.json()).shots.length).toBeGreaterThan(0);

  // 重新打开配图视图：真实图位 + 真实状态 pill + 工作台入口
  await page.getByRole("button", { name: "返回编辑" }).click();
  await page.getByRole("button", { name: "切换到配图" }).click();
  await expect(board.getByText("文章封面 · 待生成")).toBeVisible();
  await expect(board.getByText("正文配图 02 · 待生成")).toBeVisible();
  const slotLink = board.getByRole("link", { name: /打开完整视觉工作台/ });
  await expect(slotLink).toHaveAttribute(
    "href",
    `/illustrations?project=${id}`
  );
  // 图位点击进入配图助手（真实规划/生成/插入仍在助手与工作台完成）
  await board.getByRole("button", { name: /文章封面 · 待生成/ }).click();
  await expect(page.getByLabel("文章配图助手")).toBeVisible();
  // 左栏配图定位同步真实图位
  await expect(
    page.locator(".cv2-compose-rail").getByText(/文章封面/)
  ).toBeVisible();
});

test("移动 390×844：正文/助手双面板、工作流底栏在全局导航之上且无横向溢出", async ({
  page,
  request,
}) => {
  const id = await createProject(request, "移动端创作空间检查");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // 双面板切换：默认正文，助手面板隐藏；切到助手后编辑区隐藏
  const mobileTabs = page.locator(".cv2-compose-mobiletabs");
  await expect(mobileTabs).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "移动端创作工作流" })
  ).toBeVisible();
  await expect(page.locator(".cv2-compose-middle")).toBeVisible();
  await mobileTabs.getByRole("button", { name: "AI 配图助手" }).click();
  await expect(page.locator(".cv2-compose-middle")).toBeHidden();
  await expect(page.getByLabel("文章配图助手")).toBeVisible();
  await mobileTabs.getByRole("button", { name: "正文", exact: true }).click();
  await expect(page.locator(".cv2-compose-middle")).toBeVisible();

  // 全局底部导航仍在（不被内部工作流导航替代）
  await expect(
    page.getByRole("navigation", { name: "移动端导航" })
  ).toBeVisible();

  // 保存状态在移动端可见（V2.2 设计保留主状态）
  await expect(page.locator(".cv2-compose-save")).toContainText("已保存");
});
