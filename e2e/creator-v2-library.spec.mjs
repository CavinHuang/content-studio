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

function assertLibraryIds(payload, expectedIds) {
  const ids = (payload.assets || []).map((a) => a.id).sort();
  expect(ids).toEqual([...expectedIds].sort());
}
