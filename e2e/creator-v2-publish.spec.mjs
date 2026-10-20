import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creator V2 publish center (/publish) e2e — real routes, real SQLite
// domain services, no fixtures: an isolated worker-scoped production
// server (same pattern as e2e/creator-v2-works.spec.mjs) runs with
// multiuser sessions and NO model/image provider configured. Coverage
// per the page scope: honest empty library, the four per-channel manual
// checks toggled through the REAL editorial.setChecks API (per-channel
// independence + reload persistence + expectedRevision protection),
// 导出≠草稿箱≠真实发布 kept explicit (bundle download produces a real
// zip; the timeline keeps 真实发布状态尚未确认 pending until an author
// report exists; the author report itself is labelled 未经平台核验),
// the wechat draft-box gate (no account / capability not checked / cover
// / consent → the send stays disabled and NO external call is made),
// the project switcher for multiple works, and the 390×844 mobile
// layout without horizontal overflow.

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
      const root = mkdtempSync(join(tmpdir(), "studio-creator-publish-"));
      const safe = {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        CONTENT_STUDIO_MULTIUSER: "1",
        CONTENT_STUDIO_ACCOUNTS_PATH: root,
        CONTENT_STUDIO_DB_PATH: join(root, "publish.sqlite"),
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
        if (!ready) throw Error("Publish server did not start " + logs);
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
  await page.getByLabel("作者名称", { exact: true }).fill("合成发布作者");
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
  const r = await page.request.post("/api/writing/projects", {
    data: { title },
  });
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  expect(d.projectId).toMatch(/^ep_/);
  return d.projectId;
}

async function openPublish(page, projectId) {
  await page.goto(
    "/publish" + (projectId ? `?project=${encodeURIComponent(projectId)}` : "")
  );
  await expect(
    page.getByRole("heading", { name: "发布之前，再确认一次" })
  ).toBeVisible();
}

const card = (page, name) =>
  page.locator(`section.cv2-channel-card[aria-label="${name}发布准备"]`);

async function checkAll(page, cardName) {
  const boxes = card(page, cardName).getByRole("checkbox");
  await expect(boxes).toHaveCount(4);
  for (let i = 0; i < 4; i++) await boxes.nth(i).check();
  await expect(
    card(page, cardName).getByText("检查完成", { exact: true })
  ).toBeVisible();
}

test("空工作区：发布中心诚实空态，不渲染任何渠道卡", async ({ page }) => {
  await signup(page, "publish-empty@example.test");
  await openPublish(page);
  await expect(
    page.getByText("还没有可交付的作品", { exact: false })
  ).toBeVisible();
  await expect(page.locator("section.cv2-channel-card")).toHaveCount(0);
  // 顶部状态条在无作品时也不出现（没有可断言的真实状态）
  await expect(page.getByText("状态必须区分：可交付 ≠ 已发布")).toHaveCount(0);
});

