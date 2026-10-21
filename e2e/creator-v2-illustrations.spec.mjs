import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2.3 visual studio (/illustrations) e2e — the real 视觉工作台.
// Worker-scoped guarded production server (same pattern as
// e2e/creator-v2-compose.spec.mjs) with multiuser sessions. The only
// synthetic piece is a loopback OpenAI-compatible image endpoint, so the
// REAL provider code path (src/image-providers.mjs) generates 1×1 PNGs
// without any external service or cost. Coverage per the page scope:
//   1. 1440×900 three-column studio (shot list / showcase / inspector),
//      the real 封面/完整配图/指定段落 planning modes over POST plan;
//   2. the full honest loop: generate (real synthetic provider) → 待审阅
//      → 采用（批准）→ channel mapping registration → handoff proposal
//      → four-item manual QA record; platform preview only shows adopted
//      images and states unmapped channels honestly;
//   3. 选中≠批准: selecting a candidate returns the slot to 待审阅, the
//      master markdown keeps zero asset:// tokens until approval+insert;
//   4. budget-blocked batch leaves one image done and others honestly
//      failed/queued; single-slot retry does not block other slots;
//   5. 390×844: single column, workflow bottom nav above the global tabs,
//      no horizontal overflow.
// A second section (2026-10-20 interaction-coverage audit) adds the page's
// remaining interactions: paragraph-scoped plan POST, decision:reject,
// stale re-plan, project switcher reload, the compare modal chain, all
// modal Esc/backdrop paths, jobline/header/back links, empty state, the
// budget + provider + attempt-limit + quick-chip inspector controls,
// download + clipboard handoff, the V43 quality-review form, the V37
// visual series panel lifecycle, and desktop/mobile shell navigation.
// Interactions with registered defects (DEVIATIONS /illustrations ①②,
// global shell #5) are recorded as test.fixme with @bug tags.
// Distinct 1×1 PNGs (one per color): the asset service deduplicates by
// content SHA-256, so an identical image would collapse every candidate
// into a single asset and hide the variant grid.
const pngColors = [
  [0, 0, 0],
  [180, 40, 40],
  [40, 140, 80],
  [40, 80, 200],
  [200, 160, 40],
  [120, 60, 160],
];
const PNGS = await Promise.all(
  pngColors.map(async ([r, g, b]) =>
    (await (await import("sharp")).default({ create: { width: 1, height: 1, channels: 3, background: { r, g, b } } }).png().toBuffer()).toString("base64")
  )
);
let pngCursor = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function listen(server) {
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
}

const test = base.extend({
  illuEnv: [
    async ({}, use) => {
      // Synthetic loopback image provider (never a real external service).
      const images = createServer((req, res) => {
        req.on("data", () => {});
        req.on("end", () => {
          const b64 = PNGS[pngCursor++ % PNGS.length];
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ data: [{ b64_json: b64 }] }));
        });
      });
      const imagePort = await listen(images);
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((r) => probe.close(r));
      const root = mkdtempSync(join(tmpdir(), "studio-creator-illu-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "illustrations.sqlite"),
        CONTENT_STUDIO_DEPLOY_MODE: "",
        CONTENT_STUDIO_ALLOW_REMOTE: "0",
        CONTENT_STUDIO_WORKER_DISABLED: "1",
        ENABLE_SCENARIO: "0",
        CONTENT_AI_API_KEY: "",
        CONTENT_AI_BASE_URL: "",
        CONTENT_AI_MODEL: "",
        CONTENT_IMAGE_API_KEY: "",
        // Real provider path pointed at the loopback stub only.
        CONTENT_IMAGE_OPENAI_API_KEY: "loopback-synthetic-key",
        CONTENT_IMAGE_OPENAI_BASE_URL: `http://127.0.0.1:${imagePort}/v1/`,
        CONTENT_IMAGE_OPENAI_MODEL: "fixture-image-model",
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
        if (!ready) throw Error("Illustrations server did not start " + logs);
        await use({ origin, imagePort });
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
  baseURL: async ({ illuEnv }, use) => use(illuEnv.origin),
});

async function signup(page, email) {
  await page.goto("/");
  await expect(page).toHaveURL(/signin/);
  await page.getByRole("button", { name: "第一次来？创建作者账号" }).click();
  await page.getByLabel("作者名称", { exact: true }).fill("合成视觉作者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-strong-password");
  await page.getByRole("button", { name: "创建并登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今天，先把一篇好文章写完。" })
  ).toBeVisible();
}

// Real master draft with three long paragraphs → a full plan yields
// cover + up to two section slots (slotPlan).
async function createProject(page, title) {
  const r = await page.request.post("/api/writing/projects", {
    data: { title },
  });
  expect(r.ok()).toBeTruthy();
  // A fresh project carries a seeded paragraph; its current revision comes
  // from the create response (do NOT assume 1).
  const doc = await r.json();
  const projectId = doc.projectId;
  const markdown =
    "# " +
    title +
    "\n\n第一段写足够长的文字：桌面 Agent 的可靠性判断需要执行证据、权限边界与失败恢复，而不是一次惊艳的演示，这里补足长度用于规划。\n\n第二段继续写足够长的文字：人工确认的位置决定了协作边界，也决定了配图需要解释的结构概念，同样补足长度。\n\n第三段保持足够长度：把执行、核验与恢复拆成读者能看懂的三段流程，是本章配图的核心表达。";
  const saved = await page.request.put(
    `/api/writing/projects/${projectId}/master`,
    { data: { expectedRevision: doc.revision, markdown } }
  );
  if (!saved.ok())
    throw Error(
      "master save failed: " +
        JSON.stringify(await saved.json()) +
        " docRevision=" +
        doc.revision
    );
  return projectId;
}

async function openStudio(page, projectId) {
  await page.goto("/illustrations?project=" + projectId);
  await expect(
    page.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
}

test("桌面 1440×900：三栏 studio 与真实的三种规划模式（封面/完整/指定段落）", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page, "illu-desktop@example.test");
  const id = await createProject(page, "视觉工作台版式与规划验证");
  await openStudio(page, id);

  // jobline：真实项目标题（select 值）+ 主稿版本 tag
  await expect(page.getByLabel("配图文章")).toHaveValue(id);
  await expect(page.getByText(/主稿 v\d+ · 方案可用/)).toBeVisible();

  // 规划带：三种真实模式
  const plan = page.getByLabel("配图规划");
  // 模式按钮的可达名包含张数说明行（<small>），用子串匹配
  for (const name of ["只做封面", "完整配图", "指定段落"])
    await expect(plan.getByRole("button", { name })).toBeVisible();
  await expect(
    plan.getByText(/封面 1 处 \+ 系统从正文识别的最多 2 处章节配图/)
  ).toBeVisible();

  // 只做封面 → 真实 POST plan {scope:'cover'}：图位清单只有封面
  await plan.getByRole("button", { name: "只做封面" }).click();
  await plan.getByRole("button", { name: "创建配图计划", exact: true }).click();
  await expect(page.getByText(/封面计划已创建/)).toBeVisible();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(1);
  await expect(page.locator(".cv2-illu-shotitem").first()).toContainText("文章封面");
  await expect(page.locator(".cv2-illu-shotitem .cv2-pill").first()).toHaveText("待生成");
  // 大图区诚实空态
  await expect(page.getByText("这一处还没有图片")).toBeVisible();

  // 重新规划 → 完整配图 → 封面 + 两个章节图位（真实 slotPlan 结果）。
  // 替换已有计划前组件会先确认（原图保留在素材库）。
  await page.getByRole("button", { name: "重新规划", exact: true }).click();
  await plan.getByRole("button", { name: "完整配图" }).click();
  page.once("dialog", (d) => d.accept());
  await plan.getByRole("button", { name: "创建配图计划", exact: true }).click();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);
  await expect(page.locator(".cv2-illu-shotitem", { hasText: "正文配图 02" })).toBeVisible();
  await expect(page.locator(".cv2-illu-shotitem", { hasText: "正文配图 03" })).toBeVisible();
  const planned = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(planned.shots).toHaveLength(3);
  expect(planned.shots[0].role).toBe("cover");
  expect(planned.shots.every((s) => s.status === "planned")).toBe(true);

  // 指定段落模式出现真实段落选择（切换即改写计划需确认，不在测试中提交）
  await page.getByRole("button", { name: "重新规划", exact: true }).click();
  await plan.getByRole("button", { name: "指定段落" }).click();
  await expect(page.getByLabel("选择配图段落")).toBeVisible();
  expect(errors).toEqual([]);
});

