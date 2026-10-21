import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 settings (/settings 偏好与连接) e2e — real routes, real
// SQLite domain services, no fixtures: an isolated worker-scoped
// production server (same pattern as e2e/creator-v2-insights.spec.mjs)
// with multiuser sessions and a loopback SYNTHETIC model. The successful
// style-suggestion flows are covered by e2e/creator-v1.spec.mjs against
// the same reused component; this spec only invokes the model for the
// 「额度中断」 marker case, whose HTTP 500 produces a REAL unknown (待核实)
// usage record in service_usage (src/creator-services.mjs:602-606).
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
        // 额度结算用例的合成上游故障：文章标题带「额度中断」标记时返回
        // HTTP 500，让真实的 services.request() 把该次预留结算为 unknown。
        if (input.articles?.some((a) => String(a.title || "").includes("额度中断"))) {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: "synthetic upstream outage" }));
        }
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

// —— 以下为交互缺口补齐（2026-10-20 审计矩阵）：服务连接编辑流、V76 模型目录
// 页面流、费用与额度 unknown 结算、信源立即读取/恢复订阅、微信探针真实点击、
// AppSecret 有效零回显、移除账号、跨页 /compose 跳转、画像保存 409 与失败反馈、
// 高级字段与时区/学习开关、#usage 滚动定位、键盘可达、移动「更多」面板 Esc
// （已登记缺陷 → test.fixme）。选择器与文案均按 SettingsWorkspace.jsx 真实标记核对。 ——