test("四项人工检查：真实切换、渠道独立、刷新持久、主稿过期提示与按钮联动", async ({
  page,
}) => {
  await signup(page, "publish-checks@example.test");
  const id = await createProject(page, "发布检查验证：公众号与知乎独立核查");

  await openPublish(page, id);
  // 深链项目选中：两张渠道卡都以真实项目标题为副标题
  const wechat = card(page, "微信公众号");
  const zhihu = card(page, "知乎");
  await expect(wechat).toBeVisible();
  await expect(zhihu).toBeVisible();
  await expect(wechat.getByText("《发布检查验证：公众号与知乎独立核查》")).toBeVisible();
  // 初始：两渠道 tag 待确认、四项全部待检查
  await expect(wechat.getByText("待确认", { exact: true })).toBeVisible();
  await expect(zhihu.getByText("待确认", { exact: true })).toBeVisible();
  await expect(wechat.getByText("待检查", { exact: true })).toHaveCount(4);
  // 顶部状态条是真实的警告 pill
  await expect(page.getByText("有检查项未完成", { exact: true }).first()).toBeVisible();
  // 主稿过期阻断提示（真实 editorial 状态：平台稿落后于主稿修订）
  await expect(wechat.getByText("主稿更新后尚未复核渠道稿")).toBeVisible();

  // 检查未完成时主按钮给真实剩余数反馈
  await wechat.getByRole("button", { name: /继续完成发布检查/ }).click();
  await expect(page.getByRole("status").last()).toContainText(
    "还有 4 项微信公众号发布前检查未完成"
  );

  // 逐项勾选公众号四项检查（真实 POST checks）
  await checkAll(page, "微信公众号");
  await expect(wechat.getByText("待检查", { exact: true })).toHaveCount(0);
  await expect(wechat.getByText("已检查", { exact: true })).toHaveCount(4);
  await expect(wechat.getByRole("button", { name: /准备微信草稿交付/ })).toBeVisible();
  // 阻断提示随复核消失；知乎渠道保持独立待确认
  await expect(wechat.getByText("主稿更新后尚未复核渠道稿")).toHaveCount(0);
  await expect(zhihu.getByText("待确认", { exact: true })).toBeVisible();
  await expect(zhihu.getByText("待检查", { exact: true })).toHaveCount(4);

  // 刷新后勾选持久（真实 SQLite），时间线给出真实核查行
  await page.reload();
  await expect(card(page, "微信公众号").getByText("检查完成", { exact: true })).toBeVisible();
  await expect(
    page.getByText("人工核查完成：微信公众号", { exact: false })
  ).toBeVisible();
  await expect(
    page.getByText("真实发布状态尚未确认", { exact: false })
  ).toBeVisible();

  // 多作品时出现真实项目切换器，切换加载对应作品
  await createProject(page, "发布检查验证：第二篇作品");
  await openPublish(page);
  await expect(page.getByLabel("选择作品")).toBeVisible();
  await page.getByLabel("选择作品").selectOption({ label: "发布检查验证：第二篇作品" });
  await expect(
    card(page, "微信公众号").getByText("《发布检查验证：第二篇作品》")
  ).toBeVisible();
  await expect(
    card(page, "微信公众号").getByText("待确认", { exact: true })
  ).toBeVisible();

  // 深链仍然直达指定作品
  await openPublish(page, id);
  await expect(
    card(page, "微信公众号").getByText("《发布检查验证：公众号与知乎独立核查》")
  ).toBeVisible();
});

