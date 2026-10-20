import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 library (/library) e2e — real routes, real SQLite domain
// services, no fixtures: an isolated worker-scoped production server
// (same pattern as e2e/creator-v2-works.spec.mjs / creator-v2-publish.spec.mjs)
// runs with multiuser sessions and NO model/image provider configured.
// Coverage per the page scope: honest empty library, the design's
// collection cards driving the REAL server-side kind filter, the
// 全部/文章/链接/图片 chips and search over GET /api/creator/library,
// the import modal's three real paths (note via POST materials, link via
// the explicit-consent import-url boundary, file/image upload), tags +
// archive through PUT library/meta, the detail panel with real 关联作品
// (usage rows from creator context refs) and delivery facts, the removal
// impact flow (removal-preview → remove-source with consent), the
// reusable visual-series overview (small read-only adapter), actionable
// error states when the list API fails, and the 390×844 mobile layout
// without horizontal overflow.
//
// 2026-10-20 交互缺口补齐（不改动既有用例）：更多筛选折叠区（内容系列/
// 关联平台/起止日期/标签 + 清除筛选条件，全部走既有 API 服务端参数）、
// 「链接」「图片」类型 chip、「上传本地文件」三路径（文档 POST materials
// kind=file、图片 POST /api/assets、类型/大小门槛）与「取消」按钮路径、
// 图片素材详情大图与网格缩略图 onError 回退、详情面板「关闭详情」、
// 详情内容加载失败错误态 + 重试、文章详情「下载主稿」Blob 与「打开文章」
// 深链、「查看原始来源 ↗」外链新窗与「关联作品」行深链、移除流失败路径
// （removal-preview 失败重试 + 画像真实变化后 remove-source 409）、
// 视觉系列总览失败重试与「前往视觉工作台」、壳层页内导航（侧栏 10 工作区、
// 顶栏 看热点/新建作品、完成条 用素材发现选题）、键盘可达（跳到主内容）、
// 移动端补充覆盖；「更多」面板 Esc 收起断言补齐，Esc 不还焦触发按钮的
// 已知缺陷按登记写成 test.fixme（CREATOR-V2-DESIGN-DEVIATIONS 全局壳层 #5）。

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
      const root = mkdtempSync(join(tmpdir(), "studio-creator-library-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "library.sqlite"),
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
        if (!ready) throw Error("Library server did not start " + logs);
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

// 1×1 synthetic PNG (never real user content)
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function signup(page, email) {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成素材库作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

async function openLibrary(page) {
  await page.goto("/library");
  await expect(
    page.getByRole("heading", { name: "素材不是仓库，是作品的上下文" })
  ).toBeVisible();
}

const card = (page, title) =>
  page.getByRole("button", { name: `查看素材详情：${title}` });

test("空素材库：三张集合格、诚实空态与可开关的导入弹窗", async ({ page }) => {
  await signup(page, "library-empty@example.test");
  await openLibrary(page);
  const collections = page.getByRole("group", { name: "内容资料夹分类" });
  await expect(collections.getByRole("button")).toHaveCount(3);
  await expect(
    collections.getByRole("button", { name: /全部素材/ })
  ).toHaveAttribute("aria-pressed", "true");
  // 没有数据时是诚实空态，不渲染任何编造的素材卡
  await expect(page.getByText("素材库还是空的", { exact: false })).toBeVisible();
  await expect(page.locator("button.cv2-asset-card")).toHaveCount(0);
  // 可复用视觉系列：无系列时如实说明，不伪造
  await expect(
    page.getByText("还没有视觉系列", { exact: false })
  ).toBeVisible();

  // 导入弹窗：短标题不可提交，Esc 可关闭
  await page.getByRole("button", { name: "导入素材" }).click();
  const dialog = page.getByRole("dialog", { name: "导入素材" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("素材标题或网址")).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: /保存素材/ })
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("笔记/链接/图片/文章四类素材真实落库，集合格与 chip 驱动服务端筛选", async ({
  page,
}) => {
  await signup(page, "library-filter@example.test");
  // 参考笔记：走页面导入弹窗（真实 POST /api/creator/materials）
  await openLibrary(page);
  await page.getByRole("button", { name: "导入素材" }).click();
  const dialog = page.getByRole("dialog", { name: "导入素材" });
  await page.getByLabel("素材标题或网址").fill("城市漫步的观察方法笔记");
  await page
    .getByLabel("内容或摘录")
    .fill("先记录路线，再标注人群行为差异；样本有限，不做普遍结论。");
  await dialog.getByRole("button", { name: /保存素材/ }).click();
  await expect(page.getByRole("status").last()).toContainText("参考笔记已保存");

  // 公开线索与图片、文章：走真实既有 API 造数
  const link = await page.request.post("/api/creator/materials", {
    data: {
      kind: "link",
      title: "独立开发者的定价讨论",
      body: "公开讨论摘录，等待核实。",
      url: "https://example.test/pricing-thread",
    },
  });
  expect(link.status()).toBe(201);
  const image = await page.request.post("/api/assets", {
    data: { name: "synthetic-cover.png", alt: "合成封面图", base64: PNG_1X1 },
  });
  expect(image.status()).toBe(201);
  const project = await page.request.post("/api/writing/projects", {
    data: { title: "城市漫步写作实践" },
  });
  expect(project.ok()).toBeTruthy();

  await page.reload();
  const grid = page.locator("button.cv2-asset-card");
  await expect(grid).toHaveCount(4);
  // 四种设计卡片类型对应真实 kind
  await expect(card(page, "城市漫步的观察方法笔记").getByText("研究资料", { exact: true })).toBeVisible();
  await expect(card(page, "独立开发者的定价讨论").getByText("公开线索", { exact: true })).toBeVisible();
  await expect(card(page, "独立开发者的定价讨论").getByText("公开来源 · 等待核实")).toBeVisible();
  await expect(card(page, "合成封面图").getByText("视觉资产", { exact: true })).toBeVisible();
  await expect(card(page, "城市漫步写作实践").getByText("作品参考", { exact: true })).toBeVisible();

  // 集合格联动：参考线索 → 只剩两条素材，搜索占位随集合切换（设计 :185）
  await page
    .getByRole("group", { name: "内容资料夹分类" })
    .getByRole("button", { name: /参考线索/ })
    .click();
  await expect(grid).toHaveCount(2);
  await expect(page.getByLabel("搜索素材或作品")).toHaveAttribute(
    "placeholder",
    "在「参考线索」中搜索…"
  );
  await expect(card(page, "城市漫步的观察方法笔记")).toBeVisible();
  await expect(card(page, "独立开发者的定价讨论")).toBeVisible();
  await expect(card(page, "合成封面图")).toHaveCount(0);

  // 视觉素材集合 → 只剩图片
  await page
    .getByRole("group", { name: "内容资料夹分类" })
    .getByRole("button", { name: /视觉素材/ })
    .click();
  await expect(grid).toHaveCount(1);
  await expect(card(page, "合成封面图")).toBeVisible();

  // chip：文章 → 只剩作品；全部 → 恢复四张
  await page.getByRole("button", { name: "文章", exact: true }).click();
  await expect(grid).toHaveCount(1);
  await expect(card(page, "城市漫步写作实践")).toBeVisible();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(grid).toHaveCount(4);

  // 搜索即时过滤（服务端 q 参数；≥3 字符走 FTS，需与完整中文字段一致）
  await page.getByLabel("搜索素材或作品").fill("独立开发者的定价讨论");
  await expect(grid).toHaveCount(1);
  await expect(card(page, "独立开发者的定价讨论")).toBeVisible();
  await page.getByLabel("搜索素材或作品").fill("不存在的素材关键词");
  await expect(page.getByText("没有匹配的素材", { exact: false })).toBeVisible();
  await page.getByLabel("搜索素材或作品").fill("");
});

test("详情面板：标签/归档真实保存、关联作品来自 context 引用、创建选题跳转", async ({
  page,
}) => {
  await signup(page, "library-detail@example.test");
  const material = await (
    await page.request.post("/api/creator/materials", {
      data: { title: "待引用的研究笔记", body: "作者自己记录的观察方法与边界。" },
    })
  ).json();
  const project = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "引用这篇笔记的作品" },
    })
  ).json();
  // 真实引用：把素材挂到作品上下文 → library.usage 出现关联作品
  const ref = await page.request.put(
    "/api/creator/projects/" + project.projectId + "/context",
    { data: { expectedRevision: 0, refs: [{ kind: "material", id: material.id }] } }
  );
  expect(ref.ok()).toBeTruthy();

  await openLibrary(page);
  const item = card(page, "待引用的研究笔记");
  await expect(item.getByText("已关联 1 篇作品")).toBeVisible();
  await item.click();
  const detail = page.getByRole("region", { name: "素材详情" });
  await expect(detail).toBeVisible();
  await expect(detail.getByText("作者自己记录的观察方法与边界。")).toBeVisible();
  await expect(detail.getByText("关联作品")).toBeVisible();
  await expect(detail.getByText("引用这篇笔记的作品")).toBeVisible();

  // 标签保存：真实 PUT library/meta，随后 API 可按标签筛出
  await detail.getByLabel("资产标签").fill("观察方法, 合成");
  await detail.getByRole("button", { name: "保存标签" }).click();
  await expect(page.getByRole("status").last()).toContainText("标签已保存");
  const tagged = await (
    await page.request.get("/api/creator/library?tag=" + encodeURIComponent("观察方法"))
  ).json();
  assertLibraryIds(tagged, [material.id]);

  // 归档：卡片从现行列表消失，「查看已归档」可找回并恢复
  await detail.getByRole("button", { name: "归档资产" }).click();
  await expect(page.getByRole("status").last()).toContainText("资产已归档");
  await expect(card(page, "待引用的研究笔记")).toHaveCount(0);
  await page.getByRole("button", { name: "查看已归档" }).click();
  await expect(card(page, "待引用的研究笔记")).toBeVisible();
  await card(page, "待引用的研究笔记").click();
  await page.getByRole("region", { name: "素材详情" })
    .getByRole("button", { name: "恢复资产" })
    .click();
  await expect(page.getByRole("status").last()).toContainText("资产已恢复");
  await page.getByRole("button", { name: "查看已归档" }).click();
  await expect(card(page, "待引用的研究笔记")).toBeVisible();

  // 以此为素材创建选题 → 真实 POST topics 后深链到 /topics?topic=
  await card(page, "待引用的研究笔记").click();
  await page
    .getByRole("region", { name: "素材详情" })
    .getByRole("button", { name: "以此为素材创建选题 →" })
    .click();
  await expect(page).toHaveURL(/\/topics\?topic=tp_/);
});

