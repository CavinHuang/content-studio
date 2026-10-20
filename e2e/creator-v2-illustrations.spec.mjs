import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
