import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 compose (/compose) e2e — the real 创作空间. Worker-scoped
// guarded production server (same pattern as e2e/creator-v2-works.spec.mjs)
// with multiuser sessions; the synthetic pieces are loopback
// OpenAI-compatible TEXT and image endpoints (same pattern as
// e2e/writing-workspace.spec.mjs — deterministic suggestions, an
// interruptible SSE stream, never a real external call) so suggestion and
// generation interactions can run without any paid service. Coverage per
// the page scope:
//   1. V2.2 three-column editor chrome (header / step strip / ribbon /
//      channel tabs / paper) on a real empty draft, honest empty states,
//      real autosave into SQLite and outline/step facts updating;
//   2. master vs 公众号/知乎 independent revisions with expectedRevision
//      conflict protection surviving a second tab;
//   3. the V2.3 配图 entry: honest empty board, a REAL plan via the
//      illustration domain API, slot statuses and planner hand-off;
//   4. 390×844: mobile pane split, in-workflow bottom nav above the global
//      tabs and no horizontal overflow;
//   5. the interaction audit gaps: header article switcher / 返回作品 /
//      new-tab links / settings+topics links / rail toggles / view
//      segments / 知乎 tab / notice close / conflict+recovery+legacy
//      banners / asset panel / outline focus / suggestion-card controls /
//      history restore / publish dialog copy+report+draft controls /
//      V76 model multi-select / stream toggle / Enter submit / resume
//      cancel / loading state / mobile workflow bar / shell navigation;
//   6. P1-01 阶段深链与前进后退：?stage= 直达（epoch 装载协同不重置）、
//      阶段条切换写 URL 且不重取文档、openPlanner 路径 URL 保持 stage=images。
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
      // Synthetic loopback TEXT provider (same pattern as
      // e2e/writing-workspace.spec.mjs): deterministic full-document /
      // selection suggestions plus an interruptible SSE stream, so the
      // assistant interactions run without any real model service.
      const textModel = createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          let input = {};
          try {
            input = JSON.parse(raw);
          } catch {}
          const payload = JSON.parse(input.messages.at(-1).content);
          if (input.stream && payload.instruction.includes("中断")) {
            const content = JSON.stringify({
              replacement: "# 被中断的流式草稿\n\n这是合成中断流的片段。",
              reason: "合成中断流，仍需作者确认",
            });
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-store",
            });
            res.write(
              "data: " +
                JSON.stringify({
                  choices: [
                    {
                      delta: { content: content.slice(0, 10) },
                      finish_reason: null,
                    },
                  ],
                }) +
                "\n\n"
            );
            setTimeout(() => res.end(), 800);
            return;
          }
          const replacement = payload.selection.text
            ? "经过审阅的新表达。"
            : "# 合成润色初稿\n\n这是回环合成模型的完整替换文本，作者接受前不会进入正文。";
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      replacement,
                      reason: "合成模型：供作者审阅的替换建议。",
                    }),
                  },
                },
              ],
            })
          );
        });
      });
      const textPort = await listen(textModel);
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
        CONTENT_AI_API_KEY: "synthetic-not-a-real-key",
        CONTENT_AI_BASE_URL: `http://127.0.0.1:${textPort}/v1/`,
        CONTENT_AI_MODEL: "synthetic-loopback-compose",
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
        await new Promise((r) => textModel.close(r));
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

async function createProject(page, title) {
  // page.request shares the signed-in cookie jar (multiuser sessions);
  // a bare request fixture would be unauthenticated.
  const r = await page.request.post("/api/writing/projects", {
    data: { title },
  });
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  expect(d.projectId).toMatch(/^ep_/);
  return d.projectId;
}

async function stored(page, id, channel = "master") {
  return (
    await (
      await page.request.get(`/api/writing/projects/${id}/${channel}`)
    ).json()
  );
}

const cm = (page) => page.getByLabel("文章 Markdown 正文");