test("导入链接：未同意不可提交，服务端对非公开链接返回可操作错误", async ({
  page,
}) => {
  await signup(page, "library-import@example.test");
  await openLibrary(page);
  await page.getByRole("button", { name: "导入素材" }).click();
  const dialog = page.getByRole("dialog", { name: "导入素材" });
  await page
    .getByLabel("素材标题或网址")
    .fill("https://127.0.0.1/synthetic-page");
  // 同意门槛：勾选前不可发起读取（服务端同样 fail-closed）
  const importBtn = dialog.getByRole("button", { name: /导入链接内容/ });
  await expect(importBtn).toBeDisabled();
  const denied = await page.request.post("/api/creator/materials/import-url", {
    data: { url: "https://127.0.0.1/synthetic-page", allowExternalRequest: false },
  });
  expect(denied.status()).toBe(403);
  await dialog.getByText("确认读取此链接并保存摘录（仅公开页面，本次授权）").click();
  await expect(importBtn).toBeEnabled();
  // 环回地址不是公开页面：真实服务端校验给出可操作错误，不伪造成功
  await importBtn.click();
  await expect(dialog.locator(".cv2-status.is-error")).toContainText(
    /非公网|HTTPS|公开|链接/
  );
  await expect(page.locator(".cv2-status.is-success")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("移除影响：预览真实涉及范围，确认后素材从资料夹移除且列表刷新", async ({
  page,
}) => {
  await signup(page, "library-removal@example.test");
  const material = await (
    await page.request.post("/api/creator/materials", {
      data: { title: "准备移除的合成笔记", body: "移除后不再参与画像推断。" },
    })
  ).json();
  const project = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "关联被移除素材的文章" },
    })
  ).json();
  await page.request.put("/api/creator/projects/" + project.projectId + "/context", {
    data: { expectedRevision: 0, refs: [{ kind: "material", id: material.id }] },
  });

  await openLibrary(page);
  await card(page, "准备移除的合成笔记").click();
  const detail = page.getByRole("region", { name: "素材详情" });
  await detail.getByText("移除素材并查看画像影响").click();
  await detail.getByRole("button", { name: "查看影响范围", exact: true }).click();
  await expect(detail.getByText(/涉及 1 篇文章/)).toBeVisible();
  const confirm = detail.getByRole("button", {
    name: "确认移除来源并撤销相关推断",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await detail.getByLabel("我已核对影响范围，并理解历史与备份保留").check();
  await confirm.click();
  await expect(page.getByRole("status").last()).toContainText("来源已移除");
  // 素材从资料夹消失（真实 creator_source_removals 标记）；同库的文章保留
  await expect(card(page, "准备移除的合成笔记")).toHaveCount(0);
  const after = await (await page.request.get("/api/creator/library")).json();
  expect((after.assets || []).map((a) => a.id)).not.toContain(material.id);
  expect(
    (after.assets || []).map((a) => a.id)
  ).toContain(project.projectId);
});

test("可复用视觉系列：只读总览显示真实系列、成员数与所属作品", async ({
  page,
}) => {
  await signup(page, "library-series@example.test");
  const a = await (
    await page.request.post("/api/writing/projects", { data: { title: "系列主作品" } })
  ).json();
  const b = await (
    await page.request.post("/api/writing/projects", { data: { title: "加入系列的作品" } })
  ).json();
  const series = await (
    await page.request.post(`/api/illustrations/projects/${a.projectId}/series`, {
      data: {
        name: "城市漫步统一视觉",
        profile: { name: "自然编辑", palette: "暖白蓝", mood: "克制", avoid: "虚假截图" },
      },
    })
  ).json();
  expect(series.id).toMatch(/^vs_/);
  const joined = await page.request.post(
    `/api/illustrations/projects/${b.projectId}/series/join`,
    { data: { seriesId: series.id } }
  );
  expect(joined.ok()).toBeTruthy();

  await openLibrary(page);
  const band = page.getByRole("region", { name: "可复用视觉系列" });
  await expect(band.getByText("城市漫步统一视觉")).toBeVisible();
  await expect(band.getByText(/修订 v1 · 2 篇作品/)).toBeVisible();
  await expect(band.getByText(/所属作品《系列主作品》/)).toBeVisible();
});

test("列表接口失败时呈现可操作错误，重试后恢复真实数据", async ({ page }) => {
  await signup(page, "library-error@example.test");
  await page.request.post("/api/creator/materials", {
    data: { title: "重试后应出现的素材", body: "服务恢复后可见。" },
  });
  // 只拦截资料列表本身；visual-series / removal-preview 等子路径不受影响
  const listPattern = /\/api\/creator\/library\?/;
  await page.route(listPattern, (route) => route.abort());
  await openLibrary(page);
  // role=alert 还包括 Next 的 route announcer，这里限定页面自己的错误态
  const alert = page.locator("div.cv2-error-state");
  await expect(alert).toContainText("素材库加载失败");
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
  await page.unroute(listPattern);
  await alert.getByRole("button", { name: "重试" }).click();
  await expect(card(page, "重试后应出现的素材")).toBeVisible();
});

test("移动 390×844：单列集合与网格、更多面板高亮素材库、无横向溢出", async ({
  page,
}) => {
  await signup(page, "library-mobile@example.test");
  await page.request.post("/api/creator/materials", {
    data: { title: "移动端视口素材", body: "在 390 宽度下检查布局。" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  const collections = page.getByRole("group", { name: "内容资料夹分类" });
  await expect(collections.getByRole("button")).toHaveCount(3);
  // 页头导入按钮收成图标圆钮，可访问名不变，仍可打开弹窗
  const importBtn = page.getByRole("button", { name: "导入素材" });
  await expect(importBtn).toBeVisible();
  // 底部导航：素材库属于「更多」面板
  const moreNav = page.getByRole("navigation", { name: "移动端导航" });
  await moreNav.getByRole("button", { name: "更多" }).click();
  await expect(
    page.getByRole("dialog", { name: "更多工作区" }).getByRole("link", { name: "素材库" })
  ).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(card(page, "移动端视口素材")).toBeVisible();
  await importBtn.click();
  await expect(page.getByRole("dialog", { name: "导入素材" })).toBeVisible();
});

// ---------- 交互缺口补齐（2026-10-20 审计） ----------

const isoDay = (date) => date.toISOString().slice(0, 10);

test("更多筛选折叠区：展开真实筛选项，标签与起止日期走服务端筛选，清除一键还原", async ({
  page,
}) => {
  await signup(page, "library-advanced@example.test");
  const a = await (
    await page.request.post("/api/creator/materials", {
      data: { title: "带标签的合成观察笔记", body: "作者手动整理的观察方法。" },
    })
  ).json();
  await page.request.post("/api/creator/materials", {
    data: { title: "未打标签的合成速记", body: "另一条参考素材。" },
  });
  const tagged = await page.request.put("/api/creator/library/meta", {
    data: { kind: "material", id: a.id, tags: ["观察方法"], archived: false },
  });
  expect(tagged.ok()).toBeTruthy();

  await openLibrary(page);
  const grid = page.locator("button.cv2-asset-card");
  await expect(grid).toHaveCount(2);
  await page.getByText("更多筛选（系列、平台、日期与标签）").click();
  for (const name of [
    "筛选内容系列",
    "筛选关联平台",
    "创建日期起",
    "创建日期止",
    "筛选标签",
  ]) {
    await expect(page.getByLabel(name)).toBeVisible();
  }

  // 标签精确匹配是既有 API 的服务端 tag 参数
  await page.getByLabel("筛选标签").fill("观察方法");
  await expect(grid).toHaveCount(1);
  await expect(card(page, "带标签的合成观察笔记")).toBeVisible();
  await page.getByLabel("筛选标签").fill("不存在的合成标签");
  await expect(grid).toHaveCount(0);
  await page.getByLabel("筛选标签").fill("");
  await expect(grid).toHaveCount(2);

  // 起止日期是服务端 from/to 参数（北京时间边界，均按真实 createdAt 过滤）
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86400000));
  await page.getByLabel("创建日期起").fill(today);
  await expect(grid).toHaveCount(2);
  await page.getByLabel("创建日期起").fill("");
  await page.getByLabel("创建日期止").fill(yesterday);
  await expect(grid).toHaveCount(0);
  await page.getByLabel("创建日期止").fill("");
  await expect(grid).toHaveCount(2);

  // 「清除筛选条件」同时重置高级筛选、搜索、类型与归档开关
  await page.getByLabel("创建日期止").fill(yesterday);
  await page.getByLabel("搜索素材或作品").fill("未打标签的合成速记");
  await expect(grid).toHaveCount(0);
  await page.getByRole("button", { name: "清除筛选条件" }).click();
  await expect(grid).toHaveCount(2);
  await expect(page.getByLabel("搜索素材或作品")).toHaveValue("");
  await expect(page.getByLabel("创建日期止")).toHaveValue("");
  await expect(page.getByLabel("搜索素材或作品")).toHaveAttribute(
    "placeholder",
    "搜索素材或作品…"
  );
  await expect(
    page
      .getByRole("group", { name: "按类型筛选" })
      .getByRole("button", { name: "全部", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
});

test("更多筛选：内容系列与关联平台下拉走真实 series/platform 服务端筛选", async ({
  page,
}) => {
  await signup(page, "library-advanced-series@example.test");
  // 内容系列：建系列 → 系列选题真实「开始创作」→ 作品归属该系列
  const series = await (
    await page.request.post("/api/creator/series", {
      data: {
        name: "城市漫步合成系列",
        goal: "城市漫步长期观察",
        entries: ["城市漫步系列第一篇：观察方法"],
      },
    })
  ).json();
  expect(series.id).toMatch(/^sr_/);
  const started = await (
    await page.request.post(`/api/creator/topics/${series.entries[0].topic.id}/start`, {
      data: {}, // 写请求必须携带 JSON body（V58 边界契约，同 UI send）
    })
  ).json();
  expect(started.projectId).toMatch(/^ep_/);
  // 关联平台：知乎稿写入真实段落内容 + 四项人工检查 + 真实导出 → platform=zhihu
  // （素材库平台筛选来自 publishing_facts 或「渠道有真实内容」的稿，空稿不算。
  //   渠道稿为段落模式：save 接收 paragraphs 并把检查复位，需用返回的新修订。）
  const b = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "知乎渠道已导出的合成作品" },
    })
  ).json();
  const detailOf = await (
    await page.request.get(`/api/editor/projects/${b.projectId}`)
  ).json();
  const savedDoc = await (
    await page.request.put(`/api/editor/projects/${b.projectId}/zhihu/document`, {
      data: {
        expectedRevision: detailOf.channels.zhihu.document.revision,
        paragraphs: [
          { text: "知乎渠道稿的真实内容段落，导出前已完成四项人工检查。" },
        ],
      },
    })
  ).json();
  const zhihuRevision = savedDoc.channels.zhihu.document.revision;
  await page.request.post(`/api/editor/projects/${b.projectId}/zhihu/checks`, {
    data: {
      expectedRevision: zhihuRevision,
      checks: { factual: true, privacy: true, rights: true, layout: true },
    },
  });
  const exported = await page.request.post(
    `/api/editor/projects/${b.projectId}/zhihu/export`,
    { data: { expectedRevision: zhihuRevision } }
  );
  expect((await exported.json()).status).toBe("exported");

  await openLibrary(page);
  const grid = page.locator("button.cv2-asset-card");
  await expect(grid).toHaveCount(2);
  await page.getByText("更多筛选（系列、平台、日期与标签）").click();

  // 系列下拉选项来自 GET /api/creator/series，选中后只剩系列内作品
  await page.getByLabel("筛选内容系列").selectOption({ label: "城市漫步合成系列" });
  await expect(grid).toHaveCount(1);
  await expect(card(page, "城市漫步系列第一篇：观察方法")).toBeVisible();
  await expect(card(page, "知乎渠道已导出的合成作品")).toHaveCount(0);
  await page.getByLabel("筛选内容系列").selectOption({ label: "全部系列" });
  await expect(grid).toHaveCount(2);

  // 平台筛选来自真实交付事实：只有知乎导出过的作品在「知乎」平台内
  await page.getByLabel("筛选关联平台").selectOption({ label: "知乎" });
  await expect(grid).toHaveCount(1);
  await expect(card(page, "知乎渠道已导出的合成作品")).toBeVisible();
  await page.getByLabel("筛选关联平台").selectOption({ label: "全部平台" });
  await expect(grid).toHaveCount(2);
  await page.getByRole("button", { name: "清除筛选条件" }).click();
  await expect(grid).toHaveCount(2);
});

test("「链接」「图片」类型 chip：aria-pressed 真实切换并驱动 kind 服务端筛选", async ({
  page,
}) => {
  await signup(page, "library-chips@example.test");
  await page.request.post("/api/creator/materials", {
    data: { title: "芯片筛选合成笔记", body: "纯参考笔记。" },
  });
  await page.request.post("/api/creator/materials", {
    data: {
      title: "芯片筛选合成线索",
      body: "公开讨论摘录。",
      url: "https://example.test/chips",
    },
  });
  await page.request.post("/api/assets", {
    data: { name: "chips-cover.png", alt: "芯片筛选合成图", base64: PNG_1X1 },
  });
  await page.request.post("/api/writing/projects", {
    data: { title: "芯片筛选合成作品" },
  });

  await openLibrary(page);
  const grid = page.locator("button.cv2-asset-card");
  const chips = page.getByRole("group", { name: "按类型筛选" });
  await expect(grid).toHaveCount(4);
  await expect(
    chips.getByRole("button", { name: "全部", exact: true })
  ).toHaveAttribute("aria-pressed", "true");

  await chips.getByRole("button", { name: "链接", exact: true }).click();
  await expect(
    chips.getByRole("button", { name: "链接", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    chips.getByRole("button", { name: "全部", exact: true })
  ).toHaveAttribute("aria-pressed", "false");
  // kind=material：研究资料与公开线索同属参考素材
  await expect(grid).toHaveCount(2);
  await expect(card(page, "芯片筛选合成笔记")).toBeVisible();
  await expect(card(page, "芯片筛选合成线索")).toBeVisible();
  await expect(card(page, "芯片筛选合成图")).toHaveCount(0);
  await expect(card(page, "芯片筛选合成作品")).toHaveCount(0);

  await chips.getByRole("button", { name: "图片", exact: true }).click();
  await expect(grid).toHaveCount(1);
  await expect(card(page, "芯片筛选合成图")).toBeVisible();

  await chips.getByRole("button", { name: "文章", exact: true }).click();
  await expect(grid).toHaveCount(1);
  await expect(card(page, "芯片筛选合成作品")).toBeVisible();

  await chips.getByRole("button", { name: "全部", exact: true }).click();
  await expect(grid).toHaveCount(4);
});

test("导入弹窗「上传本地文件」：文档与图片真实落库，类型/大小门槛与「取消」按钮", async ({
  page,
}) => {
  await signup(page, "library-upload@example.test");
  await openLibrary(page);
  const grid = page.locator("button.cv2-asset-card");

  // 路径一：Markdown 文档 → POST /api/creator/materials（kind=file）
  await page.getByRole("button", { name: "导入素材" }).click();
  const dialog = page.getByRole("dialog", { name: "导入素材" });
  const fileInput = dialog.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "synthetic-library-note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 合成素材\n仅用于 e2e 的本地文档。"),
  });
  await expect(page.getByRole("status").last()).toContainText("文件已保存到资产库");
  await expect(dialog).not.toBeVisible();
  await expect(card(page, "synthetic-library-note.md")).toBeVisible();
  await expect(
    card(page, "synthetic-library-note.md").getByText("研究资料", { exact: true })
  ).toBeVisible();

  // 路径二：PNG 图片 → POST /api/assets
  await page.getByRole("button", { name: "导入素材" }).click();
  await fileInput.setInputFiles({
    name: "synthetic-library-cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1, "base64"),
  });
  await expect(page.getByRole("status").last()).toContainText("文件已保存到资产库");
  await expect(
    card(page, "synthetic-library-cover.png").getByText("视觉资产", { exact: true })
  ).toBeVisible();
  await expect(grid).toHaveCount(2);

  // 路径三：类型不允许 → 弹窗内可操作错误，不伪造成功
  await page.getByRole("button", { name: "导入素材" }).click();
  await fileInput.setInputFiles({
    name: "synthetic-tool.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("MZ synthetic"),
  });
  await expect(dialog.locator(".cv2-status.is-error")).toContainText(
    "参考文档支持 Markdown、TXT、CSV、JSON；图片支持 PNG、JPEG、GIF、WebP"
  );
  // 大小超限（>150KB 文本素材）→ 明确的大小提示
  await fileInput.setInputFiles({
    name: "synthetic-big.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(150001, 0x61),
  });
  await expect(dialog.locator(".cv2-status.is-error")).toContainText(
    "文本素材请控制在 150 KB 内"
  );

  // 「取消」按钮路径关闭弹窗；重开后表单状态已重置
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "导入素材" }).click();
  await expect(page.getByLabel("素材标题或网址")).toHaveValue("");
  await expect(page.getByLabel("素材标题或网址")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("图片素材预览：详情大图与网格缩略图 onError 各自回退，「关闭详情」后可恢复", async ({
  page,
}) => {
  await signup(page, "library-image-preview@example.test");
  const asset = await (
    await page.request.post("/api/assets", {
      data: { name: "preview-synthetic.png", alt: "预览回退合成图", base64: PNG_1X1 },
    })
  ).json();
  const previewPattern = /\/api\/assets\/.+\/preview/;

  await openLibrary(page);
  const grid = page.locator("button.cv2-asset-card");
  await expect(grid).toHaveCount(1);
  await expect(grid.locator("img")).toHaveAttribute(
    "src",
    `/api/assets/${asset.id}/preview`
  );

  await card(page, "预览回退合成图").click();
  const detail = page.getByRole("region", { name: "素材详情" });
  await expect(detail.locator(".cv2-lib-figure img")).toHaveJSProperty(
    "naturalWidth",
    1
  );

  // 中断真实本地预览请求：详情大图 onError 换成可操作提示（重开详情触发重载）
  await page.route(previewPattern, (route) => route.abort());
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await expect(detail).not.toBeVisible();
  await card(page, "预览回退合成图").click();
  await expect(detail.locator(".cv2-lib-figure .cv2-status.is-error")).toContainText(
    "预览加载失败"
  );

  // 网格缩略图 onError 隐藏 <img>，卡片与示意图标仍在（刷新后同样回退）
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "素材不是仓库，是作品的上下文" })
  ).toBeVisible();
  await expect(grid).toHaveCount(1);
  await grid.scrollIntoViewIfNeeded();
  await expect(grid.locator("img")).toBeHidden();

  // 解除拦截后重开详情：真实本地预览恢复，错误提示不再出现
  await page.unroute(previewPattern);
  await card(page, "预览回退合成图").click();
  await expect(detail.locator(".cv2-lib-figure img")).toHaveJSProperty(
    "naturalWidth",
    1
  );
  await expect(detail.locator(".cv2-status.is-error")).toHaveCount(0);
});

