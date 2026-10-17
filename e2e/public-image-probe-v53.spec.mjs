import {test,expect} from '@playwright/test';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
test('V53 author must opt in before a bounded external image check, and old results reset after refresh',async({page,request})=>{
 const p=await (await request.post('/api/editor/projects',{data:{
  title:'V53 图片公网检查确认界面（合成）',
  paragraphs:[{text:'此稿不会请求真实付费模型或发布平台。'}]
 }})).json();
 const as=await (await request.post('/api/assets',{data:{name:'synthetic.png',alt:'synthetic',base64:png}})).json();
 await request.put('/api/assets/'+as.id+'/mappings/wechat',{data:{
  url:'https://images.example.org/v53-fixed-public-image.png',
  note:'仅用于浏览器模拟的作者图片映射'
 }});
 const url='/api/composer/projects/'+p.id+'/wechat';
 const draft=await (await request.get(url)).json();
 const markdown=draft.markdown+'\n\n![测试图](https://images.example.org/v53-fixed-public-image.png)';
 const review=await (await request.post(url+'/review',{data:{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,markdown
 }})).json();
 const saved=await request.put(url,{data:{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,markdown,
  reviewToken:review.reviewToken,acknowledgeDrift:true
 }});
 expect(saved.status()).toBe(200);
 let calls=0;
 await page.route('**/api/composer/projects/*/wechat/image-network-check',async route=>{
  calls++; const payload=route.request().postDataJSON();
  expect(payload.acknowledgeExternalRequests).toBe(true);
  expect(payload.expectedLayoutRevision).toBe(1);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   kind:'content-studio-v53-author-initiated-image-check',
   layoutRevision:1,networkCalls:1,platformVerified:false,
   results:[{status:'image_response_observed',imageResponseObserved:true,
    cdnReachabilityVerified:false,reason:'partial_or_complete_image_header'}]
  })});
 });
 await page.goto('/compose/handoff?project='+p.id+'&channel=wechat');
 const box=page.getByTestId('v52-image-mapping-audit');
 await expect(box).toContainText('已匹配 1 个本地图片映射');
 const button=page.getByTestId('v53-check-image-network');
 const consent=page.getByTestId('v53-network-consent');
 await expect(button).toBeDisabled();
 await expect.poll(()=>calls).toBe(0);
 await consent.check();
 await expect(button).toBeEnabled();
 await button.click();
 await expect(page.getByTestId('v53-network-results')).toContainText('检测图片响应 1 条');
 await expect(page.getByTestId('v53-network-results')).toContainText('不代表 CDN 持续可用');
 await expect(consent).not.toBeChecked();
 await expect(button).toBeDisabled();
 expect(calls).toBe(1);
 await box.getByRole('button',{name:'复查图片链接'}).click();
 await expect(page.getByTestId('v53-network-results')).toHaveCount(0);
 expect(calls).toBe(1);
});