test("生成 → 待审阅 → 采用（批准）→ 渠道映射 → 交接与人工核查；预览只显示已采用图片", async ({
  page,
}) => {
  await signup(page, "illu-loop@example.test");
  const id = await createProject(page, "配图采用与交付闭环验证");
  await openStudio(page, id);

  // 完整配图计划（真实 API 建计划）
  const plan = page.getByLabel("配图规划");
  await plan.getByRole("button", { name: "创建配图计划", exact: true }).click();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);

  // 未授权前生成按钮不可用（外部调用必须显式同意）
  await expect(page.getByRole("button", { name: "生成第一版", exact: true })).toBeDisabled();
  await page.getByLabel(/我允许将该图位的标题、段落摘要与提示词发送到所选的外部图片模型/).check();
  await page.getByRole("button", { name: "生成第一版", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");
  // 真实素材：大图来自 /api/assets 预览
  await expect(page.locator(".cv2-illu-bigart img")).toBeVisible();

  // 采用 = 明确批准；批准前后主稿 markdown 都没有 asset://（选中/批准≠插入）
  const markdownBefore = await (
    await page.request.get(`/api/writing/projects/${id}/master`)
  ).json();
  await page.getByRole("button", { name: "采用这张图", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("已批准");
  const afterApprove = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(afterApprove.shots[0].status).toBe("approved");
  const markdownAfter = await (
    await page.request.get(`/api/writing/projects/${id}/master`)
  ).json();
  expect(markdownAfter.markdown).toBe(markdownBefore.markdown);
  expect(markdownAfter.markdown.includes("asset://")).toBe(false);

  // 运维带：已批准图位出现渠道映射登记（尺寸/URL 校验分开展示在相邻卡片）
  const ops = page.getByLabel("渠道交付与质量检查");
  await expect(ops.getByText("只有「已批准」的图位才需要登记渠道地址")).toHaveCount(0);
  await ops.getByLabel("文章封面 图片 URL").fill("https://cdn.example.org/synthetic-cover.png");
  await ops
    .getByLabel("文章封面 上传记录")
    .fill("合成验收：已人工上传至平台素材库（测试记录 001）。");
  await ops.getByRole("button", { name: "保存该渠道映射", exact: true }).click();
  await expect(ops.getByText("已登记地址；尚未验证平台显示效果")).toBeVisible();
  const stored = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(stored.shots[0].asset.mappings[0]).toMatchObject({
    channel: "wechat",
    url: "https://cdn.example.org/synthetic-cover.png",
  });

  // 预览弹窗：公众号显示已采用图；知乎未映射 → 诚实提示，不渲染假装成功
  await page.getByRole("button", { name: "查看最终效果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "文章平台预览" });
  await expect(dialog.getByText("已采用 1 / 3 张")).toBeVisible();
  await expect(dialog.locator("img")).toHaveCount(1);
  await dialog.getByRole("button", { name: "知乎", exact: true }).click();
  await expect(dialog.getByText(/知乎尚未登记地址 · 导出稿不会包含这张图/)).toBeVisible();
  await expect(dialog.locator("img")).toHaveCount(1); // 本地预览仍显示，但渠道状态如实标注
  await dialog.getByRole("button", { name: "继续配图", exact: true }).click();

  // 交接：带图 Markdown 提案 + 四项人工核查记录（不可变保存）
  await ops.getByRole("button", { name: "检查并生成带图 Markdown", exact: true }).click();
  await expect(ops.getByText(/已定位插图 1/)).toBeVisible();
  // alt 来自真实 shot.alt（标题：概念封面插画）
  await expect(ops.getByLabel("带图 Markdown 预览")).toContainText(
    "](https://cdn.example.org/synthetic-cover.png)"
  );
  await ops.getByRole("button", { name: "检查当前渠道的交接条件", exact: true }).click();
  // 另两个图位未批准 → 诚实提示不具备全部交接条件，而不是谎报就绪
  await expect(ops.getByText(/尚不具备全部交接条件/)).toBeVisible();
  await expect(ops.getByText(/待批准 2/)).toBeVisible();
  await ops.getByText("手工记录平台实际检查结果").waitFor();
  await ops.getByRole("checkbox", { name: /目标渠道已实际上传相关图片/ }).check();
  await ops
    .getByLabel("手工验收备注")
    .fill("合成验收：已于本机检查图片显示与移动端排版（测试记录）。");
  await ops.getByRole("button", { name: "保存人工验收记录（含失败）", exact: true }).click();
  // 成功反馈是页面级 toast，不在运维卡内部
  await expect(page.getByText(/人工验收结果已作为不可变记录保存/)).toBeVisible();
  const qa = await (
    await page.request.get(`/api/illustrations/projects/${id}/handoff-qa/wechat/history`)
  ).json();
  expect(qa.history.length).toBeGreaterThanOrEqual(1);
  // 预算被真实预留（生成计 1 次），但绝不渲染成费用数字
  const budget = await (
    await page.request.get(`/api/illustrations/projects/${id}/budget`)
  ).json();
  expect(budget.used).toBe(1);
});

test("选中 ≠ 批准：选择候选只切换预览并回到待审阅，主稿不被改写", async ({
  page,
}) => {
  await signup(page, "illu-select@example.test");
  const id = await createProject(page, "候选选择与批准分离验证");
  await openStudio(page, id);
  const plan = page.getByLabel("配图规划");
  await plan.getByRole("button", { name: "创建配图计划", exact: true }).click();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);
  await page
    .getByLabel(/我允许将该图位的标题、段落摘要与提示词发送到所选的外部图片模型/)
    .check();

  // 生成封面并通过自然语言修改得到第二个候选（真实 editImage 链路）
  await page.getByRole("button", { name: "生成第一版", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");
  await page
    .getByLabel("图片修改指令")
    .fill("换成更温暖的杂志风，弱化抽象圆环，保留主视觉层级。");
  await page.getByRole("button", { name: "基于当前图生成修改版", exact: true }).click();
  await expect(page.getByText("修改版已加入候选")).toBeVisible();
  await expect(page.locator(".cv2-illu-variant")).toHaveCount(2);

  // 选择候选：只切换当前预览，状态仍是「待审阅」（选中 ≠ 批准）
  await page.locator(".cv2-illu-variant").nth(1).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");
  await page.getByRole("button", { name: "采用这张图", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("已批准");

  // 已批准图位再生成一个候选并切换：确认后退回「待审阅」，需重新批准
  await page
    .getByLabel("图片修改指令")
    .fill("再把文字区域留白加大，让标题更克制地居中。");
  await page.getByRole("button", { name: "基于当前图生成修改版", exact: true }).click();
  await expect(page.getByText("修改版已加入候选")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.locator(".cv2-illu-variant", { hasText: "候选版本" }).first().click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");

  // 全程主稿 markdown 无 asset:// —— 选择与批准都不改写文章
  const master = await (
    await page.request.get(`/api/writing/projects/${id}/master`)
  ).json();
  expect(master.markdown.includes("asset://")).toBe(false);
});

test("预算阻塞不阻塞其他图：队列批次诚实报告，单图重试各自完成", async ({
  page,
}) => {
  await signup(page, "illu-budget@example.test");
  const id = await createProject(page, "预算与失败隔离验证");
  await openStudio(page, id);
  const plan = page.getByLabel("配图规划");
  await plan.getByRole("button", { name: "创建配图计划", exact: true }).click();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);

  // 把当日预算压到 1：批量只能完成一张，其余必须诚实失败/排队
  const put = await page.request.put(`/api/illustrations/projects/${id}/budget`, {
    data: { expectedRevision: 0, dailyLimit: 1 },
  });
  expect(put.ok()).toBeTruthy();
  await page
    .getByLabel(/我允许将该图位的标题、段落摘要与提示词发送到所选的外部图片模型/)
    .check();

  await page.getByRole("button", { name: "生成全部待处理（3）", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "确认图片生成" });
  await expect(confirm.getByText(/将为 3 个配图位置/)).toBeVisible();
  await confirm.getByRole("button", { name: "确认并加入队列", exact: true }).click();
  await expect(page.getByText(/批次已进入本地队列/)).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (
          await page.request.get(`/api/illustrations/queue?projectId=${id}`)
        ).json()).active,
      { timeout: 20000 }
    )
    .toBe(false);
  // 封面完成；第二张预算阻塞为失败；第三张未执行
  let state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots.map((s) => s.status)).toEqual([
    "generated",
    "failed",
    "planned",
  ]);
  const budget1 = await (
    await page.request.get(`/api/illustrations/projects/${id}/budget`)
  ).json();
  expect(budget1.used).toBe(1);

  // 提高预算后逐张重试：失败图与未执行图互不阻塞
  expect(
    (
      await page.request.put(`/api/illustrations/projects/${id}/budget`, {
        data: { expectedRevision: 1, dailyLimit: 20 },
      })
    ).ok()
  ).toBeTruthy();
  await page.locator(".cv2-illu-shotitem", { hasText: "正文配图 02" }).click();
  await expect(
    page.getByRole("alert").getByText(/Daily external-model request cap/).first()
  ).toBeVisible();
  await page.getByRole("button", { name: "单图重试", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");
  await page.locator(".cv2-illu-shotitem", { hasText: "正文配图 03" }).click();
  await page.getByRole("button", { name: "生成这张图", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");
  const budget2 = await (
    await page.request.get(`/api/illustrations/projects/${id}/budget`)
  ).json();
  expect(budget2.used).toBe(3);
  state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots.every((s) => s.status === "generated")).toBe(true);
});

test("移动 390×844：单栏分段 + 工作流底栏在全局导航之上，无横向溢出", async ({
  page,
}) => {
  await signup(page, "illu-mobile@example.test");
  const id = await createProject(page, "移动端视觉工作台检查");
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page, id);

  const overflow = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0
    );
    const offenders = [];
    if (scrollWidth > viewport) {
      for (const el of document.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        if (rect.width > viewport + 1 || rect.right > viewport + 8) {
          offenders.push(
            `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} w=${Math.round(rect.width)} right=${Math.round(rect.right)}`
          );
          if (offenders.length >= 6) break;
        }
      }
    }
    return { scrollWidth, viewport, offenders };
  });
  expect(
    overflow.scrollWidth - overflow.viewport,
    `横向溢出 ${overflow.scrollWidth}>${overflow.viewport}：\n${overflow.offenders.join("\n")}`
  ).toBeLessThanOrEqual(0);

  // 工作流底栏与全局底栏并存（不合并、不覆盖）
  await expect(
    page.getByRole("navigation", { name: "移动端视觉工作流" })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "移动端导航" })).toBeVisible();
  const workflow = page.getByRole("navigation", { name: "移动端视觉工作流" });
  const workflowBox = await workflow.boundingBox();
  const globalTabs = await page
    .getByRole("navigation", { name: "移动端导航" })
    .boundingBox();
  expect(workflowBox.y + workflowBox.height).toBeLessThanOrEqual(globalTabs.y + 2);

  // 图位清单横向滚动条形态（创建计划后）
  const plan = page.getByLabel("配图规划");
  await plan.getByRole("button", { name: "创建配图计划", exact: true }).click();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);
  // 预览弹窗全宽打开并可关闭
  await workflow.getByRole("button", { name: "预览", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "文章平台预览" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/已采用 0 \/ 3 张/)).toBeVisible();
  await dialog.getByRole("button", { name: "继续配图", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(0);
});

// ---------------------------------------------------------------------------
// 交互覆盖补齐（2026-10-20 审计缺口；上方既有用例保持不动）。
// 缺陷登记 docs/implementation/CREATOR-V2-DESIGN-DEVIATIONS.md：
//   /illustrations 验收缺陷①(onRetry 不清 loadError)→@bug:deviations-illu#1
//   /illustrations 验收缺陷②(savePromptFields 缺 return，保存无成功反馈)
//     →@bug:deviations-illu#2
//   全局壳层缺陷5(移动「更多」面板 Esc 后焦点未返回触发按钮)
//     →@bug:deviations-shell#5
// 已登记缺陷的交互写成 test.fixme（不写会失败的断言执行），其余全部真实执行。
// ---------------------------------------------------------------------------

// 默认「完整配图」模式建计划并等三栏出现 3 个图位。
async function createFullPlan(page) {
  const planBand = page.getByLabel("配图规划");
  await planBand
    .getByRole("button", { name: "创建配图计划", exact: true })
    .click();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);
}

// 勾选外部模型授权并生成封面第一版（真实环回合成供应商）。
async function generateCover(page) {
  await page
    .getByLabel(/我允许将该图位的标题、段落摘要与提示词发送到所选的外部图片模型/)
    .check();
  await page.getByRole("button", { name: "生成第一版", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");
}

async function addEditCandidate(page, instruction) {
  await page.getByLabel("图片修改指令").fill(instruction);
  await page
    .getByRole("button", { name: "基于当前图生成修改版", exact: true })
    .click();
  await expect(page.getByText("修改版已加入候选")).toBeVisible();
}

test("指定段落计划完整提交：选择段落 → 创建（POST plan {paragraphId}）", async ({
  page,
}) => {
  await signup(page, "illu-paragraph@example.test");
  const id = await createProject(page, "指定段落配图计划验证");
  await openStudio(page, id);
  const planBand = page.getByLabel("配图规划");
  await planBand.getByRole("button", { name: "指定段落" }).click();
  await expect(page.getByLabel("选择配图段落")).toBeVisible();
  // 段落选项来自真实主稿（>18 字的段）；首项为「选择正文段落…」占位
  await page.getByLabel("选择配图段落").selectOption({ index: 1 });
  await planBand.getByRole("button", { name: "创建配图计划", exact: true }).click();
  // 无既有计划 → 不弹替换确认；toast 携带真实模式名
  await expect(
    page.getByText("指定段落计划已创建；生成前不会调用图片服务。")
  ).toBeVisible();
  await expect(page.getByLabel("配图规划")).toHaveCount(0);
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(1);
  await expect(page.locator(".cv2-illu-showcase h2")).toContainText("正文配图 01");

  // 落库的是所选段落的真实 paragraphId（非封面位）；主稿解析会把 H1 也算作段落
  const doc = await (
    await page.request.get(`/api/editor/projects/${id}`)
  ).json();
  const docParagraphs = doc.channels.master.document.paragraphs;
  const eligible = docParagraphs.filter(
    (p) => String(p.text || "").trim().length > 18
  );
  const state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots).toHaveLength(1);
  expect(state.shots[0].paragraphId).toBe(eligible[0].id);
  expect(state.shots[0].role).not.toBe("cover");

  // 刷新后计划仍在（真实持久化）；锚点行 = 该段在主稿中的真实位置
  await page.reload();
  const anchorIndex =
    docParagraphs.findIndex((p) => p.id === eligible[0].id) + 1;
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(1);
  await expect(page.locator(".cv2-illu-shotitem").first()).toContainText(
    `第 ${anchorIndex} 段之后 ·`
  );
});

test("「不采用」（decision:reject）：退回已拒绝，原图保留且刷新后仍在", async ({
  page,
}) => {
  await signup(page, "illu-reject@example.test");
  const id = await createProject(page, "不采用决定路径验证");
  await openStudio(page, id);
  await createFullPlan(page);
  await generateCover(page);

  await page.getByRole("button", { name: "不采用", exact: true }).click();
  await expect(
    page.getByText("「文章封面」已标记为不采用，原图保留。")
  ).toBeVisible();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("已拒绝");
  // 「不采用」入口只在 generated/approved 出现
  await expect(
    page.getByRole("button", { name: "不采用", exact: true })
  ).toHaveCount(0);

  const state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots[0].status).toBe("rejected");
  expect(state.shots[0].assetId).toBeTruthy(); // 原图保留在素材库

  await page.reload();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("已拒绝");
});

test("stale 计划过期：主稿更新后警示 +「根据最新主稿重新规划」恢复可用", async ({
  page,
}) => {
  await signup(page, "illu-stale@example.test");
  const id = await createProject(page, "配图计划过期与重规划验证");
  await openStudio(page, id);
  await createFullPlan(page);
  expect(
    (await (await page.request.get(`/api/illustrations/projects/${id}`)).json())
      .stale
  ).toBe(false);

  // 主稿再存一版（真实 PUT master）→ 计划落后于主稿
  const master = await (
    await page.request.get(`/api/writing/projects/${id}/master`)
  ).json();
  const saved = await page.request.put(`/api/writing/projects/${id}/master`, {
    data: {
      expectedRevision: master.revision,
      markdown:
        master.markdown +
        "\n\n第四段补充：重规划后旧图片保留在素材库，但需要作者重新审阅每一张配图与新的正文是否匹配。",
    },
  });
  expect(saved.ok()).toBeTruthy();
  const staleState = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(staleState.stale).toBe(true);

  await page.reload();
  const rev = staleState.sourceRevision;
  await expect(page.getByText(`主稿 v${rev} · 计划已过期`)).toBeVisible();
  const planBand = page.getByLabel("配图规划");
  await expect(planBand.getByText("计划过期 · 主稿已有新版本")).toBeVisible();
  await expect(planBand.getByText(/文章正文已有变化/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "根据最新主稿重新规划", exact: true })
  ).toBeVisible();

  // 替换既有计划前有真实 confirm
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "根据最新主稿重新规划", exact: true })
    .click();
  await expect(
    page.getByText("完整配图计划已创建；生成前不会调用图片服务。")
  ).toBeVisible();
  await expect(page.getByText(`主稿 v${rev} · 方案可用`)).toBeVisible();
  await expect(page.getByLabel("配图规划")).toHaveCount(0);
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);
  expect(
    (await (await page.request.get(`/api/illustrations/projects/${id}`)).json())
      .stale
  ).toBe(false);
});