test("详情内容加载失败：GET materials/:id 失败呈现错误态，重试恢复真实正文", async ({
  page,
}) => {
  await signup(page, "library-detail-error@example.test");
  await page.request.post("/api/creator/materials", {
    data: { title: "详情加载失败的合成素材", body: "服务恢复后应显示这句话。" },
  });
  const detailPattern = /\/api\/creator\/materials\/mt_/;
  await page.route(detailPattern, (route) => route.abort());

  await openLibrary(page);
  await card(page, "详情加载失败的合成素材").click();
  const detail = page.getByRole("region", { name: "素材详情" });
  const errorState = detail.locator(".cv2-error-state");
  await expect(errorState).toContainText("素材内容加载失败");
  await expect(errorState.getByRole("button", { name: "重试" })).toBeVisible();

  await page.unroute(detailPattern);
  await errorState.getByRole("button", { name: "重试" }).click();
  await expect(detail.locator("pre.cv2-lib-text")).toContainText(
    "服务恢复后应显示这句话。"
  );
});

test("文章详情：「下载主稿」真实 Blob 下载，「打开文章」深链 /compose", async ({
  page,
}) => {
  await signup(page, "library-article-actions@example.test");
  const created = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "素材库文章动作合成作品" },
    })
  ).json();
  expect(created.projectId).toMatch(/^ep_/);

  await openLibrary(page);
  await card(page, "素材库文章动作合成作品").click();
  const detail = page.getByRole("region", { name: "素材详情" });
  await expect(detail).toBeVisible();

  // 下载主稿：GET /api/writing/projects/:id/master → Blob 下载
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    detail.getByRole("button", { name: "下载主稿" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^article-v\d+\.md$/);

  await detail.getByRole("link", { name: "打开文章" }).click();
  await expect(page).toHaveURL(
    new RegExp("/compose\\?project=" + created.projectId + "$")
  );
});