test("V2 版式：真实空稿的诚实空态、阶段条与 ribbon，正文输入真实自动保存", async ({ page }) => {
  await signup(page, "compose-layout@example.test");
  const id = await createProject(page, "创作空间验证：城市步行观察笔记");
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

  // 阶段条：空稿 → 大纲是当前步骤，其余是数字，不谎报完成；默认落在写作阶段
  const steps = page.locator(".cv2-compose-steps .cv2-compose-step");
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(1)).toHaveClass(/now/);
  await expect(steps.nth(0)).toHaveClass(/todo/);

  // ribbon（检查计数 + 不变量声明）跟随审稿/发布阶段出现
  await page.getByRole("button", { name: "切换到审稿阶段" }).click();
  await expect(page.locator(".cv2-compose-ribbon")).toContainText(
    "待完成人工检查"
  );
  await expect(page.locator(".cv2-compose-ribbon")).toContainText("4 项");
  await expect(
    page.locator(".cv2-compose-ribbon").getByText("主稿 / 平台稿独立")
  ).toBeAttached();
  await page.getByRole("button", { name: "切换到写作阶段" }).click();

  // 诚实空态：结构/配图定位都没有编造内容；稿纸标注 MASTER DRAFT
  await expect(page.getByText("正文中的 # 标题会显示在这里。")).toBeVisible();
  await expect(page.locator(".cv2-paper-label")).toContainText("Master Draft");
  await expect(cm(page)).toBeVisible();
  // 配图定位空态在配图阶段左栏
  await page.getByRole("button", { name: "切换到配图阶段" }).click();
  await expect(
    page.getByText("还没有配图计划；在配图助手里依据主稿规划封面和插图。")
  ).toBeVisible();
  await page.getByRole("button", { name: "切换到写作阶段" }).click();

  // 真实自动保存：输入落入 SQLite；大纲与阶段条随之由真实事实驱动
  const markdown = "# 城市步行观察\n\n第一段真实观察记录。";
  await cm(page).fill(markdown);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
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

test("渠道独立与冲突保护：主稿/公众号独立修订，expectedRevision 冲突不覆盖", async ({ page }) => {
  await signup(page, "compose-channels@example.test");
  const id = await createProject(page, "渠道独立与冲突保护验证");
  const masterText = "# 主稿标题\n\n主稿的原始表达。";
  await page.goto("/compose?project=" + id);
  await cm(page).fill(masterText);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe(masterText);
  const masterBefore = await stored(page, id);

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
    .poll(async () => (await stored(page, id, "wechat")).markdown)
    .toBe(masterText);
  expect((await stored(page, id)).revision).toBe(masterBefore.revision);

  // 平台稿上的独立编辑不回写主稿
  await cm(page).fill("# 公众号标题\n\n公众号自己的开头。");
  await expect
    .poll(async () => (await stored(page, id, "wechat")).markdown)
    .toBe("# 公众号标题\n\n公众号自己的开头。");
  expect((await stored(page, id)).markdown).toBe(masterText);

  // 回主稿，用第二个页面制造 expectedRevision 冲突：本地内容保留、可下载
  await page.getByRole("tab", { name: "主稿" }).click();
  await expect(page.locator(".cv2-paper-label")).toContainText("Master Draft");
  const other = await page.context().newPage();
  await other.goto("/compose?project=" + id);
  await expect(cm(other)).toBeVisible();
  // 第二个页面加载后，第一个页面再保存新修订：第二个页面的
  // expectedRevision 已过期，自动保存必须失败而不是强覆盖。
  await cm(page).fill(masterText + "\n\n窗口一追加的重要修订。");
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toContain("窗口一追加的重要修订。");
  await cm(other).fill("第二个窗口尚未合并的本地内容。");
  await expect(
    other.getByRole("button", { name: "下载本地草稿" })
  ).toBeVisible();
  await expect(cm(other)).toContainText("第二个窗口尚未合并的本地内容。");
  // 服务端仍是第一个窗口的已保存版本（不可变修订未被强覆盖）
  expect((await stored(page, id)).markdown).toBe(
    masterText + "\n\n窗口一追加的重要修订。"
  );
  await other.close();
});

test("V2.3 配图入口：空态诚实，真实计划出现真实图位状态并可去工作台", async ({ page }) => {
  await signup(page, "compose-visual@example.test");
  const id = await createProject(page, "配图计划与图位状态验证");
  const markdown =
    "# 配图验证文章\n\n第一节需要解释一个结构概念，用一段足够长的文字描述任务的执行顺序与边界，方便读者理解流程。\n\n## 第二节\n\n第二节给出对照说明，同样写足长度：通过对照两种做法的差异，说明为什么可靠性比单次演示更加重要。\n\n## 第三节\n\n第三节补充边界情况，继续使用足够长的段落描述失败恢复与人工确认的位置，避免正文过短无法规划。";
  await page.goto("/compose?project=" + id);
  await cm(page).fill(markdown);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe(markdown);

  // 打开配图阶段：没有计划 → 诚实空态 + 指向配图助手
  await page.getByRole("button", { name: "切换到配图阶段" }).click();
  await page.getByRole("button", { name: "切换到配图", exact: true }).click();
  const board = page.getByLabel("配图工作台视图");
  await expect(board).toBeVisible();
  await expect(board.getByText("这篇文章还没有配图计划")).toBeVisible();

  // 通过真实领域 API 创建计划（不经过任何付费调用）
  const master = await stored(page, id);
  const planned = await page.request.post(
    `/api/illustrations/projects/${id}/plan`,
    { data: { expectedMasterRevision: master.revision } }
  );
  expect(planned.ok()).toBeTruthy();
  expect((await planned.json()).shots.length).toBeGreaterThan(0);

  // 重新打开配图视图：真实图位 + 真实状态 pill + 工作台入口
  await page.getByRole("button", { name: "返回编辑" }).click();
  await page.getByRole("button", { name: "切换到配图", exact: true }).click();
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

test("移动 390×844：正文/助手双面板与全局导航共存且无横向溢出", async ({
  page,
}) => {
  await signup(page, "compose-mobile@example.test");
  const id = await createProject(page, "移动端创作空间检查");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();

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

  // 双面板切换（编辑阶段）：默认正文，助手面板隐藏；切到助手后编辑区隐藏
  const mobileTabs = page.locator(".cv2-compose-mobiletabs");
  await expect(mobileTabs).toBeVisible();
  await expect(page.locator(".cv2-compose-middle")).toBeVisible();
  await mobileTabs.getByRole("button", { name: "AI 写作助手" }).click();
  await expect(page.locator(".cv2-compose-middle")).toBeHidden();
  await expect(page.getByLabel("文章配图助手")).toHaveCount(0);
  await mobileTabs.getByRole("button", { name: "正文", exact: true }).click();
  await expect(page.locator(".cv2-compose-middle")).toBeVisible();

  // 配图阶段：移动端助手面板切换为 AI 配图助手
  await page.getByRole("button", { name: "切换到配图阶段" }).click();
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

// ---- 以下为交互审计缺口补充用例（选择器均先核对 components/WritingWorkspace.jsx
// ---- 与 components/CreatorShell.jsx 的真实标记/文案后编写）----

test("头部「当前文章」下拉切换文章：切换前先落盘，双向切换装载真实内容", async ({
  page,
}) => {
  await signup(page, "compose-switch@example.test");
  const idA = await createProject(page, "甲项目：切换验证");
  const idB = await createProject(page, "乙项目：切换验证");
  expect(idA).not.toBe(idB);
  await page.goto("/compose?project=" + idA);
  await expect(cm(page)).toBeVisible();
  await cm(page).fill("甲的第一段内容。");
  await expect
    .poll(async () => (await stored(page, idA)).markdown)
    .toBe("甲的第一段内容。");
  await expect(page.locator(".cv2-compose-save")).toContainText("已保存");

  // 未落盘的新编辑：switchTo 先 flush 再切换（WritingWorkspace.jsx:525-533）
  await cm(page).fill("甲的第二段内容，切换前尚未落盘。");
  await page.getByLabel("当前文章").selectOption({ label: "乙项目：切换验证" });
  await expect(
    page.getByRole("heading", { name: "乙项目：切换验证", level: 1 })
  ).toBeVisible();
  await expect
    .poll(async () => (await stored(page, idA)).markdown)
    .toBe("甲的第二段内容，切换前尚未落盘。");
  await expect(page.locator(".cv2-compose-save")).toContainText("已保存");

  // 切回甲：装载的是服务端真实内容（含刚 flush 的那段）
  await page.getByLabel("当前文章").selectOption({ label: "甲项目：切换验证" });
  await expect(
    page.getByRole("heading", { name: "甲项目：切换验证", level: 1 })
  ).toBeVisible();
  await expect(cm(page)).toContainText("甲的第二段内容，切换前尚未落盘。");
  expect((await stored(page, idB)).markdown).toBe("");
});

test("头部「返回作品」：干净直达 /works，未落盘修改先 flush 再离开且服务端已保存", async ({
  page,
}) => {
  await signup(page, "compose-works-link@example.test");
  const id = await createProject(page, "返回作品链接验证");
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();
  // 干净状态：Link 直接跳转（WritingWorkspace.jsx:1163-1179）
  await page.getByRole("link", { name: "返回作品" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await expect(
    page.getByRole("heading", { name: "每篇作品，都有清晰的下一步" })
  ).toBeVisible();

  // dirty 分支：自动保存前点击 → preventDefault + flush + location.assign
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();
  await cm(page).fill("# 返回前落盘\n\n这段内容尚未自动保存就要离开。");
  await page.getByRole("link", { name: "返回作品" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe("# 返回前落盘\n\n这段内容尚未自动保存就要离开。");
});

test("阶段栏链接：完整视觉工作台新窗到 /illustrations，证据链接经 /editor 回 /compose", async ({
  page,
}) => {
  await signup(page, "compose-newtab@example.test");
  const id = await createProject(page, "新窗链接验证");
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();

  // 配图阶段左栏「完整视觉工作台 ↗」target=_blank
  await page.getByRole("button", { name: "切换到配图阶段" }).click();
  let popupPromise = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "完整视觉工作台 ↗" }).click();
  let popup = await popupPromise;
  await expect(popup).toHaveURL(new RegExp("/illustrations\\?project=" + id));
  await expect(
    popup.getByRole("heading", { name: "让每一张图片都有它的位置" })
  ).toBeVisible();
  await popup.close();

  // 审稿阶段「查看证据与核查 ↗」href=/editor?project&channel；
  // /editor 是旧深链，服务端重定向回 /compose 并保留参数（app/editor/page.jsx）
  await page.getByRole("button", { name: "切换到审稿阶段" }).click();
  popupPromise = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "查看证据与核查 ↗" }).click();
  popup = await popupPromise;
  await expect(popup).toHaveURL(
    new RegExp("/compose\\?project=" + id + "&channel=master$")
  );
  await expect(
    popup.getByRole("heading", { name: "新窗链接验证", level: 1 })
  ).toBeVisible();
  await popup.close();
});

test("新建表单「从选题开始 →」跳转 /topics", async ({ page }) => {
  await signup(page, "compose-topics-link@example.test");
  const id = await createProject(page, "选题链接验证");
  await page.goto("/compose?project=" + id);
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  const form = page.locator(".cv2-compose-new");
  await expect(form).toBeVisible();
  // Link 位于新建表单内（WritingWorkspace.jsx:1278）
  await form.getByRole("link", { name: "从选题开始 →" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(
    page.getByRole("heading", { name: "选题发现", exact: true })
  ).toBeVisible();
});

test("右栏「模型服务设置」跳转 /settings#services 并落在服务连接分组", async ({
  page,
}) => {
  await signup(page, "compose-settings-link@example.test");
  const id = await createProject(page, "模型服务设置链接验证");
  await page.goto("/compose?project=" + id);
  // Link 位于助手栏（WritingWorkspace.jsx:1761-1764）
  await page
    .locator(".cv2-compose-assistant")
    .getByRole("link", { name: "模型服务设置" })
    .click();
  await expect(page).toHaveURL(/\/settings#services$/);
  await expect(
    page.getByRole("heading", { name: "服务连接", exact: true })
  ).toBeVisible();
});

test("阶段焦点视图：助手栏「收起助手/创作助手」真实折叠，阶段切换隐藏编辑工作区", async ({
  page,
}) => {
  await signup(page, "compose-toggles@example.test");
  const id = await createProject(page, "面板开关验证");
  await page.goto("/compose?project=" + id);
  const rail = page.locator(".cv2-compose-rail");
  const assistant = page.locator(".cv2-compose-assistant");
  const grid = page.locator(".cv2-compose-grid");
  // 默认助手栏展开；收起后条件渲染移除整栏，再点恢复
  const rightToggle = page.getByRole("button", { name: "收起助手" });
  await expect(assistant).toBeVisible();
  await rightToggle.click();
  await expect(assistant).toHaveCount(0);
  await page.getByRole("button", { name: "创作助手", exact: true }).click();
  await expect(assistant).toBeVisible();

  // 阶段切换：研究阶段没有编辑工作区，回到写作阶段恢复
  await page.getByRole("button", { name: "切换到研究阶段" }).click();
  await expect(grid).toHaveCount(0);
  await expect(page.getByText("作者设定与参考资料")).toBeVisible();
  await page.getByRole("button", { name: "切换到写作阶段" }).click();
  await expect(grid).toBeVisible();
  await expect(rail).toBeVisible();
});

test("编辑视图分段：源码隐藏预览、预览隐藏编辑器并渲染排版、分栏恢复双栏", async ({
  page,
}) => {
  await signup(page, "compose-views@example.test");
  const id = await createProject(page, "编辑视图分段验证");
  await page.goto("/compose?project=" + id);
  await cm(page).fill("# 视图验证标题\n\n正文段落，用于预览渲染。");
  const seg = page.getByRole("group", { name: "编辑视图" });
  const previewPane = page.getByLabel("文章排版预览");
  // 默认分栏：编辑器与预览同时可见
  await expect(cm(page)).toBeVisible();
  await expect(previewPane).toBeVisible();

  await seg.getByRole("button", { name: "源码" }).click();
  await expect(seg.getByRole("button", { name: "源码" })).toHaveClass(/active/);
  await expect(previewPane).toHaveCount(0); // view=source 时不渲染 Preview
  await expect(cm(page)).toBeVisible();

  await seg.getByRole("button", { name: "预览" }).click();
  await expect(seg.getByRole("button", { name: "预览" })).toHaveClass(/active/);
  await expect(cm(page)).toBeHidden(); // 编辑器容器 writing-hidden
  await expect(previewPane).toBeVisible();
  await expect(
    previewPane.getByRole("heading", { name: "视图验证标题" })
  ).toBeVisible();

  await seg.getByRole("button", { name: "分栏" }).click();
  await expect(cm(page)).toBeVisible();
  await expect(previewPane).toBeVisible();
});

test("渠道分段切到知乎：平台稿独立装载与保存，主稿不受影响", async ({
  page,
}) => {
  await signup(page, "compose-zhihu@example.test");
  const id = await createProject(page, "知乎渠道独立验证");
  const masterText = "# 主稿标题\n\n主稿内容。";
  await page.goto("/compose?project=" + id);
  await cm(page).fill(masterText);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe(masterText);
  await expect(page.locator(".cv2-compose-save")).toContainText("已保存");

  const tabs = page.getByRole("tablist", { name: "稿件渠道" });
  await tabs.getByRole("tab", { name: "知乎" }).click();
  await expect(tabs.getByRole("tab", { name: "知乎" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(tabs.getByRole("tab", { name: "主稿" })).toHaveAttribute(
    "aria-selected",
    "false"
  );
  await expect(page.locator(".cv2-paper-label")).toContainText("Zhihu Draft");
  await expect(page.locator(".cv2-compose-header .cv2-eyebrow")).toContainText(
    "作品 / 知乎"
  );
  await expect(
    page.getByText("平台稿独立保存，主稿不会被自动改写。")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看并合并主稿差异" })
  ).toBeVisible();

  const zhihuText = "# 知乎版标题\n\n知乎自己的开头。";
  await cm(page).fill(zhihuText);
  await expect
    .poll(async () => (await stored(page, id, "zhihu")).markdown)
    .toBe(zhihuText);
  expect((await stored(page, id)).markdown).toBe(masterText);

  await tabs.getByRole("tab", { name: "主稿" }).click();
  await expect(page.locator(".cv2-paper-label")).toContainText("Master Draft");
  await expect(cm(page)).toContainText("主稿内容。");
});

test("通知条「关闭消息」与冲突横幅「重试保存」「载入服务器版本」", async ({
  page,
}) => {
  await signup(page, "compose-conflict@example.test");
  const id = await createProject(page, "冲突横幅按钮验证");
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();
  const other = await page.context().newPage();
  await other.goto("/compose?project=" + id);
  await expect(cm(other)).toBeVisible();

  // 第二窗口落后：第一窗口保存新修订 → 第二窗口自动保存 409 → 冲突横幅
  const serverText = "窗口一已保存的较新内容。";
  await cm(page).fill(serverText);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe(serverText);
  await cm(other).fill("窗口二未合并的本地修改。");
  await expect(
    other.getByRole("button", { name: "下载本地草稿" })
  ).toBeVisible();
  await expect(other.locator(".writing-notice")).toContainText(
    "Document revision conflict"
  );

  // 通知条可关闭（WritingWorkspace.jsx:1281-1288）
  await other.getByRole("button", { name: "关闭消息" }).click();
  await expect(other.locator(".writing-notice")).toHaveCount(0);

  // 「重试保存」：仍 409，横幅与错误通知真实重现（1302）
  await other.getByRole("button", { name: "重试保存" }).click();
  await expect(other.locator(".writing-conflict")).toBeVisible();
  await expect(other.locator(".writing-notice")).toContainText(
    "Document revision conflict"
  );
  expect((await stored(page, id)).markdown).toBe(serverText);

  // 「载入服务器版本」：确认后放弃本地修改、解除暂停、可继续保存（1303）
  other.once("dialog", (dialog) => dialog.accept());
  await other.getByRole("button", { name: "载入服务器版本" }).click();
  await expect(other.locator(".writing-conflict")).toHaveCount(0);
  await expect(other.locator(".writing-notice")).toContainText(
    "已载入最新版本。"
  );
  await expect(cm(other)).toContainText(serverText);
  await cm(other).fill(serverText + "\n\n恢复后追加的新段落。");
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toContain("恢复后追加的新段落。");
  await other.close();
});

test("恢复横幅「继续使用服务器版本」放弃本地草稿且刷新不再出现", async ({
  page,
}) => {
  await signup(page, "compose-recovery@example.test");
  const id = await createProject(page, "恢复横幅验证");
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();
  // 自动保存（900ms 防抖）前刷新：sessionStorage 草稿 → 恢复横幅
  await cm(page).fill("刷新前尚未保存的本地草稿内容。");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "继续使用服务器版本" })
  ).toBeVisible();
  // discardRecovery：清 sessionStorage、横幅消失、编辑器回到服务端版本
  await page.getByRole("button", { name: "继续使用服务器版本" }).click();
  await expect(
    page.getByRole("button", { name: "继续使用服务器版本" })
  ).toHaveCount(0);
  // CM6 空文档时 .cm-content 会渲染占位文案，无法 toHaveText("")；
  // 编辑器层面验证被放弃的本地草稿已不在正文，服务端空稿由下一行核对。
  await expect(cm(page)).not.toContainText("刷新前尚未保存的本地草稿内容。");
  expect((await stored(page, id)).markdown).toBe("");
  // 刷新后不再出现恢复横幅
  await page.reload();
  await expect(
    page.getByRole("button", { name: "恢复本地未保存草稿" })
  ).toHaveCount(0);
});

test("legacy 双稿迁移：沿用原正文/沿用历史排版稿各落成独立渠道稿", async ({
  page,
}) => {
  await signup(page, "compose-legacy@example.test");
  const id = await createProject(page, "legacy 双稿迁移验证");
  // 真实领域数据：排版稿经 composer 审阅+确认漂移后落库（渠道仍无 Markdown 行）
  const detail = await (
    await page.request.get("/api/editor/projects/" + id)
  ).json();
  const zhihuLayout = "# 知乎历史排版稿\n\n这是独立排版工具里审阅过的历史排版内容。";
  const review = await page.request.post(
    `/api/composer/projects/${id}/zhihu/review`,
    {
      data: {
        expectedLayoutRevision: 0,
        expectedDocumentRevision: detail.channels.zhihu.document.revision,
        markdown: zhihuLayout,
      },
    }
  );
  expect(review.ok()).toBeTruthy();
  const token = (await review.json()).reviewToken;
  const put = await page.request.put(`/api/composer/projects/${id}/zhihu`, {
    data: {
      expectedLayoutRevision: 0,
      expectedDocumentRevision: detail.channels.zhihu.document.revision,
      markdown: zhihuLayout,
      reviewToken: token,
      acknowledgeDrift: true,
    },
  });
  expect(put.ok()).toBeTruthy();
  const legacyDoc = await (
    await page.request.get(`/api/writing/projects/${id}/zhihu`)
  ).json();
  expect(legacyDoc.mode).toBe("legacy");
  expect(legacyDoc.legacyLayout.markdown).toBe(zhihuLayout);

  // 「沿用历史排版稿」：编辑器装载排版稿，自动保存带 resolveLegacy=layout
  await page.goto("/compose?project=" + id + "&channel=zhihu");
  await expect(
    page.getByText("这篇文章同时保留了正文和独立排版稿", { exact: false })
  ).toBeVisible();
  await page.getByRole("button", { name: "沿用历史排版稿" }).click();
  await expect(
    page.getByRole("button", { name: "沿用历史排版稿" })
  ).toHaveCount(0);
  await expect(cm(page)).toContainText("独立排版工具里审阅过的历史排版内容");
  await expect
    .poll(async () => (await stored(page, id, "zhihu")).markdown)
    .toBe(zhihuLayout);
  await expect(page.locator(".cv2-paper-label")).toContainText("Markdown");

  // 刷新后迁移结果持久、不再出现选择横幅
  await page.reload();
  await expect(cm(page)).toContainText("历史排版内容");
  await expect(
    page.getByRole("button", { name: "沿用历史排版稿" })
  ).toHaveCount(0);

  // 「沿用原正文」：公众号稿装载原正文（标题+种子段落）并保存
  const wechatReview = await page.request.post(
    `/api/composer/projects/${id}/wechat/review`,
    {
      data: {
        expectedLayoutRevision: 0,
        expectedDocumentRevision: detail.channels.wechat.document.revision,
        markdown: "# 公众号历史排版稿\n\n另一份历史排版内容。",
      },
    }
  );
  expect(wechatReview.ok()).toBeTruthy();
  await page.request.put(`/api/composer/projects/${id}/wechat`, {
    data: {
      expectedLayoutRevision: 0,
      expectedDocumentRevision: detail.channels.wechat.document.revision,
      markdown: "# 公众号历史排版稿\n\n另一份历史排版内容。",
      reviewToken: (await wechatReview.json()).reviewToken,
      acknowledgeDrift: true,
    },
  });
  await page.goto("/compose?project=" + id + "&channel=wechat");
  await expect(
    page.getByText("这篇文章同时保留了正文和独立排版稿", { exact: false })
  ).toBeVisible();
  await page.getByRole("button", { name: "沿用原正文" }).click();
  await expect(cm(page)).toContainText(
    "请用自己的实践、观察和可靠来源逐段写作"
  );
  await expect
    .poll(async () => (await stored(page, id, "wechat")).markdown)
    .toBe(
      "# legacy 双稿迁移验证\n\n请用自己的实践、观察和可靠来源逐段写作，未经核实的结论不可直接发表。\n"
    );
  expect((await stored(page, id, "zhihu")).markdown).toBe(zhihuLayout);
});

test("「从素材库插图」：空态诚实，点选素材插入正文并持久化", async ({
  page,
}) => {
  await signup(page, "compose-assets@example.test");
  const id = await createProject(page, "素材库插图验证");
  await page.goto("/compose?project=" + id);
  await cm(page).fill("# 素材验证\n\n插图前的段落。");
  // 素材面板在配图阶段左栏（编辑器保持挂载，插入即时落稿）
  await page.getByRole("button", { name: "切换到配图阶段" }).click();
  // 空素材库的诚实空态（WritingWorkspace 配图阶段左栏）
  await page.getByRole("button", { name: "从素材库插图" }).click();
  await expect(page.getByText("还没有图片，可上传或生成。")).toBeVisible();

  // 真实素材入库（合成 1×1 PNG，非外链 fixture）
  const uploaded = await page.request.post("/api/assets", {
    data: { name: "synthetic-compose.png", alt: "合成配图", base64: PNG_1X1 },
  });
  expect(uploaded.ok()).toBeTruthy();
  const asset = await uploaded.json();

  // 重新打开面板 → 点选素材插入正文
  await page.getByRole("button", { name: "从素材库插图" }).click();
  const assetButton = page
    .locator(".writing-assets")
    .getByRole("button")
    .first();
  await expect(assetButton).toContainText("synthetic-compose.png");
  await assetButton.click();
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toContain("asset://" + asset.id);
  // 刷新后插图仍在正文（真实持久化）
  await page.reload();
  await expect(cm(page)).toContainText("asset://" + asset.id);
});

test("左栏大纲链接点击聚焦编辑器；空简报文案诚实", async ({ page }) => {
  await signup(page, "compose-outline@example.test");
  const id = await createProject(page, "大纲聚焦验证");
  await page.goto("/compose?project=" + id);
  await cm(page).fill("# 大纲标题甲\n\n正文段落。");
  const outlineLink = page
    .locator(".cv2-compose-outline-link", { hasText: "大纲标题甲" });
  await expect(outlineLink).toBeVisible();
  // 点击大纲链接 → editor.focus()（WritingWorkspace.jsx:1369-1386）
  await outlineLink.click();
  await expect(cm(page)).toBeFocused();
  // 无简报时的诚实空态（写作阶段左栏不再展开简报来源；来源在研究阶段）
  await expect(page.getByText("还没有选题简报。")).toBeVisible();
});

test("建议卡「在正文中查看」「查看替换内容」「拒绝」三控件", async ({
  page,
}) => {
  await signup(page, "compose-suggestion@example.test");
  const id = await createProject(page, "建议卡控件验证");
  await page.goto("/compose?project=" + id);
  await cm(page).fill("需要打磨的原始表达。");
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe("需要打磨的原始表达。");
  await page.getByLabel("与助手讨论或提出写作要求").fill("请整体打磨这份表达");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  const card = page.locator(".writing-suggestion", {
    hasText: "合成模型：供作者审阅的替换建议。",
  });
  await expect(card).toBeVisible();

  // 切到源码视图后「在正文中查看」恢复分栏并聚焦该建议（1957-1964）
  await page
    .getByRole("group", { name: "编辑视图" })
    .getByRole("button", { name: "源码" })
    .click();
  await expect(page.getByLabel("文章排版预览")).toHaveCount(0);
  await card.getByRole("button", { name: "在正文中查看" }).click();
  await expect(page.getByLabel("文章排版预览")).toBeVisible();
  await expect(card).toHaveClass(/selected/);

  // 「查看替换内容」展开替换文本（<pre>{s.replacement}</pre>）。
  // 未显式传 from/to 时服务端把 selection 填充为整篇文章（writing.mjs:887-890,972），
  // 合成模型因此恒走选区分支返回「经过审阅的新表达。」——断言真实的替换文本。
  await card.getByText("查看替换内容").click();
  await expect(card.locator("pre")).toContainText("经过审阅的新表达。");

  // 「拒绝」：建议标记已拒绝，正文保持原样（1980-1985）
  await card.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(page.locator(".writing-notice")).toContainText(
    "已拒绝这条建议，正文保持原样。"
  );
  // 拒绝标记在卡片的 small 里带模型后缀（「已拒绝 · 由 … 生成」），不能用 exact。
  await expect(card.getByText("已拒绝", { exact: false })).toBeVisible();
  expect((await stored(page, id)).markdown).toBe("需要打磨的原始表达。");
});

test("版本历史「恢复为新版本」产生新修订且历史保留", async ({ page }) => {
  await signup(page, "compose-restore@example.test");
  const id = await createProject(page, "版本恢复验证");
  await page.goto("/compose?project=" + id);
  await cm(page).fill("第一版正文内容。");
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe("第一版正文内容。");
  // 真实修订模型（writing.create→save("")，src/writing.mjs:456-466）：创建即产生
  // v1（种子模板稿）与 v2（空稿）两个修订，首次作者保存是 v3，当前修订行禁用恢复。
  const histBefore = (
    await (await page.request.get(`/api/writing/projects/${id}/master/history`)).json()
  ).history;
  const seedRow = histBefore.find((r) => r.revision === 1);
  const filled = await stored(page, id);
  expect(filled.revision).toBe(3);

  await page.getByRole("button", { name: "版本", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "文章版本历史" });
  await expect(dialog).toBeVisible();
  const curRow = dialog.locator("article", { hasText: `v${filled.revision} ·` });
  await expect(curRow.getByRole("button", { name: "恢复为新版本" })).toBeDisabled();
  // restore(row)：PUT 旧内容为新修订（WritingWorkspace.jsx:2207-2212）
  page.once("dialog", (dialog) => dialog.accept());
  await dialog
    .locator("article", { hasText: "v1 ·" })
    .getByRole("button", { name: "恢复为新版本" })
    .click();
  await expect(page.locator(".writing-notice")).toContainText(
    "历史内容已恢复为新版本。"
  );
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await stored(page, id)).revision)
    .toBe(filled.revision + 1);
  // 恢复的是 v1 的种子模板稿内容
  expect((await stored(page, id)).markdown).toBe(seedRow.markdown);
  // 不可变修订：v1/v2/v3 全部仍在，新修订为 v4
  await page.getByRole("button", { name: "版本", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "文章版本历史" }).locator("article")
  ).toHaveCount(4);
  await page
    .getByRole("dialog", { name: "文章版本历史" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
});

test("发布准备阶段：复制排版进剪贴板、记录作者确认已发布、草稿箱控件", async ({
  page,
}) => {
  await signup(page, "compose-publish@example.test");
  const id = await createProject(page, "发布准备对话框验证");
  const masterText = "# 发布验证\n\n准备发布的段落，导出不等于发布。";
  await page.goto("/compose?project=" + id);
  await cm(page).fill(masterText);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe(masterText);
  const master = await stored(page, id);
  const wechat = await stored(page, id, "wechat");
  await page.request.put(`/api/writing/projects/${id}/wechat`, {
    data: {
      expectedRevision: wechat.revision,
      markdown: masterText,
      sourceMasterRevision: master.revision,
    },
  });
  await page.goto("/compose?project=" + id + "&channel=wechat");
  await expect(page.locator(".cv2-paper-label")).toContainText("Wechat Draft");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.getByRole("button", { name: "发布准备", exact: true }).click();
  const dialog = page.locator('section[aria-label="平台发布准备"]');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "微信公众号 · 发布准备" })
  ).toBeVisible();
  // 对话框内 PublishingControls 草稿箱控件：无账号/封面时诚实地禁用
  await expect(
    dialog.getByRole("heading", { name: "发送到微信公众号草稿箱" })
  ).toBeVisible();
  await expect(
    dialog.getByText("确认发送当前公众号稿、封面和正文图片到所选账号")
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "发送到公众号草稿箱" })
  ).toBeDisabled();

  for (const label of [
    "事实与引用已核对",
    "隐私信息已核对",
    "文字与图片使用权已核对",
    "已在目标平台核对排版",
  ])
    await dialog.getByLabel(label).check();
  await dialog
    .getByRole("button", { name: "保存当前版本检查" })
    .click();
  await expect(page.locator(".writing-notice")).toContainText(
    "当前版本的四项检查已保存。"
  );

  // 「复制排版」：真实写入剪贴板（text/plain 为导出 Markdown）并置为已导出
  await dialog.getByRole("button", { name: "复制排版" }).click();
  await expect(page.locator(".writing-notice")).toContainText(
    "已复制排版内容，请到目标平台粘贴并检查。该操作不代表已发布。"
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    masterText
  );
  expect(
    (await (await page.request.get("/api/editor/projects/" + id)).json())
      .channels.wechat.status
  ).toBe("exported");

  // 「已发布链接」+「记录作者确认已发布」：人工记录落库，导出≠发布
  await dialog.getByLabel("实际发布链接").fill("https://platform.example.com/article/001");
  await dialog.getByRole("button", { name: "记录作者确认已发布" }).click();
  await expect(page.locator(".writing-notice")).toContainText(
    "已保存作者确认的发布链接，状态来源为人工记录。"
  );
  expect(
    (await (await page.request.get("/api/editor/projects/" + id)).json())
      .channels.wechat.reportedUrl
  ).toBe("https://platform.example.com/article/001");
});

test("对比模型多选与「逐段预览」开关（V76 顺序对比勾选）", async ({ page }) => {
  await signup(page, "compose-models@example.test");
  const id = await createProject(page, "模型多选验证");
  // 真实服务连接入库（save 不做网络调用；synthetic 域名仅作为目录来源）
  const saved = await page.request.post("/api/creator/services", {
    data: {
      kind: "text",
      name: "合成写作服务",
      baseUrl: "https://synthetic-provider.example/v1/",
      model: "synthetic-mini",
      apiKey: "synthetic-not-a-real-key",
      models: ["synthetic-mini", "synthetic-max"],
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto("/compose?project=" + id);

  const mini = page.locator("label.writing-consent", {
    hasText: "synthetic-mini",
  });
  const maxi = page.locator("label.writing-consent", {
    hasText: "synthetic-max",
  });
  await expect(mini).toContainText("（当前服务）");
  await expect(mini.getByRole("checkbox")).toBeChecked();
  await expect(maxi.getByRole("checkbox")).not.toBeChecked();
  const consentLabel = page.locator("label.writing-consent", {
    hasText: "允许本次向已配置模型发送文章",
  });
  await expect(consentLabel).not.toContainText("将按顺序调用");

  // 勾选第二个 → 同意文案声明顺序调用两个模型（toggleChosen，2000-2020）
  await maxi.getByRole("checkbox").check();
  await expect(consentLabel).toContainText(
    "将按顺序调用 2 个模型，各计一次额度"
  );
  await mini.getByRole("checkbox").uncheck();
  await expect(consentLabel).not.toContainText("将按顺序调用");
  await expect(maxi.getByRole("checkbox")).toBeChecked();

  // 「逐段预览」流式开关（2021-2029）
  const streamLabel = page.locator("label.writing-consent", {
    hasText: "逐段预览",
  });
  await expect(streamLabel.getByRole("checkbox")).toBeChecked();
  await streamLabel.getByRole("checkbox").uncheck();
  await expect(streamLabel.getByRole("checkbox")).not.toBeChecked();
  await streamLabel.getByRole("checkbox").check();
  await expect(streamLabel.getByRole("checkbox")).toBeChecked();
});

test("指令框 Enter 发送与 Shift+Enter 换行", async ({ page }) => {
  await signup(page, "compose-enter@example.test");
  const id = await createProject(page, "回车发送验证");
  await page.goto("/compose?project=" + id);
  await cm(page).fill("待润色的原文。");
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe("待润色的原文。");
  const instruction = page.getByLabel("与助手讨论或提出写作要求");
  await instruction.fill("请整体润色这份初稿");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();

  // Shift+Enter 只换行，不提交（prompt-input.jsx:28）
  await instruction.press("Shift+Enter");
  expect((await instruction.inputValue()).endsWith("\n")).toBe(true);
  await expect(page.locator(".writing-suggestion")).toHaveCount(0);

  // Enter 直接提交（onEnterSubmit=generate，WritingWorkspace.jsx:2067）。
  // .writing-suggestion 同时被「生成记录」历史卡复用（WritingGenerations.jsx:14），
  // 需限定在审阅列表 .writing-suggestions 内。
  await instruction.press("Enter");
  const card = page.locator(".writing-suggestions .writing-suggestion", {
    hasText: "请整体润色这份初稿",
  });
  await expect(card).toBeVisible();
  await expect(page.locator(".writing-notice")).toContainText("建议已生成。");
  // 接受前正文保持不变
  expect((await stored(page, id)).markdown).toBe("待润色的原文。");
});

test("失败生成记录可「恢复请求到助手」，也可「取消恢复请求」", async ({
  page,
}) => {
  await signup(page, "compose-resume@example.test");
  const id = await createProject(page, "恢复请求验证");
  await page.goto("/compose?project=" + id);
  const instruction = page.getByLabel("与助手讨论或提出写作要求");
  await instruction.fill("请做一次会中断的流式生成");
  await page
    .getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
    .check();
  await page.getByRole("button", { name: "生成写作建议", exact: true }).click();
  // 合成流只发一个分片后中断 → 服务端记录 failed，正文不变
  await expect(page.locator(".writing-notice")).toContainText(/中断|未完成/);
  expect((await stored(page, id)).markdown).toBe("");

  await page.getByText(/生成记录与恢复（1）/).click();
  await page.getByRole("button", { name: "恢复请求到助手" }).click();
  // resumeGeneration：回填原指令、取消授权、显示恢复说明（2030-2040 之前的 593-606）
  await expect(instruction).toHaveValue("请做一次会中断的流式生成");
  await expect(
    page.getByLabel("允许本次向已配置模型发送文章、参考素材与写作要求")
  ).not.toBeChecked();
  const resumeNote = page.getByText("已恢复原请求与选区；将发起新的模型请求。");
  await expect(resumeNote).toBeVisible();
  // 「取消恢复请求」清除恢复态（2030-2040）
  await page.getByRole("button", { name: "取消恢复请求" }).click();
  await expect(resumeNote).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "生成写作建议", exact: true })
  ).toBeDisabled();
});

test("加载态「正在载入稿件…」在稿件拉取期间出现", async ({ page }) => {
  await signup(page, "compose-loading@example.test");
  const id = await createProject(page, "加载态验证");
  await page.route("**/api/writing/projects/" + id + "/master", async (route) => {
    await sleep(1200);
    await route.continue();
  });
  await page.goto("/compose?project=" + id);
  // doc 拉取期间的真实瞬态（WritingWorkspace.jsx:1315-1317）
  await expect(page.getByText("正在载入稿件…")).toBeVisible();
  await expect(cm(page)).toBeVisible();
  await expect(page.getByText("正在载入稿件…")).toHaveCount(0);
  await page.unroute("**/api/writing/projects/" + id + "/master");
});

test("移动 390：阶段条与助手双面板真实动作，通知可关闭", async ({
  page,
}) => {
  await signup(page, "compose-mobile-flow@example.test");
  const id = await createProject(page, "移动工作流底栏验证");
  // 先用一次真实网络失败验证移动端通知条「关闭消息」
  await page.route("**/api/writing/projects/" + id + "/master", (route) =>
    route.abort()
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compose?project=" + id);
  await expect(page.locator(".writing-notice")).toBeVisible();
  await page.getByRole("button", { name: "关闭消息" }).click();
  await expect(page.locator(".writing-notice")).toHaveCount(0);
  await page.unroute("**/api/writing/projects/" + id + "/master");
  await page.reload();
  await expect(cm(page)).toBeVisible();
  await cm(page).fill("# 移动预览标题\n\n移动端预览的正文段落。");

  // 阶段条切换：配图阶段助手面板为 AI 配图助手，正文可返回
  await page.getByRole("button", { name: "切换到配图阶段" }).click();
  const mobileTabs = page.locator(".cv2-compose-mobiletabs");
  await mobileTabs.getByRole("button", { name: "AI 配图助手" }).click();
  await expect(page.locator(".cv2-compose-middle")).toBeHidden();
  await expect(page.getByLabel("文章配图助手")).toBeVisible();
  await mobileTabs.getByRole("button", { name: "正文", exact: true }).click();
  await expect(cm(page)).toBeVisible();
  // 回到写作阶段：编辑视图分段切到预览（排版预览可见、编辑器隐藏）
  await page.getByRole("button", { name: "切换到写作阶段" }).click();
  await page
    .getByRole("group", { name: "编辑视图" })
    .getByRole("button", { name: "预览" })
    .click();
  await expect(cm(page)).toBeHidden();
  await expect(page.getByLabel("文章排版预览")).toBeVisible();
  await expect(page.getByLabel("文章排版预览")).toContainText(
    "移动端预览的正文段落"
  );
});

test("从 /compose 出发：桌面侧栏与移动全局底栏（含「更多」面板 Esc 关闭）", async ({
  page,
}) => {
  await signup(page, "compose-shell-nav@example.test");
  const id = await createProject(page, "壳层导航验证");
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();
  // 桌面侧栏（CreatorShell.jsx:165-169）：当前项高亮，点「作品」跳转
  const sideNav = page.getByRole("navigation", { name: "创作导航" });
  await expect(
    sideNav.getByRole("link", { name: "创作空间" })
  ).toHaveAttribute("aria-current", "page");
  await sideNav.getByRole("link", { name: "作品" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await expect(
    page.getByRole("heading", { name: "每篇作品，都有清晰的下一步" })
  ).toBeVisible();

  // 移动全局底栏（CreatorShell.jsx:219-236）：「更多」面板 + Esc 关闭
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compose?project=" + id);
  const mobileTabs = page.getByRole("navigation", { name: "移动端导航" });
  await expect(mobileTabs).toBeVisible();
  const more = mobileTabs.getByRole("button", { name: "更多" });
  await more.click();
  const morePanel = page.getByRole("dialog", { name: "更多工作区" });
  await expect(morePanel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(morePanel).toHaveCount(0);
  await more.click();
  await morePanel.getByRole("link", { name: "创作空间" }).click();
  await expect(page).toHaveURL(/\/compose/);
  await mobileTabs.getByRole("link", { name: "选题" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await expect(
    page.getByRole("heading", { name: "选题发现", exact: true })
  ).toBeVisible();
});

// ---- P1-01 阶段深链与前进后退（阶段只是呈现层焦点；文档装载/保存路径不变）----

test("阶段深链：?stage=publish 文档装载完成后仍停发布阶段，不回写作", async ({
  page,
}) => {
  await signup(page, "compose-deeplink@example.test");
  const id = await createProject(page, "发布阶段深链验证");
  await page.goto("/compose?project=" + id + "&stage=publish");
  // 发布阶段没有编辑器工作面（editorStage=false），文档装载完成以保存徽标
  // 出现真实修订为准；此后发布卡片必须仍在——epoch effect 的装载协同
  // （?stage= 白名单解析 + replaceState）不得把深链重置回写作阶段。
  await expect(page.locator(".cv2-compose-save")).toHaveText(/已保存 · v\d+/);
  await expect(page).toHaveURL(/stage=publish/);
  await expect(
    page.getByRole("heading", { name: "主稿不直接发布" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "创建微信公众号平台稿" })
  ).toBeVisible();
  const steps = page.locator(".cv2-compose-steps .cv2-compose-step");
  await expect(steps.nth(5)).toHaveAttribute("aria-current", "step");
});

test("阶段切换写 URL 且不重取文档，未保存修改保留，后退前进跨阶段同步", async ({
  page,
}) => {
  await signup(page, "compose-stageurl@example.test");
  const id = await createProject(page, "阶段前进后退验证");
  await page.goto("/compose?project=" + id);
  await expect(cm(page)).toBeVisible();

  // 网络断言基线：初始装载完成后再挂监听，切阶段不得产生新的
  // 文档 GET（/api/writing/projects/…）或 refreshProjects 重跑
  // （/api/editor/projects，验证 effect 依赖收窄）。
  let docGets = 0;
  let projectListGets = 0;
  page.on("request", (r) => {
    if (r.method() !== "GET") return;
    if (r.url().includes("/api/writing/projects/")) docGets++;
    if (r.url().includes("/api/editor/projects")) projectListGets++;
  });

  // 切审稿：URL 写入 stage=review；自动保存窗口（900ms）内允许 PUT，
  // 不允许任何文档 GET；未保存修改在切回写作后仍在（编辑器不重挂载）。
  await cm(page).fill("切阶段前输入、尚未自动保存的句子。");
  await page.getByRole("button", { name: "切换到审稿阶段" }).click();
  await expect(page).toHaveURL(/stage=review/);
  await expect(page.locator(".cv2-compose-ribbon")).toContainText(
    "待完成人工检查"
  );
  await sleep(1200);
  expect(docGets, "切阶段不得重新 GET 文档").toBe(0);
  expect(projectListGets, "切阶段不得重跑 refreshProjects").toBe(0);

  // 后退回写作阶段（上一历史条目），前进再回审稿——popstate 对齐 effect 承接
  await page.goBack();
  await expect(page.locator(".cv2-compose-grid")).toBeVisible();
  await expect(page).not.toHaveURL(/stage=review/);
  await expect(cm(page)).toContainText("切阶段前输入、尚未自动保存的句子。");
  await page.goForward();
  await expect(page).toHaveURL(/stage=review/);
  await expect(page.locator(".cv2-compose-ribbon")).toContainText(
    "待完成人工检查"
  );
  // 全程没有新文档 GET：后退前进也只改呈现层焦点
  expect(docGets, "前进后退不得重新 GET 文档").toBe(0);
});

test("openPlanner 路径（图位进助手）后 URL 保持 stage=images", async ({
  page,
}) => {
  await signup(page, "compose-planner-url@example.test");
  const id = await createProject(page, "配图助手路径 URL 验证");
  const markdown =
    "# 配图路径验证文章\n\n第一节需要解释一个结构概念，用一段足够长的文字描述任务的执行顺序与边界，方便读者理解流程。\n\n## 第二节\n\n第二节给出对照说明，同样写足长度：通过对照两种做法的差异，说明为什么可靠性比单次演示更加重要。\n\n## 第三节\n\n第三节补充边界情况，继续使用足够长的段落描述失败恢复与人工确认的位置，避免正文过短无法规划。";
  await page.goto("/compose?project=" + id);
  await cm(page).fill(markdown);
  await expect
    .poll(async () => (await stored(page, id)).markdown)
    .toBe(markdown);
  const master = await stored(page, id);
  const planned = await page.request.post(
    `/api/illustrations/projects/${id}/plan`,
    { data: { expectedMasterRevision: master.revision } }
  );
  expect(planned.ok()).toBeTruthy();
  expect((await planned.json()).shots.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "切换到配图阶段" }).click();
  await expect(page).toHaveURL(/stage=images/);
  await page.getByRole("button", { name: "切换到配图", exact: true }).click();
  const board = page.getByLabel("配图工作台视图");
  await expect(board.getByText("文章封面 · 待生成")).toBeVisible();
  // openPlanner：板内图位 → 配图助手（mobilePane 语义与 goStage 不同），
  // URL 阶段保持 stage=images
  await board.getByRole("button", { name: /文章封面 · 待生成/ }).click();
  await expect(page.getByLabel("文章配图助手")).toBeVisible();
  await expect(page).toHaveURL(/stage=images/);
});

test.fixme(
  "两个对话框（版本历史/主稿更新审阅）Esc 关闭 @bug:deviations#14",
  async () => {
    // 已知缺陷，登记于 docs/implementation/CREATOR-V2-DESIGN-DEVIATIONS.md
    // 「/compose 验收轮补充登记」偏差 #14：WritingWorkspace 的版本历史对话
    // 框、WritingMasterReview 的主稿更新审阅对话框均没有 Escape/onKeyDown
    // 处理，Esc 不会关闭，仅「关闭」按钮可关。（发布准备自阶段焦点视图改版
    // 起不再是对话框。）
    // 修复后应补：打开对话框 → page.keyboard.press("Escape") → 断言
    // getByRole("dialog", …) not visible。缺陷修复前任何此类断言都会失败，
    // 因此按规范以 fixme 保留该交互记录，不写会失败的断言。
  }
);

test.fixme(
  "左栏「选题简报与来源」details 展开显示简报与来源（缺真实 API 种子路径）",
  async () => {
    // details.writing-brief 只在 doc.brief 存在时渲染（WritingWorkspace.jsx:1443-1464）。
    // doc.brief 来自 editorial_projects.brief_id（src/writing.mjs:393-395），而 V2
    // 选题「开始写作」startTopic（src/creator.mjs:934-957）不写 brief_id；创建
    // brief 的唯一公开入口 POST /api/briefs（lib/api.mjs:93）需要 V1 研究管道
    // 产出的 event，隔离环境（ENABLE_SCENARIO=0、空库）拿不到 event。在本规范
    // 「种子数据只走真实 API」约束下没有可行种子路径。若后续 V2 选题把简报
    // 关联到 project 或提供种子 API，应补：展开 details → 断言简报标题与
    // 来源条目可见。
  }
);
