import {test,expect} from '@playwright/test';

/** Deliberately checks stable UI geometry and PNG pixels across a read-only
 * interaction rather than auto-accepting screenshots as fresh baselines.
 * No external websites or paid image model providers are called.
 */
async function createProject(request){
 const title='V42 响应式图片布局回归';
 const created=await request.post('/api/editor/projects',{data:{title,paragraphs:[
  {text:'对于技术文章插画，应检查尺寸、比例和说明文字，再由作者确认真实业务含义。'},
  {text:'我们使用浏览器视口和图像截屏观察配图页面的实际渲染，而不是仅检查组件函数是否存在。'}
 ]}});
 expect(created.status()).toBe(201);const p=await created.json();
 const plan=await request.post('/api/illustrations/projects/'+p.id+'/plan',{data:{expectedMasterRevision:1}});
 expect(plan.status()).toBe(201);return p;
}
function screenshotSize(bytes){
 expect(bytes.subarray(0,8)).toEqual(Buffer.from('89504e470d0a1a0a','hex'));
 return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}
test('desktop and mobile layouts stay bounded and header pixels remain stable during offline audit',async({page,request})=>{
 const project=await createProject(request);
 for(const width of [1280,390]){
  const height=800;
  await page.setViewportSize({width,height});
  await page.goto('/illustrations?project='+project.id);
  const head=page.getByRole('heading',{name:'文章写好，交给 Agent 配图'});
  await expect(head).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  const before=await page.locator('.compose-head').screenshot();
  const first=screenshotSize(before);
  expect(first.width).toBeLessThanOrEqual(width);
  expect(first.width).toBeGreaterThan(width/2);
  expect(first.height).toBeGreaterThan(30);
  await page.getByRole('button',{name:'离线检查配图与候选素材'}).click();
  await expect(page.getByText(/额外模型请求：0 次/)).toBeVisible();
  await expect(page.getByText(/还没有可检查的生成素材/).first()).toBeVisible();
  const after=await page.locator('.compose-head').screenshot();
  // A read-only audit may change the results panel but cannot shift/repaint
  // the brand/nav header, a useful screenshot-based layout regression guard.
  expect(after.equals(before)).toBe(true);
  const metrics=await page.evaluate(()=>{
   const target=document.querySelector('.compose-container'),header=document.querySelector('.compose-head');
   const box=target.getBoundingClientRect(),nav=header.getBoundingClientRect();
   return {viewport:document.documentElement.clientWidth,containerLeft:box.left,
    containerRight:box.right,headerLeft:nav.left,headerRight:nav.right};
  });
  expect(metrics.containerLeft).toBeGreaterThanOrEqual(-2);
  expect(metrics.containerRight).toBeLessThanOrEqual(metrics.viewport+2);
  expect(metrics.headerLeft).toBeGreaterThanOrEqual(-2);
  expect(metrics.headerRight).toBeLessThanOrEqual(metrics.viewport+2);
 }
 const budget=await (await request.get('/api/illustrations/projects/'+project.id+'/budget')).json();
 expect(budget.used).toBe(0);
});

test('channel switch never reuses stale handoff technical audit data',async({page,request})=>{
 const project=await createProject(request);
 await page.goto('/illustrations?project='+project.id);
 await page.getByRole('button',{name:'离线检查配图与候选素材'}).click();
 await expect(page.getByText(/额外模型请求：0 次/)).toBeVisible();
 await page.getByLabel('配图目标渠道').selectOption('zhihu');
 await expect(page.getByText(/额外模型请求：0 次/)).toHaveCount(0);
 const response=await request.get('/api/illustrations/projects/'+project.id+'/technical-audit?channel=zhihu');
 expect(response.ok()).toBeTruthy();
 const result=await response.json();
 expect(result.channel).toBe('zhihu');
 expect(result.platformVerified).toBe(false);
 expect(result.paidComparisonsPerformed).toBe(false);
});