test("详情外链与关联作品行：「查看原始来源 ↗」新窗打开，「关联作品」深链 /compose", async ({
  page,
}) => {
  await signup(page, "library-links@example.test");
  const material = await (
    await page.request.post("/api/creator/materials", {
      data: {
        title: "带原始来源的合成线索",
        body: "公开页面摘录，等待核实。",
        url: "https://example.test/synthetic-library-source",
      },
    })
  ).json();
  const project = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "引用合成线索的作品" },
    })
  ).json();
  const ref = await page.request.put(
    "/api/creator/projects/" + project.projectId + "/context",
    { data: { expectedRevision: 0, refs: [{ kind: "material", id: material.id }] } }
  );
  expect(ref.ok()).toBeTruthy();

  await openLibrary(page);
  await card(page, "带原始来源的合成线索").click();
  const detail = page.getByRole("region", { name: "素材详情" });
  const sourceLink = detail.getByRole("link", { name: /查看原始来源/ });
  await expect(sourceLink).toHaveAttribute(
    "href",
    "https://example.test/synthetic-library-source"
  );
  await expect(sourceLink).toHaveAttribute("target", "_blank");
  // 新窗打开外链：本地拦截该 URL 并回以合成页面，不触网。
  // page.route 不覆盖 target=_blank 新开的 popup，必须用 context.route。
  await page.context().route("https://example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>synthetic-source</title><p>合成来源页</p>",
    })
  );
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    sourceLink.click(),
  ]);
  await expect(popup).toHaveURL("https://example.test/synthetic-library-source");
  await popup.close();

  const usageRow = detail.locator("a.cv2-lib-usage-row");
  await expect(usageRow).toHaveCount(1);
  await expect(usageRow).toContainText("引用合成线索的作品");
  await usageRow.click();
  await expect(page).toHaveURL(
    new RegExp("/compose\\?project=" + project.projectId + "$")
  );
});