test("「配图文章」select 切换项目：三栏状态按所选作品真实重载", async ({
  page,
}) => {
  await signup(page, "illu-switch@example.test");
  const firstId = await createProject(page, "切换验证·已建计划的作品");
  const secondId = await createProject(page, "切换验证·尚无计划的作品");
  await openStudio(page, firstId);
  await createFullPlan(page);

  const select = page.getByLabel("配图文章");
  await select.selectOption(secondId);
  await expect(select).toHaveValue(secondId);
  // 第二篇无计划：诚实空态 + 规划带重新出现
  await expect(
    page.getByText("还没有配图计划；在上方选择范围创建计划。")
  ).toBeVisible();
  await expect(
    page.getByText("创建配图计划后，这里会展示每个图位的主视觉。")
  ).toBeVisible();
  await expect(page.getByLabel("配图规划")).toBeVisible();
  await expect(page.getByText(/主稿 v\d+ · 方案可用/)).toBeVisible();

  // 切回第一篇：计划与图位不丢
  await select.selectOption(firstId);
  await expect(select).toHaveValue(firstId);
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(3);
  await expect(page.locator(".cv2-illu-showcase h2")).toContainText("文章封面");
});

test("对比版本弹窗全链路：候选下拉切换、「使用右侧版本预览」、Esc/遮罩/按钮关闭（桌面）", async ({
  page,
}) => {
  await signup(page, "illu-compare@example.test");
  const id = await createProject(page, "对比版本弹窗验证");
  await openStudio(page, id);
  await createFullPlan(page);
  await generateCover(page);
  // 两次自然语言改版 → 3 张候选卡（当前 + 2 候选），对比下拉有真实多选项
  await addEditCandidate(page, "换成更温暖的杂志风，弱化抽象圆环，保留主视觉层级。");
  await addEditCandidate(page, "再把文字区域留白加大，让标题更克制地居中。");
  await expect(page.locator(".cv2-illu-variant")).toHaveCount(3);

  const dialog = page.getByRole("dialog", { name: "对比图片版本" });
  const open = async () => {
    await page.getByRole("button", { name: "对比版本", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /图片版本对比 · 文章封面/ })
    ).toBeVisible();
  };

  // ① Esc 关闭
  await open();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // ② 遮罩点击关闭
  await open();
  await page.locator(".cv2-illu-backdrop").click({ position: { x: 8, y: 8 } });
  await expect(dialog).toHaveCount(0);

  // ③ 「关闭」按钮关闭
  await open();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // ④ 候选下拉切换右侧预览 → 使用右侧版本预览（选中≠批准）
  await open();
  const select = dialog.getByLabel("选择对比版本");
  const before = await select.inputValue();
  expect(before).toMatch(/^candidate:/);
  await select.selectOption({ index: 1 });
  await expect(select).not.toHaveValue(before);
  await expect(dialog.locator("img[alt='对比候选']")).toBeVisible();
  await dialog
    .getByRole("button", { name: "使用右侧版本预览", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/已切换预览候选/)).toBeVisible();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待审阅");
  await expect(page.locator(".cv2-illu-variant").first()).toContainText("当前预览");
  const state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots[0].status).toBe("generated");
});