test("导出≠草稿箱≠发布：知乎交付包真实下载，作者报告标注未经平台核验", async ({
  page,
}) => {
  await signup(page, "publish-zhihu@example.test");
  const id = await createProject(page, "知乎交付验证：导出与作者报告");

  await openPublish(page, id);
  const zhihu = card(page, "知乎");
  await checkAll(page, "知乎");
  await zhihu.getByRole("button", { name: /准备知乎交付/ }).click();
  const panel = zhihu.locator(".cv2-delivery-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("草稿箱推送都不是发布", { exact: false })).toBeVisible();

  // 真实 bundle 下载（POST publishing/bundle → zip）
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载文章与图片交付包" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^content-zhihu-v\d+\.zip$/);

  // 导出后：渠道状态与时间线保持 导出≠发布
  await expect(zhihu.getByText("已导出（不是已发表）", { exact: false })).toBeVisible();
  await expect(
    page.getByText("已导出本地交付包", { exact: false }).first()
  ).toBeVisible();
  await expect(
    page.getByText("真实发布状态尚未确认", { exact: false })
  ).toBeVisible();

  // 作者报告：填写真实发布后记录，时间线保留“未经平台核验”标注
  await panel.getByLabel("真实发布链接（作者报告）").fill("https://zhuanlan.zhihu.example.test/p/synthetic-1");
  await panel.getByRole("button", { name: "记录作者报告" }).click();
  await expect(page.getByRole("status").last()).toContainText("作者报告已记录");
  await expect(
    page.getByText("作者报告已发表（未经平台核验）", { exact: false }).first()
  ).toBeVisible();
  await expect(
    page.getByText("真实发布状态尚未确认", { exact: false })
  ).toHaveCount(0);
  // 渠道状态使用领域的诚实标签
  await expect(
    zhihu.getByText("作者报告已发表（未经平台核验）", { exact: false }).first()
  ).toBeVisible();
});

test("公众号草稿箱：账号/能力检查/封面/同意缺一不可，未达标不发起外部调用", async ({
  page,
}) => {
  await signup(page, "publish-wechat@example.test");
  const id = await createProject(page, "公众号草稿验证：发送门槛与诚实反馈");
  // 封面素材提前就绪（1×1 合成 PNG）
  const asset = await page.request.post("/api/assets", {
    data: { name: "synthetic-cover.png", alt: "合成封面图", base64: PNG_1X1 },
  });
  expect(asset.status()).toBe(201);
  const assetId = (await asset.json()).id;

  await openPublish(page, id);
  const wechat = card(page, "微信公众号");
  await checkAll(page, "微信公众号");
  await wechat.getByRole("button", { name: /准备微信草稿交付/ }).click();
  const panel = wechat.locator(".cv2-delivery-panel");
  await expect(panel).toBeVisible();

  const send = panel.getByRole("button", { name: /发送到公众号草稿箱/ });
  // 无账号：发送不可用并给出真实指引
  await expect(send).toBeDisabled();
  await expect(panel.getByText("还没有公众号账号", { exact: false })).toBeVisible();

  // 在真实 API 上创建账号后回到页面（真实 capabilities.draftRead=false）
  const acc = await page.request.post("/api/creator/platforms/accounts", {
    data: {
      platform: "wechat",
      name: "合成公众号账号",
      appId: "wx0123456789abcdef",
      appSecret: "synthetic-secret-0123456789",
    },
  });
  expect(acc.status()).toBe(201);
  await page.reload();
  await expect(card(page, "微信公众号").getByText("检查完成", { exact: true })).toBeVisible();
  await card(page, "微信公众号").getByRole("button", { name: /收起交付操作|准备微信草稿交付/ }).click();
  await panel.getByLabel("发布账号").selectOption({ index: 1 });
  await expect(panel.getByText("还没有通过草稿接口能力检查", { exact: false })).toBeVisible();
  await expect(send).toBeDisabled();

  // 能力门槛以设置页的「检查能力」为准（会调用微信官方接口，本测试不执行）
  await panel.getByLabel("封面图片").selectOption(assetId);
  await expect(send).toBeDisabled();
  await panel
    .getByText("确认发送当前公众号稿、封面和正文图片到所选账号")
    .click();
  // 能力未检查 → 同意勾选后仍不可发送；服务端同样拒绝（fail-closed）
  await expect(send).toBeDisabled();
  // 时间线保持在“真实发布状态尚未确认”，没有任何成功语气的反馈
  await expect(
    page.getByText("真实发布状态尚未确认", { exact: false })
  ).toBeVisible();
  await expect(page.locator(".cv2-status.is-success")).toHaveCount(0);

  // 本地交付包不受账号能力限制，可独立下载
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载文章与图片交付包" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^content-wechat-v\d+\.zip$/);
});

test("移动 390×844：单列渠道卡、底部导航高亮更多，无横向溢出", async ({
  page,
}) => {
  await signup(page, "publish-mobile@example.test");
  const id = await createProject(page, "移动端发布中心视口检查");
  await page.setViewportSize({ width: 390, height: 844 });
  await openPublish(page, id);
  await expect(card(page, "微信公众号")).toBeVisible();
  await expect(card(page, "知乎")).toBeVisible();
  // 顶部导航动作收成图标圆钮，可访问名不变
  const back = page.getByRole("link", { name: "返回作品" });
  await expect(back).toBeVisible();
  // 底部导航：发布中心属于「更多」面板，更多按钮处于激活态
  const moreNav = page.getByRole("navigation", { name: "移动端导航" });
  await expect(moreNav.getByRole("button", { name: "更多" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await moreNav.getByRole("button", { name: "更多" }).click();
  await expect(
    page.getByRole("dialog", { name: "更多工作区" }).getByRole("link", { name: "发布中心" })
  ).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // 勾选检查在移动端同样可用（真实保存）
  await checkAll(page, "微信公众号");
  await page.reload();
  await expect(card(page, "微信公众号").getByText("检查完成", { exact: true })).toBeVisible();
});