test("移除流失败路径：影响范围查询失败可重试；画像变化后确认移除被服务端 409 拒绝", async ({
  page,
}) => {
  await signup(page, "library-removal-fail@example.test");
  const material = await (
    await page.request.post("/api/creator/materials", {
      data: { title: "移除失败路径合成素材", body: "409 后必须仍然存在。" },
    })
  ).json();
  const project = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "引用移除失败素材的作品" },
    })
  ).json();
  const ref = await page.request.put(
    "/api/creator/projects/" + project.projectId + "/context",
    { data: { expectedRevision: 0, refs: [{ kind: "material", id: material.id }] } }
  );
  expect(ref.ok()).toBeTruthy();

  await openLibrary(page);
  await card(page, "移除失败路径合成素材").click();
  const detail = page.getByRole("region", { name: "素材详情" });
  await detail.getByText("移除素材并查看画像影响").click();

  // 路径一：removal-preview 查询失败 → 折叠区内可操作错误；恢复后重试成功
  const previewPattern = /\/api\/creator\/library\/removal-preview/;
  await page.route(previewPattern, (route) => route.abort());
  await detail.getByRole("button", { name: "查看影响范围", exact: true }).click();
  await expect(
    detail.locator(".cv2-lib-removal .cv2-status.is-error")
  ).toBeVisible();
  await page.unroute(previewPattern);
  await detail.getByRole("button", { name: "查看影响范围", exact: true }).click();
  await expect(detail.getByText(/涉及 1 篇文章/)).toBeVisible();

  // 路径二：预览后画像真实变更 → remove-source 被服务端 409 拒绝，素材保留
  const profile = await (await page.request.get("/api/creator/profile")).json();
  const saved = await page.request.put("/api/creator/profile", {
    data: {
      expectedRevision: profile.revision,
      data: { tone: "克制、以观察为主（合成）" },
    },
  });
  expect(saved.ok()).toBeTruthy();
  await detail.getByLabel("我已核对影响范围，并理解历史与备份保留").check();
  await detail
    .getByRole("button", { name: "确认移除来源并撤销相关推断", exact: true })
    .click();
  await expect(
    detail.locator(".cv2-lib-removal .cv2-status.is-error")
  ).toContainText("画像在确认期间已变化，请重新查看影响范围");
  const still = await (await page.request.get("/api/creator/library")).json();
  expect((still.assets || []).map((a) => a.id)).toContain(material.id);

  // 恢复：重开详情重新预览（拿到新画像修订的 preview）后可完成移除
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await card(page, "移除失败路径合成素材").click();
  await detail.getByText("移除素材并查看画像影响").click();
  await detail.getByRole("button", { name: "查看影响范围", exact: true }).click();
  await detail.getByLabel("我已核对影响范围，并理解历史与备份保留").check();
  await detail
    .getByRole("button", { name: "确认移除来源并撤销相关推断", exact: true })
    .click();
  await expect(page.getByRole("status").last()).toContainText("来源已移除");
  await expect(card(page, "移除失败路径合成素材")).toHaveCount(0);
});