test("预览与生成确认弹窗的 Esc/遮罩/「返回调整」关闭路径（桌面键盘可达）", async ({
  page,
}) => {
  await signup(page, "illu-modals@example.test");
  const id = await createProject(page, "弹窗键盘关闭路径验证");
  await openStudio(page, id);
  await createFullPlan(page);

  const preview = page.getByRole("dialog", { name: "文章平台预览" });
  // Esc 关闭（头部「查看最终效果」打开）
  await page.getByRole("button", { name: "查看最终效果", exact: true }).click();
  await expect(preview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  // 遮罩关闭（中部「正文预览」再次打开）
  await page.getByRole("button", { name: "正文预览", exact: true }).click();
  await expect(preview).toBeVisible();
  await page.locator(".cv2-illu-backdrop").click({ position: { x: 8, y: 8 } });
  await expect(preview).toHaveCount(0);

  // 生成确认弹窗：Esc / 返回调整 / 遮罩三种关闭
  const confirm = page.getByRole("dialog", { name: "确认图片生成" });
  const openConfirm = async () => {
    await page.getByRole("button", { name: /生成全部待处理/ }).click();
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/将为 3 个配图位置/)).toBeVisible();
  };
  await openConfirm();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await openConfirm();
  await confirm.getByRole("button", { name: "返回调整", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await openConfirm();
  await page.locator(".cv2-illu-backdrop").click({ position: { x: 8, y: 8 } });
  await expect(confirm).toHaveCount(0);
  // 只开不确认：不产生任何生成调用与预算占用
  const budget = await (
    await page.request.get(`/api/illustrations/projects/${id}/budget`)
  ).json();
  expect(budget.used).toBe(0);
});

test("jobline 入口：「正文编辑」回编辑器、「跨文章队列」进队列页", async ({
  page,
}) => {
  await signup(page, "illu-jobline@example.test");
  const id = await createProject(page, "工作台入口跳转验证");
  await openStudio(page, id);

  await page.getByRole("link", { name: "正文编辑", exact: true }).click();
  await expect(page).toHaveURL("/compose?project=" + id);
  await expect(
    page.getByRole("heading", { name: "工作台入口跳转验证" })
  ).toBeVisible();

  await page.goto("/illustrations?project=" + id);
  await expect(
    page.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
  await page.getByRole("link", { name: "跨文章队列", exact: true }).click();
  await expect(page).toHaveURL("/illustrations/queue");
  await expect(
    page.getByRole("heading", { name: "跨文章配图任务" })
  ).toBeVisible();
});

test("「返回文章」与右栏「返回正文定位 →」都回到 /compose 同一作品", async ({
  page,
}) => {
  await signup(page, "illu-back@example.test");
  const id = await createProject(page, "返回正文入口验证");
  await openStudio(page, id);
  await createFullPlan(page);

  await page.getByRole("link", { name: "返回文章", exact: true }).click();
  await expect(page).toHaveURL("/compose?project=" + id);

  await page.goto("/illustrations?project=" + id);
  await expect(
    page.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
  await page
    .getByLabel("图片修改控件")
    .getByRole("link", { name: /返回正文定位/ })
    .click();
  await expect(page).toHaveURL("/compose?project=" + id);
  await expect(
    page.getByRole("heading", { name: "返回正文入口验证" })
  ).toBeVisible();
});

test("零作品空态：EmptyState「还没有可配图的作品」+「去创作空间」", async ({
  page,
}) => {
  await signup(page, "illu-empty@example.test");
  await page.goto("/illustrations");
  await expect(page.getByText("还没有可配图的作品")).toBeVisible();
  await expect(
    page.getByText("先在创作空间写好正文，再回到这里规划封面与章节配图。")
  ).toBeVisible();
  await page.getByRole("link", { name: "去创作空间", exact: true }).click();
  await expect(page).toHaveURL("/compose");
  // 面包屑落在创作空间工作区（空账号无项目，编辑器呈现选择/新建态）
  await expect(
    page.getByRole("navigation", { name: "面包屑" }).getByText("创作空间")
  ).toBeVisible();
});

test("「每日请求上限」页面表单保存（PUT budget）：toast、API 与刷新持久", async ({
  page,
}) => {
  await signup(page, "illu-budgetui@example.test");
  const id = await createProject(page, "每日上限表单验证");
  await openStudio(page, id);
  await createFullPlan(page);

  const input = page.getByLabel("每日外部模型请求上限");
  await expect(input).toHaveValue("12"); // 服务端默认上限 12
  await expect(page.getByText(/今日已占用 0 \/ 12 次/)).toBeVisible();
  await expect(page.getByRole("button", { name: "保存上限", exact: true })).toBeDisabled();
  await input.fill("20");
  await page.getByRole("button", { name: "保存上限", exact: true }).click();
  await expect(page.getByText("每日请求上限已保存。")).toBeVisible();
  await expect(page.getByText(/今日已占用 0 \/ 20 次/)).toBeVisible();
  const budget = await (
    await page.request.get(`/api/illustrations/projects/${id}/budget`)
  ).json();
  expect(budget.dailyLimit).toBe(20);

  await page.reload();
  await expect(page.getByLabel("每日外部模型请求上限")).toHaveValue("20");
  await expect(page.getByText(/今日已占用 0 \/ 20 次/)).toBeVisible();
});

test("「图片供应商」select 与「单图最多调用次数」有界输入（右栏高级设置）", async ({
  page,
}) => {
  await signup(page, "illu-provider@example.test");
  const id = await createProject(page, "供应商选择与调用上限验证");
  await openStudio(page, id);
  await createFullPlan(page);

  const providerSelect = page.getByLabel("图片供应商");
  await expect(providerSelect).toHaveValue("openai");
  for (const label of [
    "OpenAI GPT Image（可用）",
    "Google Nano Banana（未配置）",
    "Qwen Image（未配置）",
  ])
    await expect(providerSelect.locator("option", { hasText: label })).toHaveCount(1);

  // 已授权后，未配置供应商才是禁用的唯一原因（title 如实说明）
  await page
    .getByLabel(/我允许将该图位的标题、段落摘要与提示词发送到所选的外部图片模型/)
    .check();
  await providerSelect.selectOption("gemini");
  const generate = page.getByRole("button", { name: "生成这张图", exact: true });
  await expect(generate).toBeDisabled();
  await expect(generate).toHaveAttribute("title", "图片服务未配置");
  await providerSelect.selectOption("openai");
  await expect(generate).toBeEnabled();

  // 单图调用次数钳制在 1–3
  const attempts = page.getByLabel("单图最多调用次数");
  await expect(attempts).toHaveValue("1");
  await attempts.fill("9");
  await expect(attempts).toHaveValue("3");
  await attempts.fill("0");
  await expect(attempts).toHaveValue("1");
  await attempts.fill("2");

  // 生成确认弹窗如实显示所选供应商与每图调用次数
  await page.getByRole("button", { name: /生成全部待处理/ }).click();
  const confirm = page.getByRole("dialog", { name: "确认图片生成" });
  await expect(
    confirm.getByText(/供应商：OpenAI GPT Image（已配置）/)
  ).toBeVisible();
  await expect(confirm.getByText(/每图最多 2 次调用/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
});

test("快捷指令 chips 依次填充修改指令 textarea", async ({ page }) => {
  await signup(page, "illu-chips@example.test");
  const id = await createProject(page, "快捷指令填充验证");
  await openStudio(page, id);
  await createFullPlan(page);
  const instruction = page.getByLabel("图片修改指令");
  await page.getByRole("button", { name: "去除文字", exact: true }).click();
  await expect(instruction).toHaveValue("去掉图中所有文字，用纯图形表达结构。");
  await page.getByRole("button", { name: "换成暖白", exact: true }).click();
  await expect(instruction).toHaveValue("保持主体构图，把背景换成暖白色。");
  await page.getByRole("button", { name: "适配封面", exact: true }).click();
  await expect(instruction).toHaveValue(
    "保持主体构图，重新适配公众号 2.35:1 封面裁切。"
  );
});

test("「下载示意图」触发真实下载（png，文件名来自图位标题）", async ({
  page,
}) => {
  await signup(page, "illu-download@example.test");
  const id = await createProject(page, "示意图下载验证");
  await openStudio(page, id);
  await createFullPlan(page);
  // 无素材时入口禁用（诚实禁用而非隐藏）
  await expect(
    page.getByRole("button", { name: "下载示意图", exact: true })
  ).toBeDisabled();
  await generateCover(page);
  const link = page.locator("a.cv2-btn", { hasText: "下载示意图" });
  await expect(link).toHaveAttribute("download", "文章封面.png");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    link.click(),
  ]);
  // 本 e2e 的 headless chromium（chromium-headless-shell 156）不把 download
  // 属性回传为 suggestedFilename（对同源 /api/assets 响应实测恒为 "download"，
  // 与 Content-Disposition 无关；真实 Chrome 按属性命名）。文件名契约已由
  // 上面的 DOM download 属性断言覆盖；这里验证点击触发真实下载且内容是 PNG。
  const pngHead = readFileSync(await download.path()).subarray(0, 8);
  expect(pngHead.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
});

test("「复制带图 Markdown」写入剪贴板并提示（doocs/md 交接前拷贝）", async ({
  page,
  context,
}) => {
  await signup(page, "illu-copy@example.test");
  const id = await createProject(page, "带图Markdown复制验证");
  await openStudio(page, id);
  // 只做封面：1 图位 生成 → 采用 → 登记渠道地址 → 交接提案 ready
  const planBand = page.getByLabel("配图规划");
  await planBand.getByRole("button", { name: "只做封面" }).click();
  await planBand.getByRole("button", { name: "创建配图计划", exact: true }).click();
  await expect(page.locator(".cv2-illu-shotitem")).toHaveCount(1);
  await generateCover(page);
  await page.getByRole("button", { name: "采用这张图", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("已批准");
  const ops = page.getByLabel("渠道交付与质量检查");
  await ops
    .getByLabel("文章封面 图片 URL")
    .fill("https://cdn.example.org/synthetic-cover-copy.png");
  await ops
    .getByLabel("文章封面 上传记录")
    .fill("合成验收：已人工上传（复制链路测试 002）。");
  await ops.getByRole("button", { name: "保存该渠道映射", exact: true }).click();
  await expect(ops.getByText("已登记地址；尚未验证平台显示效果")).toBeVisible();
  await ops
    .getByRole("button", { name: "检查并生成带图 Markdown", exact: true })
    .click();
  await expect(
    ops.getByText("已生成只读 Markdown 提案，可复制交给 doocs/md。")
  ).toBeVisible();
  const previewBox = ops.getByLabel("带图 Markdown 预览");
  const markdown = await previewBox.inputValue();
  expect(markdown).toContain("https://cdn.example.org/synthetic-cover-copy.png");

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ops.getByRole("button", { name: "复制带图 Markdown", exact: true }).click();
  await expect(page.getByText(/含图 Markdown 已复制/)).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(markdown);
});

test("质量评分提交：选素材、评分、风险标签、结论，保存不可变人工评价", async ({
  page,
}) => {
  await signup(page, "illu-quality@example.test");
  const id = await createProject(page, "人工质量评分验证");
  await openStudio(page, id);
  await createFullPlan(page);
  await generateCover(page);

  const panel = page.locator("[data-testid='v43-quality-workspace']");
  await expect(panel.getByText(/还没有可评分的图片/)).toHaveCount(0);
  await expect(panel.getByLabel("质量评价图片位")).toBeVisible();
  // 素材下拉来自真实生成素材（当前图片）
  await expect(
    panel.getByLabel("质量评价素材").locator("option", { hasText: "当前图片" })
  ).toHaveCount(1);
  await panel.getByLabel("主题与文章要求一致", { exact: true }).selectOption("5");
  await panel
    .getByRole("checkbox", { name: "疑似虚构界面或截图" })
    .check();
  await panel
    .getByRole("checkbox", { name: "本人已实际检查素材使用权（非自动认证）" })
    .check();
  await panel
    .getByRole("checkbox", { name: "本人已实际检查图文事实一致性（非自动认证）" })
    .check();
  await panel.getByLabel("质量评价结论").selectOption("revise");
  await panel
    .getByLabel("质量评价备注")
    .fill("合成验收：构图匹配正文但含风险标注，建议修改后再审（测试记录）。");
  await panel
    .getByRole("button", { name: "保存不可变的人工质量评价" })
    .click();
  await expect(
    panel.getByText("作者评分已作为不可变记录保存；图片批准状态未被更改。")
  ).toBeVisible();
  await expect(panel.getByText("已有当前版本作者评价")).toBeVisible();

  const shotId = (
    await (await page.request.get(`/api/illustrations/projects/${id}`)).json()
  ).shots[0].id;
  const view = await (
    await page.request.get(
      `/api/illustrations/projects/${id}/shots/${shotId}/quality-reviews`
    )
  ).json();
  expect(view.items[0].latest.ratings.briefFit).toBe(5);
  expect(view.items[0].latest.riskFlags).toEqual(["fabricated_ui"]);
  expect(view.items[0].latest.recommendation).toBe("revise");

  // 刷新后评价仍在（不可变历史）
  await page.reload();
  await expect(
    page
      .locator("[data-testid='v43-quality-workspace']")
      .getByText("已有当前版本作者评价")
  ).toBeVisible();
});

test("系列面板：创建并加入、版本历史、维护新版本、应用风格、离开系列", async ({
  page,
}) => {
  await signup(page, "illu-series@example.test");
  const id = await createProject(page, "系列视觉资产生命周期验证");
  await openStudio(page, id);
  const panel = page.locator("[data-testid='visual-series-panel']");
  await expect(panel.getByText("系列视觉资产 · V37")).toBeVisible();

  // 名称 <2 字时按钮禁用（真实校验）
  await expect(
    panel.getByRole("button", { name: "创建并加入系列", exact: true })
  ).toBeDisabled();
  await panel.getByLabel("新系列名称").fill("合成视觉系列阿尔法");
  await panel
    .getByRole("button", { name: "创建并加入系列", exact: true })
    .click();
  // 面板数据在重建页面时刷新：先以 API 确认落库，再刷新看成员视图
  const listed = await (
    await page.request.get(`/api/illustrations/projects/${id}/series`)
  ).json();
  expect(listed.series.name).toBe("合成视觉系列阿尔法");
  expect(listed.series.revision).toBe(1);
  await page.reload();
  await expect(
    panel.getByText(/合成视觉系列阿尔法 · v1 · 1 篇成员文章 · 0 张共享参考图/)
  ).toBeVisible();

  // 不可变版本历史（默认视觉画像「技术编辑插画」）
  await panel.getByRole("button", { name: "查看系列风格版本", exact: true }).click();
  await expect(panel.getByText(/v1 · 技术编辑插画 · /)).toBeVisible();

  // 维护（仅创建者）：保存为新版本 v2
  await panel.getByText("维护系列视觉风格（仅创建文章可修改）").click();
  const newMood = "克制、安静、可信的合成系列气质";
  await panel.getByLabel("整体气质").fill(newMood);
  await panel
    .getByRole("button", { name: "保存为新系列版本", exact: true })
    .click();
  await panel.getByRole("button", { name: "查看系列风格版本", exact: true }).click();
  await expect(panel.getByText(/v2 · 技术编辑插画 · /)).toBeVisible();

  // 应用风格 → 项目视觉画像升级为系列画像（revision 0 → 1）
  await page.reload();
  await panel
    .getByRole("button", { name: /将 v2 风格应用到本文（旧图需重新审批）/ })
    .click();
  // onApply 清空面板数据后回到创建态（组件现有行为），画像升级以 API 为准
  const profiled = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(profiled.visualProfile.revision).toBe(1);
  expect(profiled.visualProfile.mood).toBe(newMood);

  // 离开系列 → 成员关系解除，系列保留在可加入列表
  await page.reload();
  await panel
    .getByRole("button", { name: "离开系列（撤销本文的共享引用）", exact: true })
    .click();
  const afterLeave = await (
    await page.request.get(`/api/illustrations/projects/${id}/series`)
  ).json();
  expect(afterLeave.membership).toBe(null);
  expect(
    afterLeave.available.some((s) => s.name === "合成视觉系列阿尔法")
  ).toBe(true);
  await page.reload();
  await expect(panel.getByLabel("新系列名称")).toBeVisible();
});

test("系列面板：加入现有系列、共享已授权偏好、共享已批准参考图（撤销见 @bug fixme）", async ({
  page,
}) => {
  await signup(page, "illu-series2@example.test");
  const idA = await createProject(page, "系列共享源作品");
  await openStudio(page, idA);
  await createFullPlan(page);
  await generateCover(page);
  await page.getByRole("button", { name: "采用这张图", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("已批准");

  // 反馈挂在「候选」上（submitCandidateFeedback 需要 candidateId），而首版
  // 生成直接写入图位 asset、不产生候选行（candidates 仅来自修改版 editImage）。
  // 先真实生成一个修改版候选，再播种「记住」的作者反馈。
  await addEditCandidate(page, "在封面右上留出更多留白，去掉装饰性界面元素。");

  // 真实 API 播种一条「记住」的作者反馈（共享偏好来源）
  const before = await (
    await page.request.get(`/api/illustrations/projects/${idA}`)
  ).json();
  const shot = before.shots[0];
  const feedback = await page.request.post(
    `/api/illustrations/projects/${idA}/shots/${shot.id}/candidates/${shot.candidates[0].id}/feedback`,
    {
      data: {
        expectedUpdatedAt: shot.updatedAt,
        rating: "needs_revision",
        note: "合成偏好：封面保持大面积留白，避免装饰元素与虚构界面。",
        remember: true,
      },
    }
  );
  expect(feedback.ok()).toBeTruthy();

  const panel = page.locator("[data-testid='visual-series-panel']");
  await page.reload();
  await panel.getByLabel("新系列名称").fill("合成视觉系列贝塔");
  await panel
    .getByRole("button", { name: "创建并加入系列", exact: true })
    .click();
  await page.reload();
  await expect(
    panel.getByText(/合成视觉系列贝塔 · v1 · 1 篇成员文章 · 0 张共享参考图/)
  ).toBeVisible();

  // 将已授权的个人偏好明确共享给系列
  await panel.getByText("将已授权的个人偏好明确共享给系列").click();
  await panel.getByLabel("要共享的偏好").selectOption({ index: 1 });
  await panel
    .getByRole("button", { name: "将偏好共享给该系列", exact: true })
    .click();
  let listed = await (
    await page.request.get(`/api/illustrations/projects/${idA}/series`)
  ).json();
  expect(listed.series.preferences).toHaveLength(1);
  await page.reload();
  await panel.getByText(/^系列共享偏好 · 1 条$/).click();
  // 同一文案也出现在「要共享的偏好」下拉 option 中，限定段落避免 strict 冲突。
  await expect(
    panel
      .locator("p", { hasText: "合成偏好：封面保持大面积留白，避免装饰元素与虚构界面。" })
      .first()
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "停止复用该偏好", exact: true })
  ).toBeVisible();

  // 第二篇作品明确加入该系列（「加入系列是显式操作」）
  const idB = await createProject(page, "加入系列的作品");
  await page.goto("/illustrations?project=" + idB);
  await expect(
    page.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
  const panelB = page.locator("[data-testid='visual-series-panel']");
  await panelB.getByLabel("可加入系列").selectOption({ index: 1 });
  await panelB
    .getByRole("button", { name: "明确加入并允许系列内复用", exact: true })
    .click();
  await page.reload();
  await expect(
    panelB.getByText(/合成视觉系列贝塔 · v1 · 2 篇成员文章 · 0 张共享参考图/)
  ).toBeVisible();

  // 回到源作品：共享已批准封面为系列参考图
  await page.goto("/illustrations?project=" + idA);
  const panelA = page.locator("[data-testid='visual-series-panel']");
  await expect(panelA.getByText(/2 篇成员文章/)).toBeVisible();
  await panelA.getByText("共享批准图片至系列参考图集").click();
  await panelA.getByLabel("待共享图片").selectOption({ index: 1 });
  await panelA.getByLabel("共享用途说明").fill("合成参考：统一封面留白与基调");
  await panelA
    .getByRole("checkbox", { name: /我明确授权将这张已批准图片作为系列成员的参考图/ })
    .check();
  await panelA
    .getByRole("button", { name: "共享到系列图库", exact: true })
    .click();
  listed = await (
    await page.request.get(`/api/illustrations/projects/${idA}/series`)
  ).json();
  expect(listed.series.references).toHaveLength(1);
  await page.reload();
  await expect(panelA.getByText(/1 张共享参考图/)).toBeVisible();
  await expect(panelA.getByText("合成参考：统一封面留白与基调")).toBeVisible();
});

test("系列参考图「撤销共享」真实撤销：无 body 的 DELETE 按边界设计放行", async ({
  page,
}) => {
  // 回归守卫：本地 API 边界（V58）按帧头判定请求体——面板 api() 发出的
  // 无 content-type、无 body 的 DELETE 是合法的 bodyless 写动作，代理运行时
  // 不得因 request.body 流对象非空而把它拒成 403。
  await signup(page, "illu-revoke@example.test");
  const idA = await createProject(page, "系列撤销共享源作品");
  await openStudio(page, idA);
  await createFullPlan(page);
  await generateCover(page);
  await page.getByRole("button", { name: "采用这张图", exact: true }).click();
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("已批准");
  await addEditCandidate(page, "在封面右上留出更多留白，去掉装饰性界面元素。");
  const panelA = page.locator("[data-testid='visual-series-panel']");
  await panelA.getByLabel("新系列名称").fill("合成视觉系列伽马");
  await panelA.getByRole("button", { name: "创建并加入系列", exact: true }).click();
  await page.reload();
  await panelA.getByText("共享批准图片至系列参考图集").click();
  await panelA.getByLabel("待共享图片").selectOption({ index: 1 });
  await panelA.getByLabel("共享用途说明").fill("统一封面构图与大面积留白基调");
  await panelA.getByLabel(/我明确授权将这张已批准图片作为系列成员的参考图/).check();
  await panelA.getByRole("button", { name: "共享到系列图库", exact: true }).click();
  await expect(panelA.getByText("合成参考：统一封面留白与基调")).toBeVisible();
  await panelA.getByRole("button", { name: "撤销共享", exact: true }).click();
  await expect(panelA.getByText("合成参考：统一封面留白与基调")).toHaveCount(0);
  const listed = await (
    await page.request.get(`/api/illustrations/projects/${idA}/series`)
  ).json();
  expect(listed.series.references).toHaveLength(0);
});

test("本页出发的桌面侧栏 11 工作区跳转与高亮", async ({ page }) => {
  await signup(page, "illu-shell@example.test");
  const id = await createProject(page, "侧栏工作区跳转验证");
  await openStudio(page, id);
  const nav = page.getByRole("navigation", { name: "创作导航" });
  await expect(nav.getByRole("link")).toHaveCount(10);
  await expect(
    page.getByRole("navigation", { name: "偏好导航" }).getByRole("link")
  ).toHaveCount(1);
  await expect(
    nav.getByRole("link", { name: "视觉工作台", exact: true })
  ).toHaveAttribute("aria-current", "page");

  // 侧栏为共享壳层：从本页出发逐项跳转，每项断言真实 URL 与高亮迁移
  const hops = [
    ["工作台", "/"],
    ["热点雷达", "/hotspots"],
    ["选题发现", "/topics"],
    ["创作空间", "/compose"],
    ["作品", "/works"],
    ["发布中心", "/publish"],
    ["内容日历", "/calendar"],
    ["效果复盘", "/insights"],
    ["素材库", "/library"],
  ];
  for (const [label, path] of hops) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(
      nav.getByRole("link", { name: label, exact: true })
    ).toHaveAttribute("aria-current", "page");
  }
  await page
    .getByRole("navigation", { name: "偏好导航" })
    .getByRole("link", { name: "偏好与连接", exact: true })
    .click();
  await expect(page).toHaveURL("/settings");
  // 第 11 项回到本页（无深链参数时加载最近作品）
  await nav.getByRole("link", { name: "视觉工作台", exact: true }).click();
  await expect(page).toHaveURL("/illustrations");
  await expect(
    page.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
  await expect(page.getByLabel("配图文章")).toHaveValue(id);
});

test("移动工作流底栏「正文」跳转 /compose 对应作品", async ({ page }) => {
  await signup(page, "illu-mobilebody@example.test");
  const id = await createProject(page, "移动底栏正文跳转验证");
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page, id);
  const workflow = page.getByRole("navigation", { name: "移动端视觉工作流" });
  await expect(
    workflow.getByRole("button", { name: "选图编辑", exact: true })
  ).toHaveAttribute("aria-current", "true");
  await workflow.getByRole("link", { name: "正文", exact: true }).click();
  await expect(page).toHaveURL("/compose?project=" + id);
  await expect(
    page.getByRole("heading", { name: "移动底栏正文跳转验证" })
  ).toBeVisible();
});

test("移动工作流底栏「配图规划」滚动定位到规划带", async ({ page }) => {
  await signup(page, "illu-mobileplan@example.test");
  const id = await createProject(page, "移动底栏规划定位验证");
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page, id);
  const planBand = page.locator(".cv2-illu-plan");
  await expect(planBand).toBeVisible();
  // 先滚到页面底部：规划带移出视口
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const box = await planBand.boundingBox();
      return box ? box.y : -1;
    })
    .toBeLessThan(0);

  await page
    .getByRole("navigation", { name: "移动端视觉工作流" })
    .getByRole("button", { name: "配图规划", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const box = await planBand.boundingBox();
        return box ? box.y : -1;
      },
      { timeout: 5000 }
    )
    .toBeGreaterThanOrEqual(0);
});

test("移动全局底栏与「更多」面板：快捷项高亮、面板入口跳转、Esc 可关闭", async ({
  page,
}) => {
  await signup(page, "illu-mobileshell@example.test");
  const id = await createProject(page, "移动全局导航验证");
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page, id);
  const globalNav = page.getByRole("navigation", { name: "移动端导航" });
  await expect(
    globalNav.getByRole("link", { name: "配图", exact: true })
  ).toHaveAttribute("aria-current", "page");

  await globalNav.getByRole("button", { name: "更多", exact: true }).click();
  const more = page.getByRole("dialog", { name: "更多工作区" });
  await expect(more).toBeVisible();
  for (const label of [
    "创作空间",
    "发布中心",
    "内容日历",
    "效果复盘",
    "素材库",
    "偏好与连接",
  ])
    await expect(more.getByRole("link", { name: label, exact: true })).toBeVisible();
  await more.getByRole("link", { name: "内容日历", exact: true }).click();
  await expect(page).toHaveURL("/calendar");

  await page.goto("/illustrations?project=" + id);
  await globalNav.getByRole("button", { name: "更多", exact: true }).click();
  await expect(more).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toHaveCount(0);
});

// ---- 已登记缺陷的交互（test.fixme；修复后移除 .fixme 即为完整回归用例）----

test.fixme("loadError → ErrorState「配图方案加载失败」+「重试」恢复 @bug:deviations-illu#1", async ({
  page,
}) => {
  // 缺陷：components/IllustrationStudio.jsx:630-632 的 onRetry 只调用
  // loadState(...).catch(...)，而 loadState 成功路径不清 loadError ——
  // 数据恢复后错误态仍驻留。修复后此用例应全绿。
  await signup(page, "illu-loaderror@example.test");
  const id = await createProject(page, "加载失败与重试验证");
  await openStudio(page, id);
  await page.route("**/api/illustrations/projects/" + id, (route) =>
    route.abort()
  );
  await page.reload();
  const errorBox = page.getByRole("alert").filter({ hasText: "配图方案加载失败" });
  await expect(errorBox).toBeVisible();
  await expect(
    errorBox.getByText("网络或服务恢复后可重试；已有图片与计划保留在本地数据库。")
  ).toBeVisible();
  await page.unroute("**/api/illustrations/projects/" + id);
  await errorBox.getByRole("button", { name: "重试", exact: true }).click();
  // 期望：重试成功 → 错误态消失、三栏 studio 恢复（当前缺陷下卡在错误态）
  await expect(
    page.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
  await expect(errorBox).toHaveCount(0);
});

test.fixme("视觉方向风格 chips 选择 +「保存视觉方案」（PUT prompt style，保存后退回待生成） @bug:deviations-illu#2", async ({
  page,
}) => {
  // 缺陷：savePromptFields（components/IllustrationStudio.jsx:355-364）未
  // return run(...) 的结果，调用方 if (await savePromptFields(...)) 恒为假
  // —— PUT 已落库但成功后的面板复位不出现。
  await signup(page, "illu-style@example.test");
  const id = await createProject(page, "视觉方向保存验证");
  await openStudio(page, id);
  await createFullPlan(page);
  const chip = page.getByRole("button", { name: "抽象结构示意" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("保存后该图位退回「待生成」，已批准状态需重新批准；历史候选保留。")
  ).toBeVisible();
  await page.getByRole("button", { name: "保存视觉方案", exact: true }).click();
  // 期望（当前缺陷下不出现）：成功后面板复位、图位真实退回待生成
  await expect(
    page.getByRole("button", { name: "保存视觉方案", exact: true })
  ).toHaveCount(0);
  await expect(page.locator(".cv2-illu-showcase .cv2-pill")).toHaveText("待生成");
  const state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots[0].style).toBe("diagram");
});

test.fixme("「保存为画面描述」（PUT prompt scene，成功后清空指令框） @bug:deviations-illu#2", async ({
  page,
}) => {
  // 同验收缺陷②：savePromptFields 缺 return，「保存为画面描述」成功后指令框不清空。
  await signup(page, "illu-scene@example.test");
  const id = await createProject(page, "画面描述保存验证");
  await openStudio(page, id);
  await createFullPlan(page);
  const instruction = page.getByLabel("图片修改指令");
  await instruction.fill("三段流程图：执行、核验与恢复各占一角，中央是文章标题。");
  await page.getByRole("button", { name: "保存为画面描述", exact: true }).click();
  // 期望（当前缺陷下不清空）：保存成功后指令框复位
  await expect(instruction).toHaveValue("");
  const state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots[0].scene).toContain("三段流程图");
});

test.fixme("图像说明 Alt Text 编辑 +「保存描述」（PUT prompt alt） @bug:deviations-illu#2", async ({
  page,
}) => {
  // 同验收缺陷②：savePromptFields 缺 return，「保存描述」成功 toast 与复位不出现。
  await signup(page, "illu-alt@example.test");
  const id = await createProject(page, "图片描述保存验证");
  await openStudio(page, id);
  await createFullPlan(page);
  const alt = page.getByLabel("图片描述 Alt Text");
  const save = page.getByRole("button", { name: "保存描述", exact: true });
  await alt.fill("合成验收描述：三段式流程概念插画，用于章节配图（测试）。");
  await expect(save).toBeEnabled();
  await save.click();
  // 期望（当前缺陷下不出现）：成功 toast + 面板复位 + 刷新后持久
  await expect(
    page.getByText("图片描述已保存，将用于后续生成与交接。")
  ).toBeVisible();
  const state = await (
    await page.request.get(`/api/illustrations/projects/${id}`)
  ).json();
  expect(state.shots[0].alt).toContain("合成验收描述");
  await page.reload();
  await expect(page.getByLabel("图片描述 Alt Text")).toHaveValue(/合成验收描述/);
});

test.fixme("移动「更多」面板 Esc 关闭后焦点返回「更多」触发按钮 @bug:deviations-shell#5", async ({
  page,
}) => {
  // 缺陷（全局壳层，适用本页）：CreatorShell.jsx 的 Esc 处理只 setMoreOpen(false)，
  // 未把焦点还给「更多」按钮（点击关闭按钮的路径有 moreButtonRef.focus()，Esc 路径没有）。
  await signup(page, "illu-focus@example.test");
  const id = await createProject(page, "更多面板焦点返回验证");
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page, id);
  const moreButton = page
    .getByRole("navigation", { name: "移动端导航" })
    .getByRole("button", { name: "更多", exact: true });
  await moreButton.click();
  const more = page.getByRole("dialog", { name: "更多工作区" });
  await expect(more).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toHaveCount(0);
  // 期望（当前缺陷下焦点留在面板内元素或丢失）
  await expect(moreButton).toBeFocused();
});
