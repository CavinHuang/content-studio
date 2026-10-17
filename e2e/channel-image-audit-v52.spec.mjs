import {test,expect} from '@playwright/test';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const original='https://cdn.example.org/v52-ui-original.png';
const replacement='https://cdn.example.org/v52-ui-updated.png';
const note='只用于模拟作者人工录入，不能证明远程图床已经上线';
test('V52 composer flags a historical image URL after author changes the local channel mapping',async({page,request})=>{
 const projectResponse=await request.post('/api/editor/projects',{data:{title:'V52 映射更新提醒（合成）',paragraphs:[
  {text:'本段文字会进入排版稿，图片地址只能由作者主动更新。'}
 ]}});
 expect(projectResponse.status()).toBe(201);
 const project=await projectResponse.json();
 const assetResponse=await request.post('/api/assets',{data:{name:'v52.png',alt:'离线 PNG',base64:png}});
 expect(assetResponse.status()).toBe(201);
 const asset=await assetResponse.json();
 const map='/api/assets/'+asset.id+'/mappings/wechat';
 expect((await request.put(map,{data:{url:original,note}})).ok()).toBe(true);
 const path='/api/composer/projects/'+project.id+'/wechat';
 const draft=await (await request.get(path)).json();
 const markdown=draft.markdown+'\n\n![合成 PNG]('+original+')';
 const review=await request.post(path+'/review',{data:{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,markdown}});
 expect(review.ok()).toBe(true);
 const result=await request.put(path,{data:{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,
  markdown,reviewToken:(await review.json()).reviewToken,acknowledgeDrift:true
 }});
 expect(result.ok()).toBe(true);
 await page.goto('/compose/handoff?project='+project.id+'&channel=wechat');
 const info=page.getByTestId('v52-image-mapping-audit');
 await expect(info).toContainText('已匹配 1 个本地图片映射');
 await expect(info).toContainText('不代表实际图床或发布平台可用');
 expect((await request.put(map,{data:{url:replacement,note}})).ok()).toBe(true);
 await info.getByRole('button',{name:'复查图片链接'}).click();
 await expect(info).toContainText('发现 1 个旧图片 URL');
 await expect(info).toContainText('不会自动替换');
 const still=(await (await request.get(path)).json()).markdown;
 expect(still).toContain(original);
 expect(still).not.toContain(replacement);
});