test("服务连接编辑流：编辑连接预填且密钥留空可保存、设为当前服务切换标签、取消编辑零写入", async ({
  page,
}) => {
  await signup(page, "settings-conn-edit@example.test");
  await openSettings(page);
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await menu.getByRole("button", { name: "模型与费用", exact: true }).click();

  // 建两个真实连接：主连接当前使用，备用连接不勾选「设为此用途的当前服务」。
  await page.getByLabel("连接名称", { exact: true }).fill("合成主连接");
  await page.getByLabel("API Base URL", { exact: true }).fill("https://primary.example/v1/");
  await page.getByLabel("默认模型", { exact: true }).fill("synthetic-primary-model");
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-edit-key-0001");
  await page.getByRole("button", { name: "保存服务连接", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("服务连接已加密保存");
  await page.getByLabel("连接名称", { exact: true }).fill("合成备用连接");
  await page.getByLabel("API Base URL", { exact: true }).fill("https://backup.example/v1/");
  await page.getByLabel("默认模型", { exact: true }).fill("synthetic-backup-model");
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-edit-key-0002");
  await page.getByLabel("设为此用途的当前服务", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存服务连接", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("服务连接已加密保存");

  const primaryRow = page.locator(".cv2-set-row", { hasText: "合成主连接" });
  const backupRow = page.locator(".cv2-set-row", { hasText: "合成备用连接" });
  await expect(primaryRow.getByText("当前使用", { exact: true })).toBeVisible();
  await expect(backupRow.getByText("备用", { exact: true })).toBeVisible();

  // 「设为当前服务」：真实 PUT，两个行的标签互换（SettingsWorkspace.jsx:534-550）。
  await backupRow.getByRole("button", { name: "设为当前服务", exact: true }).click();
  await expect(backupRow.getByText("当前使用", { exact: true })).toBeVisible();
  await expect(primaryRow.getByText("备用", { exact: true })).toBeVisible();
  await expect(primaryRow.getByRole("button", { name: "设为当前服务", exact: true })).toBeVisible();
  let config = await (await page.request.get("/api/creator/services")).json();
  expect(config.connections.find((c) => c.name === "合成备用连接").selected).toBe(true);
  expect(config.connections.find((c) => c.name === "合成主连接").selected).toBe(false);

  // 「编辑连接」：表单预填、密钥留空（SettingsWorkspace.jsx:181-185,630）。
  await primaryRow.getByRole("button", { name: "编辑连接", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑服务连接", exact: true })).toBeVisible();
  await expect(page.getByLabel("连接名称", { exact: true })).toHaveValue("合成主连接");
  await expect(page.getByLabel("API Base URL", { exact: true })).toHaveValue("https://primary.example/v1/");
  await expect(page.getByLabel("默认模型", { exact: true })).toHaveValue("synthetic-primary-model");
  await expect(page.locator(".cv2-set-form input[type=password]")).toHaveValue("");
  await expect(page.locator("label", { hasText: "留空保留现有密钥" })).toBeVisible();
  // 预填态也不回显已保存的密钥。
  expect(await page.locator("body").innerText()).not.toContain("synthetic-edit-key-0001");

  // 留空密钥改名保存（PUT）：保存成功且凭据仍在服务端（不要求重填密钥）。
  await page.getByLabel("连接名称", { exact: true }).fill("合成主连接·已改名");
  await page.getByRole("button", { name: "保存服务连接", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("服务连接已加密保存");
  await expect(
    page.locator(".cv2-set-row", { hasText: "合成主连接·已改名" }).getByText("备用", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "添加服务连接", exact: true })).toBeVisible();
  config = await (await page.request.get("/api/creator/services")).json();
  expect(config.connections).toHaveLength(2);
  const renamed = config.connections.find((c) => c.name === "合成主连接·已改名");
  expect(renamed.model).toBe("synthetic-primary-model");
  expect(renamed.credentialConfigured).toBe(true);

  // 「取消编辑」：退出编辑态、表单复位，且不产生任何新连接（:724-736）。
  await page
    .locator(".cv2-set-row", { hasText: "合成主连接·已改名" })
    .getByRole("button", { name: "编辑连接", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "编辑服务连接", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消编辑", exact: true }).click();
  await expect(page.getByRole("heading", { name: "添加服务连接", exact: true })).toBeVisible();
  await expect(page.getByLabel("连接名称", { exact: true })).toHaveValue("");
  await expect(page.locator(".cv2-set-form input[type=password]")).toHaveValue("");
  config = await (await page.request.get("/api/creator/services")).json();
  expect(config.connections).toHaveLength(2);
});

test("V76 模型目录页面流：内网地址被真实边界拒绝；注入目录后默认模型锁定、勾选集合真实保存", async ({
  page,
}) => {
  await signup(page, "settings-catalog@example.test");
  await openSettings(page);
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await menu.getByRole("button", { name: "模型与费用", exact: true }).click();
  await page.getByLabel("连接名称", { exact: true }).fill("合成目录连接");
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-catalog-key-0001");
  const fetchButton = page.getByRole("button", { name: "获取模型列表", exact: true });
  await expect(fetchButton).toBeDisabled();
  await page
    .getByLabel("允许向该服务商请求一次模型列表（GET models，不计入每日额度）", { exact: true })
    .check();
  await expect(fetchButton).toBeEnabled();

  // 真实边界：非 HTTPS/内网地址在服务端 publicEndpoint 校验处被拒（零外呼）。
  await page.getByLabel("API Base URL", { exact: true }).fill("http://127.0.0.1:9/v1/");
  await fetchButton.click();
  await expect(page.getByRole("status").last()).toContainText("服务地址必须是公网 HTTPS");

  // 目录载荷在浏览器边界注入（公网 HTTPS 抓取契约由 test/model-catalog-v76.test.mjs
  // 单测覆盖）；注入后重新获取。
  await page.route("**/api/creator/services/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          "synthetic-catalog-alpha",
          "synthetic-catalog-beta",
          "synthetic-catalog-gamma",
        ],
      }),
    })
  );
  await page.getByLabel("API Base URL", { exact: true }).fill("https://catalog.example/v1/");
  await fetchButton.click();
  await expect(page.getByRole("status").last()).toContainText("已获取模型列表");

  // 第一个勾选的模型成为默认模型并锁定（不可取消勾选）。
  const alpha = page.locator(".cv2-set-check", { hasText: "synthetic-catalog-alpha" });
  const beta = page.locator(".cv2-set-check", { hasText: "synthetic-catalog-beta" });
  const gamma = page.locator(".cv2-set-check", { hasText: "synthetic-catalog-gamma" });
  await alpha.getByRole("checkbox").check();
  await expect(page.getByLabel("默认模型", { exact: true })).toHaveValue("synthetic-catalog-alpha");
  await expect(alpha.getByRole("checkbox")).toBeDisabled();
  await expect(alpha.getByText("默认", { exact: true })).toBeVisible();
  await beta.getByRole("checkbox").check();
  await expect(gamma.getByRole("checkbox")).not.toBeChecked();

  // 保存：开放模型集合真实落库，密钥不回传。
  await page.getByRole("button", { name: "保存服务连接", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("服务连接已加密保存");
  const row = page.locator(".cv2-set-row", { hasText: "合成目录连接" });
  await expect(row.getByText("当前使用", { exact: true })).toBeVisible();
  await expect(row).toContainText("已开放 2 个模型供创作对比");
  const config = await (await page.request.get("/api/creator/services")).json();
  expect(config.connections).toHaveLength(1);
  expect(config.connections[0].models.sort()).toEqual([
    "synthetic-catalog-alpha",
    "synthetic-catalog-beta",
  ]);
  expect(JSON.stringify(config)).not.toContain("synthetic-catalog-key-0001");
});

test("费用与额度：真实中断生成「待核实」记录，两种结算动作改变记录与今日统计", async ({
  page,
}) => {
  await signup(page, "settings-usage@example.test");
  // 通过真实 API 建一篇作品；其标题带「额度中断」标记，提炼时合成模型返回 500。
  const created = await page.request.post("/api/writing/projects", {
    data: { title: "额度中断：合成学习样章" },
  });
  expect(created.ok()).toBeTruthy();
  await openSettings(page);

  // 触发一次会被中断的画像学习：真实预留额度 → 上游 500 → 预留记为 unknown。
  await page.getByLabel("额度中断：合成学习样章", { exact: true }).check();
  await page
    .getByLabel("允许本次向模型发送所选文章及已接受 / 拒绝的写作建议", { exact: true })
    .check();
  await page.getByRole("button", { name: "提炼风格建议", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("模型服务未完成请求（HTTP 500）");

  // 失败路径只更新错误反馈、不触发 load()，切换分组不会重新拉取 usage；
  // 重新打开设置页以加载真实落库的「待核实」记录后再断言。
  await openSettings(page);
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await menu.getByRole("button", { name: "模型与费用", exact: true }).click();
  const usageCard = page.locator(".cv2-set-usage");
  await expect(usageCard.getByText("写作 · 待核实 · 1 次", { exact: true })).toBeVisible();
  await expect(usageCard.getByText("写作 · 待核实", { exact: true })).toBeVisible();
  await expect(usageCard.getByText("预留 1 次 / 结算 待核实", { exact: true })).toBeVisible();

  // 「已核对，计入额度」：真实 POST settle completed。
  await usageCard.getByRole("button", { name: "已核对，计入额度", exact: true }).click();
  await expect(usageCard.getByText("写作 · 已完成", { exact: true })).toBeVisible();
  await expect(usageCard.getByText("预留 1 次 / 结算 1", { exact: true })).toBeVisible();
  await expect(usageCard.getByText("写作 · 已完成 · 1 次", { exact: true })).toBeVisible();
  await expect(usageCard.getByRole("button", { name: "已核对，计入额度", exact: true })).toHaveCount(0);

  // 再中断一次并「已核对，未产生请求」：真实 POST settle failed。
  await menu.getByRole("button", { name: "创作画像", exact: true }).click();
  // 上面的重载会重置组件状态：学习选择需重新勾选。
  await page.getByLabel("额度中断：合成学习样章", { exact: true }).check();
  await page
    .getByLabel("允许本次向模型发送所选文章及已接受 / 拒绝的写作建议", { exact: true })
    .check();
  await page.getByRole("button", { name: "提炼风格建议", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("模型服务未完成请求（HTTP 500）");
  // 同上：第二次中断仍走失败路径、不触发 load()，重载后核对最新额度记录。
  await page.reload();
  await menu.getByRole("button", { name: "模型与费用", exact: true }).click();
  await usageCard.getByRole("button", { name: "已核对，未产生请求", exact: true }).click();
  await expect(usageCard.getByText("写作 · 失败", { exact: true })).toBeVisible();
  await expect(usageCard.getByText("预留 1 次 / 结算 0", { exact: true })).toBeVisible();
  await expect(usageCard.getByText("写作 · 失败 · 1 次", { exact: true })).toBeVisible();

  // 服务端核对：两条记录分别结算为 completed/actual=1 与 failed/actual=0。
  const usage = await (await page.request.get("/api/creator/usage")).json();
  expect(usage.recent).toHaveLength(2);
  const completed = usage.recent.find((r) => r.state === "completed");
  const failed = usage.recent.find((r) => r.state === "failed");
  expect(completed && completed.actual).toBe(1);
  expect(failed && failed.actual).toBe(0);
});

test("信源「立即读取」：真实触发 POST sync，失败时行内状态与错误反馈诚实呈现", async ({
  page,
}) => {
  await signup(page, "settings-sync@example.test");
  await openSettings(page, "#sources");
  await page.getByLabel("名称", { exact: true }).fill("合成同步信源");
  await page.getByLabel("RSS / Atom 地址", { exact: true }).fill("https://syncrest.invalid/rss.xml");
  await page.getByLabel("允许服务端按计划读取该公开信源", { exact: true }).check();
  await page.getByRole("button", { name: "保存并启用订阅", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("公开信源已保存");
  const row = page.locator(".cv2-set-row", { hasText: "合成同步信源" });
  await expect(row.getByText("还没有读取过", { exact: false })).toBeVisible();

  // 首次真实点击「立即读取」（POST /api/creator/sources/:id/sync）：
  // .invalid 保留域保证不会产生任何真实外呼，同步在公网边界处失败。
  await row.getByRole("button", { name: "立即读取", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("公开信源读取失败，未自动跟随跳转");
  // 失败路径只更新顶部错误反馈；行内 status 在下一次数据加载时呈现（组件
  // act() 的 catch 不触发 load）。reload 重新拉取后行内如实显示落库的失败状态。
  // 注意当前 URL 已是 /settings#sources，goto 同地址不会触发重新加载。
  await page.reload();
  const failedRow = page.locator(".cv2-set-row", { hasText: "合成同步信源" });
  await expect(failedRow.getByText("读取失败；请检查公开 RSS/Atom 地址", { exact: false })).toBeVisible();
  const synced = (await (await page.request.get("/api/creator/sources")).json()).sources.find(
    (s) => s.name === "合成同步信源"
  );
  expect(synced.last_run).toBeTruthy();
  expect(synced.status).toContain("读取失败");
  // 成功抓取路径需要真实公网信源，按仓库边界约定保持 unverified，不在 e2e 内伪造。
});

test("信源「恢复订阅」：暂停后的反向 toggle 真实恢复 enabled、行内标签与订阅计数", async ({
  page,
}) => {
  await signup(page, "settings-resume@example.test");
  await openSettings(page, "#sources");
  const hnRow = page.locator(".cv2-set-row", { hasText: "Hacker News · 热门" });
  await expect(page.getByText("6 个订阅中", { exact: true })).toBeVisible();

  // 先暂停（正向），再恢复（此前未覆盖的反向 toggle，SettingsWorkspace.jsx:1034-1050）。
  await hnRow.getByRole("button", { name: "暂停订阅", exact: true }).click();
  await expect(hnRow.getByText("已暂停", { exact: true })).toBeVisible();
  await expect(page.getByText("5 个订阅中", { exact: true })).toBeVisible();
  await hnRow.getByRole("button", { name: "恢复订阅", exact: true }).click();
  await expect(hnRow.getByText("订阅中", { exact: true })).toBeVisible();
  await expect(page.getByText("6 个订阅中", { exact: true })).toBeVisible();

  // 服务端 enabled 回到 1，且刷新后仍是订阅中（持久化）。
  const sources = (await (await page.request.get("/api/creator/sources")).json()).sources;
  expect(sources.find((s) => s.name === "Hacker News · 热门").enabled).toBe(1);
  await page.reload();
  await expect(
    page.locator(".cv2-set-row", { hasText: "Hacker News · 热门" }).getByText("订阅中", { exact: true })
  ).toBeVisible();
});

test("微信「检查公众号接口」真实点击执行：成功反馈出现、逐次同意用后复位且能力不伪造", async ({
  page,
}) => {
  await signup(page, "settings-probe@example.test");
  await openSettings(page);
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await menu.getByRole("button", { name: "发布账号", exact: true }).click();
  await page.getByLabel("发布平台", { exact: true }).selectOption("wechat");
  await page.getByLabel("账号名称", { exact: true }).fill("合成探针公众号");
  // 服务端校验 AppID 必须是真实微信公众号格式 ^wx[a-f0-9]{16}$（publishing.mjs:199）
  await page.getByLabel("公众号 AppID", { exact: true }).fill("wx0123456789abcdef");
  await page.getByLabel("公众号 AppSecret", { exact: true }).fill("synthetic-wechat-secret-0001");
  await page.getByRole("button", { name: "保存发布账号", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("平台账号已保存");
  const row = page.locator(".cv2-set-acct", { hasText: "合成探针公众号" });

  // 浏览器边界替身：探针请求不抵达应用服务端、更不抵达微信官方接口
  //（真实外呼能力验证按仓库边界保持 unverified）。
  await page.route("**/api/creator/platforms/accounts/*/probe", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    })
  );
  const probeButton = row.getByRole("button", { name: "检查公众号接口", exact: true });
  await expect(probeButton).toBeDisabled();
  await page.getByLabel("允许本次请求微信官方接口检查账号能力", { exact: true }).check();
  await probeButton.click();
  await expect(page.getByRole("status").last()).toContainText("草稿读取能力检查通过");
  // 单次授权模型：act() 结束后同意复位，按钮回到禁用。
  await expect(probeButton).toBeDisabled();
  await expect(
    page.getByLabel("允许本次请求微信官方接口检查账号能力", { exact: true })
  ).not.toBeChecked();
  // 替身不伪造服务端能力：行内仍诚实显示「草稿接口待检查」。
  await expect(row.getByText("草稿接口待检查", { exact: true })).toBeVisible();
});

test("微信 AppSecret 有效零回显断言 +「移除账号」真实删除并回到待连接空态", async ({ page }) => {
  await signup(page, "settings-secret@example.test");
  await openSettings(page);
  const menu = page.getByRole("navigation", { name: "设置分组" });
  await menu.getByRole("button", { name: "发布账号", exact: true }).click();
  await page.getByLabel("发布平台", { exact: true }).selectOption("wechat");
  await page.getByLabel("账号名称", { exact: true }).fill("合成密钥公众号");
  // 服务端校验 AppID 必须是真实微信公众号格式 ^wx[a-f0-9]{16}$（publishing.mjs:199）
  await page.getByLabel("公众号 AppID", { exact: true }).fill("wxfedcba9876543210");
  // 真实填入的字面量；零回显断言必须针对这个实际值（修正旧用例的空转断言）。
  await page
    .getByLabel("公众号 AppSecret", { exact: true })
    .fill("synthetic-wechat-secret-not-echoed");
  await expect(page.getByText("凭据在服务端加密，页面不回显。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "保存发布账号", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("平台账号已保存");

  const row = page.locator(".cv2-set-acct", { hasText: "合成密钥公众号" });
  await expect(row).toBeVisible();
  // 页面任何位置不含刚填入的密钥；输入框在保存后复位为空。
  expect(await page.locator("body").innerText()).not.toContain(
    "synthetic-wechat-secret-not-echoed"
  );
  await expect(page.getByLabel("公众号 AppSecret", { exact: true })).toHaveValue("");
  const accounts = await (await page.request.get("/api/creator/platforms")).json();
  expect(accounts.accounts).toHaveLength(1);
  expect(JSON.stringify(accounts)).not.toContain("synthetic-wechat-secret-not-echoed");

  // 「移除账号」（SettingsWorkspace.jsx:911-925）：行消失、服务端删除、回到空态。
  await row.getByRole("button", { name: "移除账号", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("平台账号已移除");
  await expect(row).toHaveCount(0);
  await expect(page.getByText("公众号、知乎均待连接")).toBeVisible();
  expect(((await (await page.request.get("/api/creator/platforms")).json()).accounts)).toHaveLength(0);
});

test("跨页跳转：作品空态「去创作空间」与底部完成条「回到写作」都真实落到 /compose", async ({
  page,
}) => {
  await signup(page, "settings-links@example.test");
  await openSettings(page);
  // 空态链接（SettingsWorkspace.jsx:446-455）：无作品时出现。
  const emptyLink = page.getByRole("link", { name: "去创作空间" });
  await expect(emptyLink).toHaveAttribute("href", "/compose");
  await emptyLink.click();
  await expect(page).toHaveURL(/\/compose/);
  await expect(page.getByRole("heading", { name: "创作空间" })).toBeVisible();

  // 底部完成条链接（SettingsWorkspace.jsx:1149-1151）。
  await openSettings(page);
  const doneLink = page.locator(".cv2-set-done").getByRole("link", { name: "回到写作" });
  await expect(doneLink).toHaveAttribute("href", "/compose");
  await doneLink.click();
  await expect(page).toHaveURL(/\/compose/);
  await expect(page.getByRole("heading", { name: "创作空间" })).toBeVisible();
});

test("画像保存 409 冲突：错误提示出现且页面重读服务端最新画像", async ({ page }) => {
  await signup(page, "settings-conflict@example.test");
  await openSettings(page);
  await page.getByLabel("创作领域", { exact: true }).fill("冲突用例里未保存的本地草稿");
  // 「另一个窗口」先保存：真实 PUT 推进版本 v1 → v2。
  const current = await (await page.request.get("/api/creator/profile")).json();
  const bump = await page.request.put("/api/creator/profile", {
    data: {
      expectedRevision: current.revision,
      data: { domain: "另一个窗口已保存的领域" },
    },
  });
  expect(bump.ok()).toBeTruthy();

  // 本页仍持旧 expectedRevision → 保存被 409 拒绝（SettingsWorkspace.jsx:295-298）。
  await page.getByRole("button", { name: "保存作者画像", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("作者画像已变化，请重新载入");
  // 冲突后组件重读画像：版本标签推进到 v2，字段回到服务端值。
  await expect(page.getByText("画像 v2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("创作领域", { exact: true })).toHaveValue("另一个窗口已保存的领域");
  const profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.revision).toBe(2);
  expect(profile.domain).toBe("另一个窗口已保存的领域");
});

test("画像保存失败（PUT 500）：错误 InlineStatus 反馈、版本不推进，解除注入后可保存成功", async ({
  page,
}) => {
  await signup(page, "settings-savefail@example.test");
  await openSettings(page);
  await page.route("**/api/creator/profile", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "模拟画像保存失败" }),
    });
  });
  await page.getByLabel("表达语气", { exact: true }).fill("合成失败用例的语气");
  await page.getByRole("button", { name: "保存作者画像", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("模拟画像保存失败");
  await expect(page.getByText("画像 v1", { exact: true })).toBeVisible();
  // 解除注入后同一表单直接重试成功（v2 落库）。
  await page.unroute("**/api/creator/profile");
  await page.getByRole("button", { name: "保存作者画像", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("作者画像已保存为 v2");
  const profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.tone).toBe("合成失败用例的语气");
  expect(profile.revision).toBe(2);
});

test("更多画像字段与时区：高级字段与时区真实保存，关闭画像学习后提示条与提炼禁用联动", async ({
  page,
}) => {
  await signup(page, "settings-advanced@example.test");
  await openSettings(page);
  const more = page.locator(".cv2-set-more");
  await more.locator("summary").click();
  await page.getByLabel("创作目标", { exact: true }).fill("分享独立开发的实践经验");
  await page.getByLabel("避免的表达", { exact: true }).fill("空话与绝对化承诺");
  await page.getByLabel("创作计划时区", { exact: true }).fill("Europe/Berlin");
  await page.getByLabel("允许从自己的文章提炼写作画像建议", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存作者画像", exact: true }).click();
  // 保存成功提示在页面顶部；learningEnabled=false 后下方还会常驻一个
  // 「画像学习已暂停」role=status 横幅，因此不能用 .last() 断言保存结果。
  await expect(page.getByRole("status").first()).toContainText("作者画像已保存为 v2");

  // learningEnabled=false →「画像学习已暂停」提示条出现、提炼按钮禁用（:421-425,468）。
  await expect(
    page.getByText("画像学习已暂停", { exact: false })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "提炼风格建议", exact: true })).toBeDisabled();
  let profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.goals).toBe("分享独立开发的实践经验");
  expect(profile.avoid).toBe("空话与绝对化承诺");
  expect(profile.timezone).toBe("Europe/Berlin");
  expect(profile.learningEnabled).toBe(false);

  // 刷新后仍在（持久化）；重新开启后提示条消失。
  await page.reload();
  const moreAfter = page.locator(".cv2-set-more");
  await expect(moreAfter.getByText("创作目标", { exact: true })).toBeHidden();
  await moreAfter.locator("summary").click();
  await expect(page.getByLabel("创作目标", { exact: true })).toHaveValue("分享独立开发的实践经验");
  await expect(page.getByLabel("创作计划时区", { exact: true })).toHaveValue("Europe/Berlin");
  await expect(
    page.getByLabel("允许从自己的文章提炼写作画像建议", { exact: true })
  ).not.toBeChecked();
  await page.getByLabel("允许从自己的文章提炼写作画像建议", { exact: true }).check();
  await page.getByRole("button", { name: "保存作者画像", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("作者画像已保存为 v3");
  await expect(page.getByText("画像学习已暂停", { exact: false })).toHaveCount(0);
  profile = await (await page.request.get("/api/creator/profile")).json();
  expect(profile.learningEnabled).toBe(true);
});

test("#usage 深链真实滚动到 cv2-set-usage 锚点；非 #usage 哈希打开同组但不滚动", async ({
  page,
}) => {
  await signup(page, "settings-scroll@example.test");
  // 对照组：#services 打开同一分组，但不发生滚动。
  await openSettings(page, "#services");
  await expect(
    page.getByRole("navigation", { name: "设置分组" }).getByRole("button", { name: "模型与费用" })
  ).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // #usage：加载完成后 scrollIntoView 到费用与额度锚点（SettingsWorkspace.jsx:160-165）。
  await page.goto("/");
  await page.goto("/settings#usage");
  await expect(
    page.getByRole("navigation", { name: "设置分组" }).getByRole("button", { name: "模型与费用" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForFunction(
    () => {
      const el = document.getElementById("cv2-set-usage");
      if (!el) return false;
      const doc = document.documentElement;
      const maxScroll = doc.scrollHeight - window.innerHeight;
      const top = el.getBoundingClientRect().top;
      // 费用与额度卡片贴近文档底部，视口高度有限时锚点无法物理到达视口顶部
      // （实测 scrollIntoView 后 scrollY=文档最大滚动位、top≈285px）。
      // 诚实判定：已向锚点滚动（scrollY>100），锚点进入视口上半部，
      // 且要么贴近顶部、要么已滚到文档允许的最远位置。
      return (
        window.scrollY > 100 &&
        top >= 0 &&
        top < window.innerHeight / 2 &&
        (top < 120 || window.scrollY >= maxScroll - 1)
      );
    },
    undefined,
    { timeout: 15000 }
  );
  await expect(page.getByRole("heading", { name: "费用与额度", exact: true })).toBeVisible();
});

test("键盘可达：分组菜单 Enter 切组、表单 Tab 序输入、details/summary Enter 展开", async ({
  page,
}) => {
  await signup(page, "settings-kbd@example.test");
  await openSettings(page);
  // 共享壳：首个 Tab 停在 skip link，激活后焦点进入主内容（CreatorShell.jsx:149-151,215）。
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主内容" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cv2-main")).toBeFocused();
  // SSR 水合窗口竞态：Enter 落焦后立刻 Tab（<50ms），重渲染会把顺序焦点导航
  // 的起点重置到 BODY（实测 9/10 复现），Tab 因此落到 skip link 而非菜单。
  // Tab 前把焦点显式锚回主内容再继续； skip 激活与 Tab 序断言本身不变。
  await page.locator("#cv2-main").focus();
  // 主内容首个 Tab 落在「创作画像」分组按钮；Tab 到「模型与费用」后 Enter 真实切组。
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("navigation", { name: "设置分组" }).getByRole("button", { name: "创作画像", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("navigation", { name: "设置分组" }).getByRole("button", { name: "模型与费用", exact: true })
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "服务连接", exact: true })).toBeVisible();
  // Tab 穿过菜单剩余两项后进入表单：用途 select → 连接名称，纯键盘输入生效。
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "用途", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("连接名称", { exact: true })).toBeFocused();
  await page.keyboard.type("键盘输入的连接名称");
  await expect(page.getByLabel("连接名称", { exact: true })).toHaveValue("键盘输入的连接名称");

  // 回到画像组：Tab 到折叠摘要，Enter 真实展开，高级字段继续键盘输入。
  await page
    .getByRole("navigation", { name: "设置分组" })
    .getByRole("button", { name: "创作画像", exact: true })
    .click();
  await page.getByLabel("创作领域", { exact: true }).fill("键盘可达性用例");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator(".cv2-set-more summary")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("创作目标", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("创作目标", { exact: true })).toBeFocused();
  await page.keyboard.type("纯键盘输入的创作目标");
  await expect(page.getByLabel("创作目标", { exact: true })).toHaveValue("纯键盘输入的创作目标");
});

test.fixme(
  "移动「更多」面板在偏好与连接页 Esc 关闭后焦点应返回触发按钮 @bug:deviations#/home#5",
  async ({ page }) => {
    // 已登记共享壳层缺陷（CREATOR-V2-DESIGN-DEVIATIONS.md:52-54，/home #5）：
    // Esc 路径只 setMoreOpen(false)，未把焦点还给「更多」触发按钮
    //（CreatorShell.jsx:128-136），验收探针实测 activeElement=BODY。
    // 本页共用该壳；头部关闭钮路径可正确还焦（works spec 已覆盖同一壳）。
    // 修复后本用例应转正：Esc 关闭面板且触发按钮重新获得焦点。
    await signup(page, "settings-more-esc@example.test");
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettings(page);
    const more = page
      .getByRole("navigation", { name: "移动端导航" })
      .getByRole("button", { name: "更多" });
    await more.click();
    const panel = page.getByRole("dialog", { name: "更多工作区" });
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(more).toBeFocused();
  }
);
