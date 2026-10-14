import {test,expect} from '@playwright/test';

async function article(request){
 const response=await request.post('/api/editor/projects',{data:{title:'V44 渠道交付审核 '+Math.random().toString(36).slice(2,8),paragraphs:[
  {text:'从真实记录中总结系统设计经验，所有结论仍需根据原始来源进行人工事实核对。'},
  {text:'本文是无插图的交付实验，验证审核步骤与历史快照能否阻止无意的自动发布。'}
 ]}});
 expect(response.status()).toBe(201);return await response.json();
}
async function importAndApprove(request,project){
 const base='/api/composer/projects/'+project.id+'/wechat';
 const draft=await (await request.get(base)).json();
 const review=await request.post(base+'/review',{data:{
  expectedLayoutRevision:0,expectedDocumentRevision:draft.sourceDocumentRevision,markdown:draft.markdown
 }});
 expect(review.ok()).toBeTruthy();
 const checked=await review.json();
 const save=await request.put(base,{data:{
  expectedLayoutRevision:0,expectedDocumentRevision:draft.sourceDocumentRevision,
  markdown:draft.markdown,reviewToken:checked.reviewToken,acknowledgeDrift:true
 }});
 expect(save.status()).toBe(200);
 const done=await request.post('/api/editor/projects/'+project.id+'/wechat/checks',{data:{
  expectedRevision:project.channels.wechat.document.revision,
  checks:{factual:true,privacy:true,rights:true,layout:true}
 }});
 expect(done.ok()).toBeTruthy();
}
test('V44 real Chromium shows gated six stages and links to source editors',async({page,request})=>{
 const p=await article(request);
 await page.goto('/delivery?project='+p.id+'&channel=wechat');
 await expect(page.getByRole('heading',{name:'文章交付验收工作台'})).toBeVisible();
 await expect(page.getByLabel('交付验收文章')).toHaveValue(p.id);
 await expect(page.getByLabel('交付验收渠道')).toHaveValue('wechat');
 await expect(page.locator('[data-testid="v44-readiness-steps"] article')).toHaveCount(6);
 await expect(page.getByText('仍有交付事项待处理')).toBeVisible();
 await expect(page.getByText('需要配图计划，或明确记录无配图决定')).toBeVisible();
 await expect(page.getByRole('button',{name:'保存不可变的交付核查快照'})).toBeDisabled();
 const stages=page.locator('[data-testid="v44-readiness-steps"] article');
 expect(await stages.filter({has:page.getByText('正文与版本')}).count()).toBe(1);
 const urls=await stages.locator('a').evaluateAll(links=>links.map(a=>new URL(a.href).pathname));
 expect(urls).toContain('/illustrations');expect(urls).toContain('/compose');expect(urls).toContain('/editor');
 const snapshot=await (await request.get('/api/delivery/projects/'+p.id+'/wechat')).json();
 expect(snapshot.platformVerified).toBe(false);
 expect(snapshot.published).toBe(false);
});
test('V44 browser can record a no-image author decision and immutable readiness snapshot',async({page,request})=>{
 const p=await article(request);
 await importAndApprove(request,p);
 await page.goto('/delivery?project='+p.id+'&channel=wechat');
 await expect(page.getByTestId('v44-no-image-choice')).toBeVisible();
 await page.getByLabel('无配图原因').fill('作者确认该稿为纯文本工程经验，不需要展示任何概念插图。');
 await page.getByRole('button',{name:'记录本版本无配图决定'}).click();
 await expect(page.getByText('本地交付条件已满足')).toBeVisible();
 await expect(page.locator('[data-stage="images"]')).toHaveAttribute('data-status','skipped');
 await expect(page.locator('[data-stage="platform"]')).toHaveAttribute('data-status','skipped');
 await page.getByLabel('交付快照备注').fill('我已经核对事实、版权、隐私与排版，但尚未登录真实平台发表。');
 await page.getByRole('checkbox',{name:/确认这只是本地交付核查记录/}).check();
 await page.getByRole('button',{name:'保存不可变的交付核查快照'}).click();
 await expect(page.getByText(/上次交付快照：与当前状态一致/)).toBeVisible();
 const history=await (await request.get('/api/delivery/projects/'+p.id+'/wechat/history')).json();
 expect(history.history).toHaveLength(1);
 expect(history.history[0].platformVerified).toBe(false);
 expect(history.history[0].published).toBe(false);
 await page.getByLabel('交付验收渠道').selectOption('zhihu');
 await expect(page.getByText('仍有交付事项待处理')).toBeVisible();
 await expect(page.getByTestId('v44-no-image-choice')).toBeVisible();
 const zhihu=await (await request.get('/api/delivery/projects/'+p.id+'/zhihu')).json();
 expect(zhihu.exemption.current).toBe(false);
});
test('V44 390px mobile viewport keeps action links and content inside screen',async({page,request})=>{
 const p=await article(request);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/delivery?project='+p.id);
 await expect(page.getByRole('heading',{name:'文章交付验收工作台'})).toBeVisible();
 await expect(page.getByTestId('v44-readiness-steps')).toBeVisible();
 const rect=await page.evaluate(()=>{
  const viewport=document.documentElement.clientWidth;
  const box=document.querySelector('[data-testid="v44-readiness-steps"]').getBoundingClientRect();
  const step=document.querySelector('[data-stage="images"]').getBoundingClientRect();
  return {viewport,boxLeft:box.left,boxRight:box.right,stepLeft:step.left,stepRight:step.right};
 });
 expect(rect.boxLeft).toBeGreaterThanOrEqual(-2);
 expect(rect.boxRight).toBeLessThanOrEqual(rect.viewport+2);
 expect(rect.stepLeft).toBeGreaterThanOrEqual(-2);
 expect(rect.stepRight).toBeLessThanOrEqual(rect.viewport+2);
});
