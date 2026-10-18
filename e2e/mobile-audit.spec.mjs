import { expect, test } from "@playwright/test";

// 390px 移动端审计：每个路由在手机视口内不得出现横向溢出。
// 断言 scrollWidth 不超过视口宽度；溢出时列出最宽的子元素帮助定位。
const BASE = process.env.MOBILE_AUDIT_BASE || "";
const routes = [
  ["/", "首页"],
  ["/signin", "登录页"],
  ["/login", "远程登录页"],
  ["/topics", "选题"],
  ["/library", "资产库"],
  ["/settings", "创作者设置"],
  ["/settings#services", "设置·服务连接"],
  ["/sources", "信源"],
  ["/knowledge", "知识库"],
  ["/validation", "验证"],
  ["/review", "复核"],
  ["/publish", "发布"],
  ["/illustrations", "配图工作室"],
  ["/illustrations/queue", "配图队列"],
  ["/compose/handoff", "排版交接"],
];

async function expectNoHorizontalOverflow(page, label) {
  await page.waitForTimeout(600);
  const report = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0,
    );
    const offenders = [];
    if (scrollWidth > viewport) {
      for (const el of document.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        if (rect.width > viewport + 1 || rect.right > viewport + 8) {
          offenders.push(
            `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""} w=${Math.round(rect.width)} right=${Math.round(rect.right)}`,
          );
          if (offenders.length >= 6) break;
        }
      }
    }
    return { viewport, scrollWidth, offenders };
  });
  expect(
    report.scrollWidth,
    `${label}（${BASE || "app"}）出现横向溢出：scrollWidth=${report.scrollWidth} > 视口=${report.viewport}；嫌疑元素：\n${report.offenders.join("\n")}`,
  ).toBeLessThanOrEqual(report.viewport);
}

for (const [route, label] of routes) {
  test(`移动端 390px：${label} ${route} 无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await expectNoHorizontalOverflow(page, label);
  });
}

test("移动端 390px：创作工作台无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await page.request.post("/api/writing/projects", {
    data: { title: "移动端审计项目" },
  });
  const projectId = (await created.json()).projectId;
  await page.goto(`/compose?project=${projectId}`, {
    waitUntil: "domcontentloaded",
  });
  await expectNoHorizontalOverflow(page, "创作工作台");
});
