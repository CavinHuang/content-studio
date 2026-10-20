import {test,expect} from '@playwright/test';

// Updated for the Creator V2.3 视觉工作台 page (three-column studio): the
// same V40/V50 guarantees are asserted through the new UI — provider
// contract preflight stays local-only, channel readiness never claims
// platform verification, and queue enqueue/cancel never makes a paid call.
async function makeArticle(request,prefix='浏览器验收'){
 const title=prefix+' '+Math.random().toString(36).slice(2,9);
 const created=await request.post('/api/editor/projects',{data:{title,paragraphs:[
  {text:'本篇内容演示桌面自动化代理在真实任务中如何通过版本化数据来避免错误生成。'},
  {text:'图片必须由作者逐一检查后才能进入微信公众号和知乎的排版流程。'},
  {text:'图片模型调用前必须知情同意，同时应该具备可核对的成本和版本状态。'}
 ]}});
 expect(created.ok()).toBeTruthy();
 const project=await created.json();
 const planRes=await request.post('/api/illustrations/projects/'+project.id+'/plan',{
  data:{expectedMasterRevision:1}
 });
 expect(planRes.ok()).toBeTruthy();
 return {project,plan:await planRes.json()};
}

test('illustration page checks provider configuration and channel readiness without paid calls',async({page,request})=>{
 const {project,plan}=await makeArticle(request);
 await page.goto('/illustrations?project='+project.id);
 await expect(page.getByRole('heading',{name:'让每一张图片都有它的位置'})).toBeVisible();
 await expect(page.getByLabel('配图文章')).toHaveValue(project.id);
 // provider preflight: local config/URL checks only, no network, no cost
 await page.getByRole('button',{name:'检查三家供应商配置'}).click();
 await expect(page.getByText(/openai · fixture-image-model · 配置和地址格式检查通过/)).toBeVisible();
 await expect(page.getByText(/不验证密钥、不发送正文、不产生费用/)).toBeVisible();
 // channel readiness stays honest with nothing approved
 await page.getByRole('button',{name:'检查当前渠道的交接条件'}).click();
 await expect(page.getByText(/尚不具备全部交接条件/)).toBeVisible();
 await expect(page.getByText(/待批准/)).toBeVisible();
 const budget=await (await request.get('/api/illustrations/projects/'+project.id+'/budget')).json();
 expect(budget.used).toBe(0);
 expect(plan.shots.length).toBeGreaterThan(0);
});

test('real browser can enqueue and cancel without calling external provider',async({page,request})=>{
 const {project,plan}=await makeArticle(request,'队列端到端测试');
 await page.goto('/illustrations/queue');
 await expect(page.getByRole('heading',{name:'跨文章配图任务'})).toBeVisible();
 await page.getByRole('checkbox',{name:project.title}).check();
 await expect(page.getByText(/方案 v1/)).toBeVisible();
 const enqueue=page.getByRole('button',{name:/加入任务队列/});
 await expect(enqueue).toBeDisabled();
 await page.getByRole('checkbox',{name:/我已确认文章内容允许发送/}).check();
 await expect(enqueue).toBeEnabled();
 await enqueue.click();
 const feedback=page.locator('.compose-notice');
 await expect(feedback).toBeVisible();
 const feedbackText=(await feedback.innerText()).replace(/×/g,'').trim();
 const snapshot=await (await request.get('/api/illustrations/queue?projectId='+project.id)).json();
 console.log('V41 synthetic queue diagnostic:',JSON.stringify({feedbackText,counts:snapshot.counts,jobs:snapshot.jobs.length,expected:plan.shots.length}));
 expect(feedbackText).toMatch(/已创建 .* 项本地任务/);
 await expect(page.locator('.queue-job')).toHaveCount(plan.shots.length);
 const queued=await (await request.get('/api/illustrations/queue?projectId='+project.id)).json();
 expect(queued.counts.queued).toBe(plan.shots.length);
 expect(queued.active).toBe(false);
 await page.locator('.queue-job').first().getByRole('button',{name:'取消排队'}).click();
 await expect.poll(async()=>{
  const q=await (await request.get('/api/illustrations/queue?projectId='+project.id)).json();
  return q.counts.cancelled||0;
 }).toBe(1);
 const budget=await (await request.get('/api/illustrations/projects/'+project.id+'/budget')).json();
 expect(budget.used).toBe(0);
 const latest=await (await request.get('/api/illustrations/projects/'+project.id)).json();
 expect(latest.shots.every(s=>s.status==='planned')).toBe(true);
});

test('narrow mobile viewport retains manual QA controls and clear unverified state',async({page,request})=>{
 const {project}=await makeArticle(request,'移动端验收');
 await page.setViewportSize({width:390,height:844});
 await page.goto('/illustrations?project='+project.id);
 await expect(page.getByRole('heading',{name:'让每一张图片都有它的位置'})).toBeVisible();
 await page.getByRole('button',{name:'检查当前渠道的交接条件'}).click();
 await expect(page.getByText(/尚不具备全部交接条件/)).toBeVisible();
 await expect(page.getByText('手工记录平台实际检查结果')).toBeVisible();
 await expect(page.getByRole('button',{name:'保存人工验收记录（含失败）'})).toBeDisabled();
 const check=await (await request.get('/api/illustrations/projects/'+project.id+'/handoff-qa/wechat')).json();
 expect(check.authorReportedOnly).toBe(true);
 expect(check.readyForManualQA).toBe(false);
});
