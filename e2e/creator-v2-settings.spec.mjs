import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 settings (/settings 偏好与连接) e2e — real routes, real
// SQLite domain services, no fixtures: an isolated worker-scoped
// production server (same pattern as e2e/creator-v2-insights.spec.mjs)
// with multiuser sessions and a loopback SYNTHETIC model that is never
// called by this spec (the style-suggestion flows are covered by
// e2e/creator-v1.spec.mjs against the same reused component).
// Coverage per the page scope: the V2.2 design structure (基础编辑不依赖 AI
// declaration band + the four-group settings-grid menu with 创作画像 first),
// a real profile save (PUT /api/creator/profile with expectedRevision,
// persisted and server-verifiable), the legacy deep links
// #services/#usage landing on the 模型与费用 group, a real service
// connection whose key is NEVER echoed back to the page, platform
// accounts with the explicit WeChat probe consent gate, the seeded public
// sources with pause/add-consent/remove (no external fetch is triggered),
// the actionable load-error state, and the 390×844 mobile layout across
// all four groups without horizontal overflow.

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
        const result = input.articles
          ? { tone: "自然直接", structure: "先例子后方法", avoid: "夸张的保证", length: "千字左右" }
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
      const root = mkdtempSync(join(tmpdir(), "studio-creator-settings-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "settings.sqlite"),
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
        if (!ready) throw Error("Settings server did not start " + logs);
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
  await page.getByLabel("作者名称", { exact: true }).fill("合成设置作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

async function openSettings(page, hash = "") {
  await page.goto("/settings" + hash);
  await expect(
    page.getByRole("heading", { name: "让工作台逐渐了解你的风格" })
  ).toBeVisible();
}

test("设计结构与画像优先：声明条 + 四组菜单，保存画像真实落库并留版本", async ({ page }) => {
  await signup(page, "settings-structure@example.test");
  await openSettings(page);

  // 顶部声明条（设计 :183）——基础编辑不依赖 AI 是真实产品原则。
  const head = page.locator(".cv2-set-head");
  await expect(head.getByText("基础编辑不依赖 AI")).toBeVisible();
  await expect(head).toContainText("也可以新建、编辑、保存及导出文章");

  // 四组菜单（设计 settings-grid），默认落在「创作画像」。
  const menu = page.getByRole("navigation", { name: "设置分组" });
  for (const label of ["创作画像", "模型与费用", "发布账号", "信源与研究"])
    await expect(menu.getByRole("button", { name: label, exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "创作画像" })).toHaveAttribute("aria-pressed", "true");

  // 保存画像：真实 PUT（expectedRevision），服务端可核对，版本递增。
  await page.getByLabel("创作领域", { exact: true }).fill("独立创作与效率工具");
  await page.getByRole("button", { name: "保存作者画像", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("作者画像已保存为 v2");
  let profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.domain).toBe("独立创作与效率工具");
  expect(profile.revision).toBe(2);

  // 版本历史可展开，首个版本可恢复（不可变修订 + 显式恢复）。
  await page.getByText("画像版本与撤销", { exact: true }).click();
  await expect(page.getByText("v1 ·", { exact: false })).toBeVisible();

  // 高级字段（结构/避免/篇幅/视觉/时区与开关）收进折叠区，画像组不铺满开关。
  const more = page.locator(".cv2-set-more");
  await expect(more.getByText("结构偏好", { exact: true })).toBeHidden();
  await more.locator("summary").click();
  await expect(more.getByText("结构偏好", { exact: true })).toBeVisible();

  // 底部完成条（设计 :183）：配置按需出现 + 密钥仅存服务端。
  const done = page.locator(".cv2-set-done");
  await expect(done.getByText("配置项只在真正需要时出现")).toBeVisible();
  await expect(done).toContainText("密钥仅保存在服务端");
});

test("旧深链 #services/#usage 落到「模型与费用」组；连接密钥不回显、额度真实保存", async ({ page }) => {
  await signup(page, "settings-deeplink@example.test");

  // #services：移动端审计等旧链接仍打开服务分组。
  await openSettings(page, "#services");
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await expect(menu.getByRole("button", { name: "模型与费用" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "服务连接", exact: true })).toBeVisible();

  // 无连接时诚实空态：基础编辑不依赖 AI。
  await expect(page.getByText("未连接模型服务")).toBeVisible();

  // 真实添加连接（图片用途）→ 列表出现「当前使用」；密钥不回显。
  await page.getByRole("combobox", { name: "用途", exact: true }).selectOption("image");
  await page.getByLabel("连接名称", { exact: true }).fill("合成图片连接");
  await page.getByLabel("API Base URL", { exact: true }).fill("https://image.example/v1/");
  await page.getByLabel("默认模型", { exact: true }).fill("synthetic-image-model");
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-private-key-not-shown");
  await page.getByRole("button", { name: "保存服务连接", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("服务连接已加密保存");
  const row = page.locator(".cv2-set-row", { hasText: "合成图片连接" });
  await expect(row.getByText("当前使用", { exact: true })).toBeVisible();
  await expect(row).toContainText("密钥已配置");
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("synthetic-private-key-not-shown");
  const config = await (await page.request.get("/api/creator/services")).json();
  expect(config.connections).toHaveLength(1);
  expect(config.connections[0].kind).toBe("image");
  expect(JSON.stringify(config)).not.toContain("synthetic-private-key-not-shown");

  // #usage：同组打开且滚动目标（费用与额度卡）存在；保存额度真实生效。
  await page.goto("/settings#usage");
  await expect(menu.getByRole("button", { name: "模型与费用" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "费用与额度", exact: true })).toBeVisible();
  await page.getByLabel("图片请求上限", { exact: true }).fill("7");
  await page.getByRole("button", { name: "保存额度", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("每日请求上限已更新");
  const usage = await (await page.request.get("/api/creator/usage")).json();
  expect(usage.limits.imageLimit).toBe(7);

  // 移除连接：列表回到诚实空态。
  await page.getByRole("button", { name: "移除连接", exact: true }).click();
  await expect(page.getByText("未连接模型服务")).toBeVisible();
  expect(((await (await page.request.get("/api/creator/services")).json()).connections)).toHaveLength(0);
});

test("发布账号：知乎真实落库、账号定位可编辑，微信能力检查必须先勾选同意", async ({ page }) => {
  await signup(page, "settings-platforms@example.test");
  await openSettings(page);
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await menu.getByRole("button", { name: "发布账号", exact: true }).click();

  // 空态即设计的「待连接」：不伪造任何已连接状态。
  await expect(page.getByText("公众号、知乎均待连接")).toBeVisible();
  await expect(page.getByText("人工确认，不自动发布")).toBeVisible();

  // 添加知乎账号（无凭据字段）→ 真实 POST，服务端可核对。
  await page.getByLabel("发布平台", { exact: true }).selectOption("zhihu");
  await page.getByLabel("账号名称", { exact: true }).fill("面向开发者的知乎账号");
  await page.getByRole("button", { name: "保存发布账号", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("平台账号已保存");
  const accounts = await (await page.request.get("/api/creator/platforms")).json();
  expect(accounts.accounts).toHaveLength(1);
  expect(accounts.accounts[0]).toMatchObject({ platform: "zhihu", name: "面向开发者的知乎账号" });

  // 账号独立定位与风格（复用组件）：保存走真实 PUT profile。
  await page.getByText("账号独立定位与风格 · v0", { exact: true }).click();
  await page
    .getByLabel("账号 面向开发者的知乎账号 的账号定位", { exact: true })
    .fill("面向独立开发者，解释实践背后的原因");
  await page.getByRole("button", { name: "保存账号定位与风格", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("账号定位已保存");

  // 添加微信账号后，「检查公众号接口」必须先显式同意（不允许无授权外呼）。
  await page.getByLabel("发布平台", { exact: true }).selectOption("wechat");
  await page.getByLabel("账号名称", { exact: true }).fill("合成公众号");
  await page.getByLabel("公众号 AppID", { exact: true }).fill("wxabcdef0123456789");
  await page.getByLabel("公众号 AppSecret", { exact: true }).fill("synthetic-secret-0123456789");
  await page.getByRole("button", { name: "保存发布账号", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("平台账号已保存");
  const probeButton = page.getByRole("button", { name: "检查公众号接口", exact: true });
  await expect(probeButton).toBeDisabled();
  await page
    .getByLabel("允许本次请求微信官方接口检查账号能力", { exact: true })
    .check();
  await expect(probeButton).toBeEnabled();
  const pageBody = await page.locator("body").innerText();
  expect(pageBody).not.toContain("synthetic-secret-not-shown");
});

test("信源与研究：内置默认信源可见，暂停/添加同意门/移除全部真实落库（不触发外呼）", async ({ page }) => {
  await signup(page, "settings-sources@example.test");
  await openSettings(page, "#sources");
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await expect(menu.getByRole("button", { name: "信源与研究" })).toHaveAttribute("aria-pressed", "true");

  // 内置默认信源（AIHOT / HN / OpenAI / DeepMind…）真实存在，与设计第四组对应。
  await expect(page.getByText("AIHOT 精选", { exact: true })).toBeVisible();
  await expect(page.getByText("Hacker News · 热门", { exact: true })).toBeVisible();
  await expect(page.getByText("OpenAI · 官方新闻", { exact: true })).toBeVisible();
  await expect(page.getByText("Google DeepMind · 官方博客", { exact: true })).toBeVisible();
  await expect(page.getByText("来源边界", { exact: false })).toBeVisible();

  // 暂停订阅：真实 PUT，服务端 enabled=0；行内状态标签同步。
  const hnRow = page.locator(".cv2-set-row", { hasText: "Hacker News · 热门" });
  await hnRow.getByRole("button", { name: "暂停订阅" }).click();
  await expect(hnRow.getByText("已暂停", { exact: true })).toBeVisible();
  let sources = (await (await page.request.get("/api/creator/sources")).json()).sources;
  expect(sources.find((s) => s.name === "Hacker News · 热门").enabled).toBe(0);

  // 添加信源必须先勾选订阅同意（按钮禁用门槛），保存真实 POST。
  await page.getByLabel("名称", { exact: true }).fill("合成测试信源");
  await page
    .getByLabel("RSS / Atom 地址", { exact: true })
    .fill("https://example.invalid/rss.xml");
  const saveButton = page.getByRole("button", { name: "保存并启用订阅", exact: true });
  await expect(saveButton).toBeDisabled();
  await page.getByLabel("允许服务端按计划读取该公开信源", { exact: true }).check();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByRole("status").last()).toContainText("公开信源已保存");
  sources = (await (await page.request.get("/api/creator/sources")).json()).sources;
  const added = sources.find((s) => s.name === "合成测试信源");
  expect(added).toBeTruthy();
  expect(added.enabled).toBe(1);

  // 移除：服务端消失；本用例全程不点击「立即读取」（不产生外部抓取）。
  const addedRow = page.locator(".cv2-set-row", { hasText: "合成测试信源" });
  await addedRow.getByRole("button", { name: "移除信源", exact: true }).click();
  await expect(addedRow).toHaveCount(0);
  sources = (await (await page.request.get("/api/creator/sources")).json()).sources;
  expect(sources.find((s) => s.name === "合成测试信源")).toBeUndefined();
});

test("加载失败：可操作错误与重试恢复", async ({ page }) => {
  await signup(page, "settings-error@example.test");
  const profileApi = /\/api\/creator\/profile/;
  await page.route(profileApi, (route) => route.abort());
  await openSettings(page);
  const alert = page.locator("div.cv2-error-state");
  await expect(alert).toContainText("偏好与连接加载失败");
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
  await page.unroute(profileApi);
  await alert.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("button", { name: "保存作者画像", exact: true })).toBeVisible();
});

test("移动 390×844：四组切换均无横向溢出，菜单横向滚动，更多面板高亮偏好与连接", async ({ page }) => {
  await signup(page, "settings-mobile@example.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);

  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  // 逐组切换：声明条仍在、分组卡片渲染、无横向溢出。
  const menu = page.getByRole("navigation", { name: "设置分组" });
  for (const [label, heading] of [
    ["模型与费用", "服务连接"],
    ["发布账号", "发布账号"],
    ["信源与研究", "公开信源"],
    ["创作画像", "创作画像"],
  ]) {
    await menu.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  }

  // 菜单是横向滚动条（设计 :12 settings-menu grid-auto-flow:column）。
  const menuScroll = await menu.evaluate((el) => ({
    flow: getComputedStyle(el).gridAutoFlow,
    x: getComputedStyle(el).overflowX,
  }));
  expect(menuScroll.flow).toBe("column");
  expect(menuScroll.x).toBe("auto");

  // 底部导航：偏好与连接属于「更多」面板且高亮当前页。
  await page.getByRole("navigation", { name: "移动端导航" }).getByRole("button", { name: "更多" }).click();
  await expect(
    page.getByRole("dialog", { name: "更多工作区" }).getByRole("link", { name: "偏好与连接" })
  ).toHaveAttribute("aria-current", "page");
  expect(await overflow()).toBeLessThanOrEqual(0);
});