test("可复用视觉系列：总览加载失败可重试恢复，「前往视觉工作台」跳 /illustrations", async ({
  page,
}) => {
  await signup(page, "library-series-error@example.test");
  const a = await (
    await page.request.post("/api/writing/projects", {
      data: { title: "系列失败路径主作品" },
    })
  ).json();
  const series = await (
    await page.request.post(`/api/illustrations/projects/${a.projectId}/series`, {
      data: {
        name: "失败路径合成系列",
        profile: { name: "自然编辑", palette: "暖白蓝", mood: "克制", avoid: "虚假截图" },
      },
    })
  ).json();
  expect(series.id).toMatch(/^vs_/);

  const seriesPattern = /\/api\/creator\/library\/visual-series/;
  await page.route(seriesPattern, (route) => route.abort());
  await openLibrary(page);
  const band = page.getByRole("region", { name: "可复用视觉系列" });
  await expect(band.getByText(/视觉系列总览加载失败/)).toBeVisible();
  await page.unroute(seriesPattern);
  await band.getByRole("button", { name: "重试" }).click();
  await expect(band.getByText("失败路径合成系列")).toBeVisible();
  await expect(band.getByText(/1 篇作品/)).toBeVisible();

  await band.getByRole("link", { name: /前往视觉工作台/ }).click();
  await expect(page).toHaveURL(/\/illustrations$/);
  await expect(
    page.getByRole("navigation", { name: "面包屑" }).getByText("视觉工作台", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
});

test("壳层页内导航：侧栏 10 工作区可达，顶栏快捷动作与完成条「用素材发现选题」", async ({
  page,
}) => {
  await signup(page, "library-shell-nav@example.test");
  const sidebar = page.getByRole("navigation", { name: "创作导航" });
  const crumb = page.getByRole("navigation", { name: "面包屑" });
  const entries = [
    ["工作台", "/", /今天，先把一篇好文章写完。/],
    ["热点雷达", "/hotspots", null],
    ["选题发现", "/topics", null],
    ["创作空间", "/compose", null],
    ["视觉工作台", "/illustrations", null],
    ["作品", "/works", /每篇作品，都有清晰的下一步/],
    ["发布中心", "/publish", null],
    ["内容日历", "/calendar", /把创作节奏，安排得从容一点/],
    ["效果复盘", "/insights", /发布后，让经验回到下一篇/],
    ["素材库", "/library", /素材不是仓库，是作品的上下文/],
  ];
  for (const [label, href, headingText] of entries) {
    await page.goto("/library");
    await expect(
      page.getByRole("heading", { name: "素材不是仓库，是作品的上下文" })
    ).toBeVisible();
    await sidebar.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(href === "/" ? "/$" : href.replace("?", "\\?") + "$")
    );
    await expect(crumb.getByText(label, { exact: true })).toBeVisible();
    if (headingText) {
      await expect(page.getByRole("heading", { name: headingText })).toBeVisible();
    }
  }
  // 回到本页后侧栏「素材库」保持当前态
  await expect(
    sidebar.getByRole("link", { name: "素材库", exact: true })
  ).toHaveAttribute("aria-current", "page");

  // 顶栏快捷动作：看热点 → /hotspots；新建作品 → /create（旧深链保留）
  await page.goto("/library");
  await page.getByRole("link", { name: "看热点" }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await page.goto("/library");
  await page.getByRole("link", { name: "新建作品" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(crumb.getByText("新建作品", { exact: true })).toBeVisible();

  // 完成条出口：用素材发现选题 → /topics
  await page.goto("/library");
  await page.getByRole("link", { name: "用素材发现选题" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(page.getByRole("heading", { name: "选题发现" })).toBeVisible();
});

test("键盘可达：首 Tab 停在「跳到主内容」，激活后主内容获焦，键盘可达「导入素材」", async ({
  page,
}) => {
  await signup(page, "library-keyboard@example.test");
  await openLibrary(page);
  await page.keyboard.press("Tab");
  const skip = page.locator("a.cv2-skip");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cv2-main")).toBeFocused();

  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page
      .getByRole("button", { name: "导入素材" })
      .evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
});

test("移动 390×844 补充：更多筛选与 chip、文件上传、关闭详情、「更多」面板 Esc 收起", async ({
  page,
}) => {
  await signup(page, "library-mobile-gap@example.test");
  const note = await (
    await page.request.post("/api/creator/materials", {
      data: { title: "移动缺口合成笔记", body: "打标签用于移动端筛选。" },
    })
  ).json();
  const tagged = await page.request.put("/api/creator/library/meta", {
    data: { kind: "material", id: note.id, tags: ["移动端标签"], archived: false },
  });
  expect(tagged.ok()).toBeTruthy();
  await page.request.post("/api/creator/materials", {
    data: {
      title: "移动缺口合成线索",
      body: "公开摘录。",
      url: "https://example.test/mobile-gap",
    },
  });
  await page.request.post("/api/assets", {
    data: { name: "mobile-gap.png", alt: "移动缺口合成图", base64: PNG_1X1 },
  });
  await page.request.post("/api/writing/projects", {
    data: { title: "移动缺口合成作品" },
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  const grid = page.locator("button.cv2-asset-card");
  await expect(grid).toHaveCount(4);

  // 更多筛选折叠区在移动端可用：标签筛选 + 一键清除
  await page.getByText("更多筛选（系列、平台、日期与标签）").click();
  await page.getByLabel("筛选标签").fill("移动端标签");
  await expect(grid).toHaveCount(1);
  await expect(card(page, "移动缺口合成笔记")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选条件" }).click();
  await expect(grid).toHaveCount(4);

  // 「链接」chip 在移动端同样驱动真实 kind 筛选
  const chips = page.getByRole("group", { name: "按类型筛选" });
  await chips.getByRole("button", { name: "链接", exact: true }).click();
  await expect(grid).toHaveCount(2);
  await chips.getByRole("button", { name: "全部", exact: true }).click();
  await expect(grid).toHaveCount(4);

  // 文件上传路径在移动端同样真实落库
  await page.getByRole("button", { name: "导入素材" }).click();
  const dialog = page.getByRole("dialog", { name: "导入素材" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "synthetic-mobile-note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 移动端合成素材"),
  });
  await expect(page.getByRole("status").last()).toContainText("文件已保存到资产库");
  await expect(card(page, "synthetic-mobile-note.md")).toBeVisible();

  // 详情面板「关闭详情」按钮收起面板
  await card(page, "移动缺口合成笔记").click();
  const detail = page.getByRole("region", { name: "素材详情" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await expect(detail).not.toBeVisible();

  // 「更多」面板 Esc 关闭：面板真实收起，触发按钮 aria-expanded 复位
  const moreNav = page.getByRole("navigation", { name: "移动端导航" });
  await moreNav.getByRole("button", { name: "更多" }).click();
  const morePanel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(morePanel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(morePanel).not.toBeVisible();
  await expect(
    moreNav.getByRole("button", { name: "更多" })
  ).toHaveAttribute("aria-expanded", "false");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// 已知缺陷登记（不许删掉该交互的记录）：移动「更多」面板 Esc 关闭后
// 焦点未返回触发按钮 —— CreatorShell.jsx:128-136 的 Esc 分支只 setMoreOpen(false)，
// 不像面板头关闭按钮（:244-248）那样调用 moreButtonRef.current?.focus()。
// 登记：docs/implementation/CREATOR-V2-DESIGN-DEVIATIONS.md 全局壳层 #5（:52-55）。
// 修复后应把下方注释中的断言启用为正式用例（当前执行会失败，故为 fixme）。
test.fixme(
  "移动「更多」面板 Esc 关闭后焦点应返回「更多」触发按钮 @bug:deviations#全局壳层-5",
  async ({ page }) => {
    // await signup(page, "library-mobile-more-esc@example.test");
    // await page.setViewportSize({ width: 390, height: 844 });
    // await openLibrary(page);
    // const moreNav = page.getByRole("navigation", { name: "移动端导航" });
    // await moreNav.getByRole("button", { name: "更多" }).click();
    // await expect(page.getByRole("dialog", { name: "更多工作区" })).toBeVisible();
    // await page.keyboard.press("Escape");
    // await expect(page.getByRole("dialog", { name: "更多工作区" })).not.toBeVisible();
    // await expect(moreNav.getByRole("button", { name: "更多" })).toBeFocused();
  }
);

function assertLibraryIds(payload, expectedIds) {
  const ids = (payload.assets || []).map((a) => a.id).sort();
  expect(ids).toEqual([...expectedIds].sort());
}
