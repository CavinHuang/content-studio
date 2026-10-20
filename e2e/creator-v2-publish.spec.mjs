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
//
// Extended interaction coverage (same rules): preview channel tab
// switching over REAL channel markdown, the reconcile form on an
// outcome_unknown delivery operation, the real send-click rejection
// path (server stays fail-closed; real WeChat round-trips stay out of
// scope), the 409 optimistic-rollback path, the load-failure error
// state + retry, delivery panel collapse, every cross-page entry
// (/works ×3, /compose deep links, /settings hints), desktop sidebar /
// topbar and mobile bottom-bar / more-panel navigation, the mobile
// Esc-close visible result (focus return stays test.fixme — registered
// defect), and keyboard access (skip link, checkbox Space, button
// Enter).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function listen(server) {
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
}

const test = base.extend({
  // Worker-scoped environment: the isolated origin plus its SQLite path.
  // dbPath is only consumed by the reconcile coverage, which must
  // reproduce the server's own interrupted-send recovery state once.
  creatorEnv: [
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
        await use({
          origin,
          dbPath: join(root, "publish.sqlite"),
          accountsPath: root, // 多用户工作区 SQLite 位于 accountsPath/workspaces/<ws>/studio.sqlite
        });
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
  creatorOrigin: async ({ creatorEnv }, use) => use(creatorEnv.origin),
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

// ---- 补齐的交互用例（审计缺口） ------------------------------------

test("发布效果预览：公众号/知乎分段切换加载对应渠道真实 Markdown（桌面）", async ({
  page,
}) => {
  await signup(page, "publish-preview@example.test");
  const title = "预览切换验证：公众号与知乎本地排版";
  const id = await createProject(page, title);
  await openPublish(page, id);
  const phone = page.locator(".cv2-preview-phone");
  const tabs = page.getByRole("group", { name: "预览渠道" });
  const wechatTab = tabs.getByRole("button", { name: "公众号", exact: true });
  const zhihuTab = tabs.getByRole("button", { name: "知乎", exact: true });
  // 初始：公众号分段激活；渠道稿还没有正文 → 诚实空态示意
  await expect(wechatTab).toHaveAttribute("aria-pressed", "true");
  await expect(zhihuTab).toHaveAttribute("aria-pressed", "false");
  await expect(
    phone.getByText("渠道稿还没有正文；完成写作后这里显示当前稿的本地排版示意。")
  ).toBeVisible();

  // 真实写作 API 写入两渠道各自不同的 Markdown
  const wechatDoc = await (
    await page.request.get(`/api/writing/projects/${id}/wechat`)
  ).json();
  const zhihuDoc = await (
    await page.request.get(`/api/writing/projects/${id}/zhihu`)
  ).json();
  const put = (channel, doc, markdown) =>
    page.request.put(`/api/writing/projects/${id}/${channel}`, {
      data: {
        expectedRevision: doc.revision,
        markdown,
        sourceMasterRevision: doc.masterRevision,
      },
    });
  expect(
    (
      await put(
        "wechat",
        wechatDoc,
        `# ${title}\n\n公众号稿开篇：城市夜班公交的观察笔记。\n\n> 引用：公众号稿独有的引文块\n\n- 公众号要点一\n- 公众号要点二\n`
      )
    ).ok()
  ).toBeTruthy();
  expect(
    (
      await put(
        "zhihu",
        zhihuDoc,
        `# ${title}\n\n知乎稿开篇：同一主题的知乎版本。\n\n> 引用：知乎稿独有的引文块\n`
      )
    ).ok()
  ).toBeTruthy();

  await page.reload();
  // 公众号分段：真实 Markdown 的本地排版示意（首个同名标题去重，只出现一次）
  await expect(phone.getByText("微信公众号 · 移动端 · 本地排版示意")).toBeVisible();
  await expect(phone.locator("h5")).toHaveCount(0);
  await expect(phone.getByText("公众号稿开篇：城市夜班公交的观察笔记。")).toBeVisible();
  await expect(phone.getByText("引用：公众号稿独有的引文块")).toBeVisible();
  await expect(phone.locator("p.cv2-preview-li", { hasText: "公众号要点一" })).toHaveCount(1);
  await expect(
    page.getByText("正文为当前公众号稿的本地排版示意", { exact: false })
  ).toBeVisible();

  // 点击知乎分段：aria-pressed 真实翻转，手机壳切换为知乎稿内容
  await zhihuTab.click();
  await expect(zhihuTab).toHaveAttribute("aria-pressed", "true");
  await expect(wechatTab).toHaveAttribute("aria-pressed", "false");
  await expect(phone.getByText("知乎 · 移动端 · 本地排版示意")).toBeVisible();
  await expect(phone.getByText("知乎稿开篇：同一主题的知乎版本。")).toBeVisible();
  await expect(phone.getByText("公众号稿开篇：城市夜班公交的观察笔记。")).toHaveCount(0);
  await expect(
    page.getByText("正文为当前知乎稿的本地排版示意", { exact: false })
  ).toBeVisible();
});

test("发布效果预览：公众号/知乎分段切换（移动 390×844）", async ({ page }) => {
  await signup(page, "publish-preview-mobile@example.test");
  const title = "移动端预览切换验证：双渠道排版示意";
  const id = await createProject(page, title);
  const wechatDoc = await (
    await page.request.get(`/api/writing/projects/${id}/wechat`)
  ).json();
  const zhihuDoc = await (
    await page.request.get(`/api/writing/projects/${id}/zhihu`)
  ).json();
  const put = (channel, doc, markdown) =>
    page.request.put(`/api/writing/projects/${id}/${channel}`, {
      data: {
        expectedRevision: doc.revision,
        markdown,
        sourceMasterRevision: doc.masterRevision,
      },
    });
  expect(
    (await put("wechat", wechatDoc, `# ${title}\n\n公众号稿移动段落：第一段。\n`)).ok()
  ).toBeTruthy();
  expect(
    (await put("zhihu", zhihuDoc, `# ${title}\n\n知乎稿移动段落：第一段。\n`)).ok()
  ).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await openPublish(page, id);
  const phone = page.locator(".cv2-preview-phone");
  const tabs = page.getByRole("group", { name: "预览渠道" });
  await expect(phone.getByText("公众号稿移动段落：第一段。")).toBeVisible();
  await tabs.getByRole("button", { name: "知乎", exact: true }).click();
  await expect(tabs.getByRole("button", { name: "知乎", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(phone.getByText("知乎稿移动段落：第一段。")).toBeVisible();
  await expect(phone.getByText("公众号稿移动段落：第一段。")).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("交付时间线：待核实发送 → 记录在平台核对的结果（条件字段/8字校验/取消/保存/刷新持久）", async ({
  page,
  creatorEnv,
}) => {
  await signup(page, "publish-reconcile@example.test");
  const title = "核对流程验证：一次待核实的草稿发送";
  const id = await createProject(page, title);
  // 账号走真实 API（操作行引用真实账号 id）
  const acc = await page.request.post("/api/creator/platforms/accounts", {
    data: {
      platform: "wechat",
      name: "核对验证公众号",
      appId: "wx0123456789abcdef",
      appSecret: "synthetic-secret-0123456789",
    },
  });
  expect(acc.status()).toBe(201);
  const accountId = (await acc.json()).id;

  // outcome_unknown 只能来自一次真实外发的中断：PublishingService 构造器把
  // sending 恢复为 outcome_unknown（src/publishing.mjs:88-92），而没有任何
  // API 能主动制造该状态（fail-closed）。这里以该隔离 SQLite 一次性复现
  // 「服务端自身恢复后」的操作行；随后的渲染、表单、校验、保存全部走真实
  // API 与真实服务端校验，不伪造任何成功回执。
  // 多用户模式下发布账号与操作行都在作者工作区 SQLite（author-accounts.mjs
  // workspace()），不在全局 CONTENT_STUDIO_DB_PATH。
  const me = await (await page.request.get("/api/accounts/me")).json();
  const workspaceDb = join(
    creatorEnv.accountsPath,
    "workspaces",
    me.author.workspaceId,
    "studio.sqlite"
  );
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(workspaceDb);
  db.exec("PRAGMA busy_timeout=4000");
  db.prepare(
    "INSERT INTO publishing_operations VALUES(?,?,?,?,?,?,?,'outcome_unknown','Process interrupted; reconcile before retrying',?,?)"
  ).run(
    "po_reconcilee2e0001",
    "idem-reconcile-e2e-0001",
    id,
    "wechat",
    accountId,
    1,
    JSON.stringify({ title, markdown: "", masterRevision: 1, coverAssetId: "" }),
    new Date().toISOString(),
    new Date().toISOString()
  );
  db.close();

  await openPublish(page, id);
  const row = page.locator(".cv2-log-row", { hasText: "发送结果待核实" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "记录在平台核对的结果" }).click();
  const form = row.locator(".cv2-reconcile");
  await expect(form).toBeVisible();
  // 默认 outcome=saved → 平台草稿标识字段出现；依据不足 → 保存禁用
  await expect(form.getByLabel("平台核对结果")).toHaveValue("saved");
  await expect(form.getByLabel("平台草稿标识")).toBeVisible();
  const save = form.getByRole("button", { name: "保存作者核对结果" });
  await expect(save).toBeDisabled();
  await form.getByLabel("核对依据（至少 8 字）").fill("只有五个字");
  await expect(save).toBeDisabled();
  // 切到「未保存草稿」：草稿标识字段消失；依据补足后保存可用
  await form.getByLabel("平台核对结果").selectOption({ label: "未保存草稿" });
  await expect(form.getByLabel("平台草稿标识")).toHaveCount(0);
  await form
    .getByLabel("核对依据（至少 8 字）")
    .fill("在公众号后台确认没有这条草稿，未保存。");
  await expect(save).toBeEnabled();
  // 取消：表单关闭，入口按钮回到该行
  await form.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".cv2-reconcile")).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "记录在平台核对的结果" })
  ).toBeVisible();

  // 重新打开并真实保存「草稿已保存」结果（POST reconcile → 服务端校验 + 落库）
  await row.getByRole("button", { name: "记录在平台核对的结果" }).click();
  const form2 = row.locator(".cv2-reconcile");
  await form2.getByLabel("平台草稿标识").fill("synthetic_media_id_e2e_1");
  await form2
    .getByLabel("核对依据（至少 8 字）")
    .fill("在公众号后台草稿箱看到该草稿并核对了标识。");
  await form2.getByRole("button", { name: "保存作者核对结果" }).click();
  await expect(page.getByRole("status").last()).toContainText(
    "核对结果已记录到交付时间线"
  );
  // 待核实行消失；时间线出现作者核对的草稿事实（仍标注不是发布）
  await expect(page.getByText("发送结果待核实")).toHaveCount(0);
  await expect(
    page.getByText("公众号草稿已保存", { exact: false }).first()
  ).toBeVisible();
  await expect(
    page.getByText("草稿标识 synthetic_media_id_e2e_1", { exact: false }).first()
  ).toBeVisible();
  await expect(
    page.getByText("草稿保存不是发布", { exact: false }).first()
  ).toBeVisible();
  // 刷新后核对结果仍在（真实 SQLite 持久化）
  await page.reload();
  await expect(
    page.getByText("草稿标识 synthetic_media_id_e2e_1", { exact: false }).first()
  ).toBeVisible();
  await expect(page.getByText("发送结果待核实")).toHaveCount(0);
});

test("发送到公众号草稿箱：真实点击被服务端 fail-closed 拒绝并如实反馈（外部微信发送结构性不可测）", async ({
  page,
}) => {
  await signup(page, "publish-send@example.test");
  const id = await createProject(page, "发送验证：能力门槛的服务端兜底");
  const asset = await page.request.post("/api/assets", {
    data: { name: "send-cover.png", alt: "发送验证封面", base64: PNG_1X1 },
  });
  expect(asset.status()).toBe(201);
  const assetId = (await asset.json()).id;
  const acc = await page.request.post("/api/creator/platforms/accounts", {
    data: {
      platform: "wechat",
      name: "发送验证公众号",
      appId: "wx0123456789abcdef",
      appSecret: "synthetic-secret-0123456789",
    },
  });
  expect(acc.status()).toBe(201);
  const accountId = (await acc.json()).id;

  await openPublish(page, id);
  await checkAll(page, "微信公众号");
  const detail = await (
    await page.request.get(`/api/editor/projects/${id}`)
  ).json();
  const revision = detail.channels.wechat.document.revision;

  // 服务端 fail-closed 契约（纯真实 API，无任何 mock，零外部调用）：
  // 未确认外发 → 403；确认外发但能力未检查 → 409；都不产生发送记录。
  const noConsent = await page.request.post(
    `/api/creator/projects/${id}/publishing/draft`,
    {
      data: {
        expectedRevision: revision,
        accountId,
        coverAssetId: assetId,
        idempotencyKey: "e2e-send-noconsent-01",
        allowExternalCall: false,
      },
    }
  );
  expect(noConsent.status()).toBe(403);
  expect((await noConsent.json()).error).toContain("请确认");
  const noCapability = await page.request.post(
    `/api/creator/projects/${id}/publishing/draft`,
    {
      data: {
        expectedRevision: revision,
        accountId,
        coverAssetId: assetId,
        idempotencyKey: "e2e-send-nocap-0001",
        allowExternalCall: true,
      },
    }
  );
  expect(noCapability.status()).toBe(409);
  expect((await noCapability.json()).error).toBe("请先检查公众号草稿接口能力");

  // UI 点击路径：draftRead 能力只能经设置页「检查能力」获得，而那会真实调用
  // 微信官方接口（e2e 结构性不可执行，与既有门槛用例的 :319 注释一致）。这里
  // 仅在浏览器网络层把该账号呈现为已通过能力检查（模拟外部检查的产物），
  // 发送请求仍打到真实服务端并被再次拒绝——成功回执 / outcome_unknown 分支
  // 必须依赖真实微信回执，本测试绝不伪造。
  await page.route("**/api/creator/platforms", async (route) => {
    const resp = await route.fetch();
    const data = await resp.json();
    for (const a of data.accounts || [])
      if (a.id === accountId)
        a.capabilities = { ...a.capabilities, draftRead: true };
    await route.fulfill({
      status: resp.status(),
      contentType:
        resp.headers()["content-type"] || "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.reload();
  await expect(
    card(page, "微信公众号").getByText("检查完成", { exact: true })
  ).toBeVisible();
  await card(page, "微信公众号").getByRole("button", { name: /准备微信草稿交付/ }).click();
  const panel = card(page, "微信公众号").locator(".cv2-delivery-panel");
  const send = panel.getByRole("button", { name: /发送到公众号草稿箱/ });
  await panel.getByLabel("发布账号").selectOption(accountId);
  await panel.getByLabel("封面图片").selectOption(assetId);
  await panel
    .getByText("确认发送当前公众号稿、封面和正文图片到所选账号")
    .click();
  await expect(send).toBeEnabled();
  await send.click();
  // 真实服务端 409 → 诚实错误反馈；没有任何成功语气的状态与草稿事实
  await expect(page.getByRole("status").last()).toContainText(
    "请先检查公众号草稿接口能力"
  );
  await expect(page.locator(".cv2-status.is-success")).toHaveCount(0);
  await expect(page.getByText("真实发布状态尚未确认", { exact: false })).toBeVisible();
  await expect(page.getByText("公众号草稿已保存", { exact: false })).toHaveCount(0);
  await expect(send).toBeEnabled(); // busy 结束，发送在途提示消失
  await page.unroute("**/api/creator/platforms");
});

test("四项检查遇 409 冲突：乐观勾选回滚、错误提示、自动重取详情后可恢复勾选（桌面）", async ({
  page,
}) => {
  await signup(page, "publish-conflict@example.test");
  const id = await createProject(page, "冲突回滚验证：主修订在页面外前进");
  await openPublish(page, id);
  const wechat = card(page, "微信公众号");
  await expect(wechat).toBeVisible();

  // 页面外（真实写作 API）把公众号稿修订推进一格 → 页面内保存的 expectedRevision 过期
  const doc = await (
    await page.request.get(`/api/writing/projects/${id}/wechat`)
  ).json();
  const bump = await page.request.put(`/api/writing/projects/${id}/wechat`, {
    data: {
      expectedRevision: doc.revision,
      markdown: "# 冲突回滚验证：主修订在页面外前进\n\n页面外推进的新修订段落。\n",
    },
  });
  expect(bump.ok()).toBeTruthy();

  // 点击勾选 → 乐观置亮 → 服务端 409 → 回滚 + 错误提示 + 自动重取详情
  await wechat.getByRole("checkbox").first().click();
  await expect(page.getByRole("status").last()).toContainText(
    "Channel changed; reload before confirming"
  );
  await expect(wechat.getByText("待检查", { exact: true })).toHaveCount(4);
  // 自动重取后时间线反映新修订（公众号稿 v2）
  await expect(page.getByText("公众号稿 v2", { exact: false }).first()).toBeVisible();

  // 重取后 expectedRevision 已是最新：再次勾选真实成功
  await wechat.getByRole("checkbox").first().click();
  await expect(
    wechat.locator(".cv2-check-item").first().getByText("已检查", { exact: true })
  ).toBeVisible();
  await expect(wechat.getByText("待检查", { exact: true })).toHaveCount(3);
});

test("加载失败错误态：「发布中心加载失败」+「重试」真实恢复（桌面）", async ({
  page,
}) => {
  await signup(page, "publish-loadfail@example.test");
  const title = "加载失败验证：项目清单请求中断";
  await createProject(page, title);
  await page.route("**/api/editor/projects", (route) => route.abort());
  await page.goto("/publish");
  const errorState = page.locator(".cv2-error-state");
  await expect(errorState).toBeVisible();
  await expect(errorState).toContainText("发布中心加载失败");
  await expect(errorState).toContainText("检查本地服务是否在运行，然后重试。");
  // 错误态下不渲染渠道卡与状态条
  await expect(page.locator("section.cv2-channel-card")).toHaveCount(0);
  await expect(page.getByText("状态必须区分：可交付 ≠ 已发布")).toHaveCount(0);

  // 恢复后点「重试」→ 真实重新拉取并进入工作区
  await page.unroute("**/api/editor/projects");
  await errorState.getByRole("button", { name: "重试" }).click();
  await expect(page.locator(".cv2-error-state")).toHaveCount(0);
  await expect(
    card(page, "微信公众号").getByText(`《${title}》`)
  ).toBeVisible();
});

test("加载失败错误态：「发布中心加载失败」+「重试」真实恢复（移动 390×844）", async ({
  page,
}) => {
  await signup(page, "publish-loadfail-mobile@example.test");
  const title = "移动端加载失败验证：请求中断后重试";
  await createProject(page, title);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/editor/projects", (route) => route.abort());
  await page.goto("/publish");
  // getByRole("alert") 会同时命中 Next 的 __next-route-announcer__，需限定错误卡本身
  const errorState = page.locator(".cv2-error-state");
  await expect(errorState).toContainText("发布中心加载失败");
  await page.unroute("**/api/editor/projects");
  await errorState.getByRole("button", { name: "重试" }).click();
  await expect(page.locator(".cv2-error-state")).toHaveCount(0);
  await expect(
    card(page, "微信公众号").getByText(`《${title}》`)
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("交付面板收起：展开后再次点击主按钮真实收起，并可再次展开", async ({
  page,
}) => {
  await signup(page, "publish-collapse@example.test");
  await createProject(page, "收起验证：交付面板双向切换");
  await openPublish(page);
  const wechat = card(page, "微信公众号");
  await checkAll(page, "微信公众号");
  await wechat.getByRole("button", { name: /准备微信草稿交付/ }).click();
  const panel = wechat.locator(".cv2-delivery-panel");
  await expect(panel).toBeVisible();
  // 展开态主按钮文案为「收起交付操作」
  await expect(wechat.getByRole("button", { name: /收起交付操作/ })).toBeVisible();
  // 再次点击 → 面板真实消失，按钮回到展开文案
  await wechat.getByRole("button", { name: /收起交付操作/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(wechat.getByRole("button", { name: /准备微信草稿交付/ })).toBeVisible();
  await expect(wechat.getByRole("button", { name: /收起交付操作/ })).toHaveCount(0);
  // 可再次展开，真实勾选状态不因收起丢失
  await wechat.getByRole("button", { name: /准备微信草稿交付/ }).click();
  await expect(panel).toBeVisible();
  await expect(wechat.getByText("检查完成", { exact: true })).toBeVisible();
});

test("跨页导航 → /works：空态「去作品库」、状态条「查看关联作品」、页头「返回作品」真实跳转", async ({
  page,
}) => {
  await signup(page, "publish-workslink@example.test");
  // 空态入口
  await openPublish(page);
  await page.getByRole("link", { name: "去作品库" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await expect(
    page.getByRole("heading", { name: "每篇作品，都有清晰的下一步" })
  ).toBeVisible();

  // 有作品后的两个入口
  const title = "跨页链接验证：返回作品与查看关联作品";
  await createProject(page, title);
  await openPublish(page);
  await page.getByRole("link", { name: "查看关联作品" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await expect(page.locator("a.cv2-work-card", { hasText: title })).toBeVisible();

  await openPublish(page);
  await page.getByRole("link", { name: "返回作品" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await expect(page.locator("a.cv2-work-card", { hasText: title })).toBeVisible();
});

test("渠道卡「编辑渠道稿」：点击进入 /compose 渠道深链（桌面）", async ({
  page,
}) => {
  await signup(page, "publish-editlink@example.test");
  const id = await createProject(page, "编辑入口验证：渠道卡跳转创作空间");
  await openPublish(page, id);
  await card(page, "微信公众号").getByRole("link", { name: "编辑公众号稿" }).click();
  await expect(page).toHaveURL(
    `/compose?project=${encodeURIComponent(id)}&channel=wechat`
  );
  await openPublish(page, id);
  await card(page, "知乎").getByRole("link", { name: "编辑知乎稿" }).click();
  await expect(page).toHaveURL(
    `/compose?project=${encodeURIComponent(id)}&channel=zhihu`
  );
});

test("渠道卡「编辑渠道稿」：点击进入 /compose 渠道深链（移动 390×844）", async ({
  page,
}) => {
  await signup(page, "publish-editlink-mobile@example.test");
  const id = await createProject(page, "移动端编辑入口验证：渠道卡跳转");
  await page.setViewportSize({ width: 390, height: 844 });
  await openPublish(page, id);
  await card(page, "微信公众号").getByRole("link", { name: "编辑公众号稿" }).click();
  await expect(page).toHaveURL(
    `/compose?project=${encodeURIComponent(id)}&channel=wechat`
  );
  await openPublish(page, id);
  await card(page, "知乎").getByRole("link", { name: "编辑知乎稿" }).click();
  await expect(page).toHaveURL(
    `/compose?project=${encodeURIComponent(id)}&channel=zhihu`
  );
});

test("交付面板「偏好与连接」链接：无账号与能力未检查两处提示均可进入 /settings", async ({
  page,
}) => {
  await signup(page, "publish-settings@example.test");
  const id = await createProject(page, "偏好连接入口验证：面板提示跳转设置");
  await openPublish(page, id);
  await checkAll(page, "微信公众号");
  await card(page, "微信公众号").getByRole("button", { name: /准备微信草稿交付/ }).click();
  const panel = card(page, "微信公众号").locator(".cv2-delivery-panel");

  // 提示一：还没有公众号账号
  await expect(panel.getByText("还没有公众号账号", { exact: false })).toBeVisible();
  await panel.getByRole("link", { name: "偏好与连接" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("navigation", { name: "面包屑" })).toContainText(
    "偏好与连接"
  );

  // 提示二：账号存在但能力未检查
  const acc = await page.request.post("/api/creator/platforms/accounts", {
    data: {
      platform: "wechat",
      name: "设置入口验证账号",
      appId: "wx0123456789abcdef",
      appSecret: "synthetic-secret-0123456789",
    },
  });
  expect(acc.status()).toBe(201);
  await openPublish(page, id);
  await card(page, "微信公众号").getByRole("button", { name: /准备微信草稿交付/ }).click();
  const panel2 = card(page, "微信公众号").locator(".cv2-delivery-panel");
  await panel2.getByLabel("发布账号").selectOption({ index: 1 });
  await expect(
    panel2.getByText("还没有通过草稿接口能力检查", { exact: false })
  ).toBeVisible();
  await panel2.getByRole("link", { name: "偏好与连接" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("移动「更多」面板：Esc 关闭的可见结果——面板消失且 aria-expanded 翻转（移动 390×844）", async ({
  page,
}) => {
  await signup(page, "publish-esc@example.test");
  await createProject(page, "更多面板验证：Esc 关闭可见结果");
  await page.setViewportSize({ width: 390, height: 844 });
  await openPublish(page);
  const nav = page.getByRole("navigation", { name: "移动端导航" });
  const moreBtn = nav.getByRole("button", { name: "更多" });
  await moreBtn.click();
  const dialog = page.getByRole("dialog", { name: "更多工作区" });
  await expect(dialog).toBeVisible();
  await expect(moreBtn).toHaveAttribute("aria-expanded", "true");
  // Esc：面板真实关闭，aria-expanded 翻转回 false
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(moreBtn).toHaveAttribute("aria-expanded", "false");
});

test.fixme(
  "移动「更多」面板 Esc 关闭后焦点应返还「更多」触发按钮 @bug:deviations#5",
  async ({ page }) => {
    // 缺陷登记：docs/implementation/CREATOR-V2-DESIGN-DEVIATIONS.md 全局壳层 #5 —
    // CreatorShell.jsx:128-136 的 Esc 路径只 setMoreOpen(false)，没有
    // moreButtonRef.current?.focus()（面板头部关闭按钮路径可正确还焦），
    // Esc 关闭后焦点落在 BODY。修复后本用例应转正。
    await signup(page, "publish-esc-focus@example.test");
    await createProject(page, "更多面板验证：Esc 后焦点返还");
    await page.setViewportSize({ width: 390, height: 844 });
    await openPublish(page);
    const moreBtn = page
      .getByRole("navigation", { name: "移动端导航" })
      .getByRole("button", { name: "更多" });
    await moreBtn.click();
    await expect(page.getByRole("dialog", { name: "更多工作区" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "更多工作区" })).toHaveCount(0);
    // 当前实现此处失败（焦点在 BODY）；这是登记的缺陷而非用例错误
    await expect(moreBtn).toBeFocused();
  }
);

test("导航跳转：从 /publish 点击桌面侧栏工作区与顶栏「看热点/新建作品」", async ({
  page,
}) => {
  await signup(page, "publish-nav@example.test");
  const id = await createProject(page, "导航跳转验证：发布中心作为起点");
  await openPublish(page, id);
  // 侧栏「创作导航」：作品
  await page
    .getByRole("navigation", { name: "创作导航" })
    .getByRole("link", { name: "作品" })
    .click();
  await expect(page).toHaveURL(/\/works$/);
  await expect(
    page.getByRole("navigation", { name: "创作导航" }).getByRole("link", { name: "作品" })
  ).toHaveAttribute("aria-current", "page");
  // 侧栏「创作导航」：热点雷达
  await openPublish(page, id);
  await page
    .getByRole("navigation", { name: "创作导航" })
    .getByRole("link", { name: "热点雷达" })
    .click();
  await expect(page).toHaveURL(/\/hotspots$/);
  // 顶栏动作
  await openPublish(page, id);
  await page.getByRole("link", { name: "看热点" }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await openPublish(page, id);
  await page.getByRole("link", { name: "新建作品" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("navigation", { name: "面包屑" })).toContainText(
    "新建作品"
  );
});

test("导航跳转：从 /publish 点击移动底栏 5 个快捷 tab 与更多面板入口（移动 390×844）", async ({
  page,
}) => {
  await signup(page, "publish-nav-mobile@example.test");
  const id = await createProject(page, "移动导航跳转验证：底栏快捷入口");
  await page.setViewportSize({ width: 390, height: 844 });
  await openPublish(page, id);
  const bottom = page.getByRole("navigation", { name: "移动端导航" });
  // 五个快捷 tab 逐一真实跳转
  await bottom.getByRole("link", { name: "热点" }).click();
  await expect(page).toHaveURL(/\/hotspots$/);
  await openPublish(page, id);
  await bottom.getByRole("link", { name: "选题" }).click();
  await expect(page).toHaveURL(/\/topics$/);
  await openPublish(page, id);
  await bottom.getByRole("link", { name: "作品" }).click();
  await expect(page).toHaveURL(/\/works$/);
  await openPublish(page, id);
  await bottom.getByRole("link", { name: "配图" }).click();
  await expect(page).toHaveURL(/\/illustrations$/);
  await openPublish(page, id);
  await bottom.getByRole("link", { name: "工作台" }).click();
  await expect(page).toHaveURL(/\/$/);
  // 更多面板入口也能真实跳走，且导航后面板自动关闭
  await openPublish(page, id);
  await bottom.getByRole("button", { name: "更多" }).click();
  const dialog = page.getByRole("dialog", { name: "更多工作区" });
  await dialog.getByRole("link", { name: "内容日历" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(dialog).toHaveCount(0);
});

test("键盘可达：skip link 跳主内容、Tab 至渠道检查复选框空格切换、Enter 激活按钮", async ({
  page,
}) => {
  await signup(page, "publish-kbd@example.test");
  await createProject(page, "键盘可达验证：跳转链接与检查复选框");
  await openPublish(page);
  // 第一个 Tab 停在 skip link，Enter 跳到主内容
  await page.keyboard.press("Tab");
  await expect(page.locator("a.cv2-skip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cv2-main")).toBeFocused();
  // Tab 顺序：页头「返回作品」→ 状态条「查看关联作品」→ 第一个检查复选框
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "返回作品" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "查看关联作品" })).toBeFocused();
  await page.keyboard.press("Tab");
  const wechat = card(page, "微信公众号");
  const firstBox = wechat.getByRole("checkbox").first();
  await expect(firstBox).toBeFocused();
  // 空格切换 → 真实保存
  await page.keyboard.press("Space");
  await expect(
    wechat.locator(".cv2-check-item").first().getByText("已检查", { exact: true })
  ).toBeVisible();
  // Enter 激活按钮 → 真实剩余数反馈
  const btn = wechat.getByRole("button", { name: /继续完成发布检查/ });
  await btn.focus();
  await expect(btn).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").last()).toContainText(
    "还有 3 项微信公众号发布前检查未完成"
  );
  // 刷新后空格勾选仍在（真实持久化）
  await page.reload();
  await expect(
    card(page, "微信公众号")
      .locator(".cv2-check-item")
      .first()
      .getByText("已检查", { exact: true })
  ).toBeVisible();
});
