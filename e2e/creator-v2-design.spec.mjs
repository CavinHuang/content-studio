import {expect,test} from '@playwright/test';

test('Creator V2: 热点转选题，再从编辑器进入视觉工作台并采用候选',async({page})=>{
  await page.goto('/design/creator-v2',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'今天，继续把好想法写出来。'})).toBeVisible();
  await page.getByRole('button',{name:'热点雷达',exact:true}).click();
  await expect(page.getByRole('heading',{name:'热点雷达'})).toBeVisible();
  await page.getByRole('button',{name:/收为选题候选/}).click();
  await expect(page.getByRole('heading',{name:'从线索，走向值得写的文章'})).toBeVisible();
  await page.getByRole('button',{name:/开始写作/}).click();
  await expect(page.getByRole('button',{name:'进入配图工作台'})).toBeVisible();
  await page.getByRole('button',{name:'进入配图工作台'}).click();
  await expect(page.getByRole('heading',{name:'视觉工作台'})).toBeVisible();
  await expect(page.locator('.dv-visual-center > .dv-art-warm')).toBeVisible();
  await page.getByRole('button',{name:/靛蓝构成/}).click();
  await page.getByRole('button',{name:'采用这张图'}).click();
  await expect(page.getByRole('status')).toContainText('已在原型中采用');
  await page.getByRole('button',{name:'返回正文预览'}).click();
  await expect(page.locator('.dv-paper .dv-art-indigo')).toBeVisible();
});

test('Creator V2: 手机导航能够进入热点和设置，页面无横向溢出',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/design/creator-v2',{waitUntil:'domcontentloaded'});
  await page.getByRole('navigation',{name:'移动端快捷导航'}).getByRole('button',{name:'热点'}).click();
  await expect(page.getByRole('heading',{name:'热点雷达'})).toBeVisible();
  await page.getByRole('navigation',{name:'移动端快捷导航'}).getByRole('button',{name:'更多'}).click();
  await page.getByRole('navigation',{name:'Creator V2 设计导航'}).getByRole('button',{name:'偏好与连接'}).click();
  await expect(page.getByRole('heading',{name:'偏好与连接'})).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
