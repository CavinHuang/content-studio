/**
 * V52 — Real doocs/md PNG handoff using a synthetic CDN stand-in.
 *
 * Editor, Markdown exporter, downloaded file, and Content Studio HTTP/SQLite
 * are real. Only the public CDN response is intercepted and replaced with
 * fixed synthetic PNG bytes; NO actual upload or third-party image service.
 */
import {readFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';

const originalPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const imageBytes=Buffer.from(originalPng,'base64');
const imageURL='https://cdn.example.org/v52-test-controlled-image.png';
const changedImageURL='https://cdn.example.org/v52-test-replaced-image.png';
const channel='wechat';

test('V52 real doocs image preview and downloaded Markdown preserve mapped channel image without reporting publication',async({page,request,context})=>{
 const marker='V52_REAL_DOOCS_IMAGE_'+Date.now();
 const created=await request.post('/api/editor/projects',{data:{
  title:'V52 图片与排版交接模拟 '+marker,
  paragraphs:[{text:marker},{text:'测试一张已经在 Content Studio 内登记的 PNG 素材如何进入真实排版器。'}]
 }});
 expect(created.status()).toBe(201);
 const project=await created.json();
 const uploaded=await request.post('/api/assets',{data:{
  name:'v52-synthetic.png',alt:'测试用合成像素图',base64:originalPng
 }});
 expect(uploaded.status()).toBe(201);
 const asset=await uploaded.json();
 expect(asset.id).toMatch(/^as_[a-f0-9]{32}$/);
 expect(asset.mime).toBe('image/png');
 expect(asset.platformVerified).toBe(false);
 const preview=await request.get('/api/assets/'+asset.id+'/preview');
 expect(preview.ok()).toBeTruthy();
 expect(preview.headers()['content-type']).toContain('image/png');
 expect(Buffer.from(await preview.body())).toEqual(imageBytes);

 // Channel mapping is a manually supplied URL, NOT a verified upload.
 const content=(await (await request.get('/api/composer/projects/'+project.id+'/'+channel)).json());
 const token='![合成图片](asset://'+asset.id+')';
 const tokensMarkdown=content.markdown+'\n\n'+token;
 const notMapped=await request.post('/api/assets/prepare',{data:{channel,markdown:tokensMarkdown}});
 const noMapping=await notMapped.json();
 expect(noMapping.ready).toBe(false);
 expect(noMapping.missing).toContain(asset.id);
 const mapped=await request.put('/api/assets/'+asset.id+'/mappings/wechat',{data:{
  url:imageURL,note:'仅供合成浏览器联调使用的 CDN 模拟链接；没有实际上传至远端'
 }});
 expect(mapped.ok()).toBeTruthy();
 const prepared=await (await request.post('/api/assets/prepare',{data:{channel,markdown:tokensMarkdown}})).json();
 expect(prepared.ready).toBe(true);
 expect(prepared.markdown).toContain(imageURL);
 expect(prepared.markdown).not.toContain('asset://');
 expect(prepared.platformVerified).toBe(false);
 const otherChannel=await (await request.post('/api/assets/prepare',{data:{channel:'zhihu',markdown:tokensMarkdown}})).json();
 expect(otherChannel.ready).toBe(false);
 expect(otherChannel.missing).toContain(asset.id);

 const target='/api/composer/projects/'+project.id+'/'+channel;
 const reviewed=await request.post(target+'/review',{data:{
  expectedLayoutRevision:content.layoutRevision,expectedDocumentRevision:content.sourceDocumentRevision,
  markdown:prepared.markdown
 }});
 expect(reviewed.ok()).toBeTruthy();
 const review=await reviewed.json();
 const stored=await request.put(target,{data:{
  expectedLayoutRevision:content.layoutRevision,expectedDocumentRevision:content.sourceDocumentRevision,
  markdown:prepared.markdown,reviewToken:review.reviewToken,acknowledgeDrift:true
 }});
 expect(stored.ok()).toBeTruthy();
 const before=(await (await request.get(target)).json());
 expect(before.markdown).toBe(prepared.markdown);

 // Source the handoff from the browser's actual clipboard, like the V51 flow.
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4312'});
 await page.goto('/compose?project='+project.id+'&channel='+channel);
 await page.getByRole('button',{name:'复制 Markdown'}).click();
 const copied=await page.evaluate(()=>navigator.clipboard.readText());
 expect(copied).toBe(prepared.markdown);

 const editor=await context.newPage();
 const intercepted=[],blocked=[];
 await editor.route('**/*',async route=>{
  const u=route.request().url();
  if(u===imageURL){
   intercepted.push(u);
   return route.fulfill({status:200,contentType:'image/png',body:imageBytes,
    headers:{'access-control-allow-origin':'*','cache-control':'no-store'}});
  }
  if(u.startsWith('http://127.0.0.1:8800/')||u.startsWith('http://localhost:8800/')||
     u.startsWith('data:')||u.startsWith('blob:'))return route.continue();
  blocked.push(u.startsWith('https://')?'blocked-external-https':'blocked-other');
  return route.abort();
 });
 await editor.goto('http://127.0.0.1:8800/');
 const cm=editor.locator('#editor .cm-content[contenteditable="true"]');
 const found=await cm.waitFor({state:'visible',timeout:12000}).then(()=>true).catch(()=>false);
 if(!found)await editor.goto('http://127.0.0.1:8800/md/');
 await expect(cm).toBeVisible();
 await cm.fill(copied);
 await expect(editor.locator('#output')).toContainText(marker,{timeout:20000});
 const img=editor.locator('#output img').first();
 await expect(img).toHaveAttribute('src',imageURL,{timeout:15000});
 await img.scrollIntoViewIfNeeded();
 await expect.poll(async()=>img.evaluate(element=>element.complete&&element.naturalWidth>0),{timeout:15000}).toBe(true);
 expect(intercepted).toContain(imageURL);

 // Uses doocs/md's actual direct "导出 .md" menu in the pinned image.
 await editor.getByRole('menuitem',{name:/^(文件|File)$/}).first().click();
 const direct=editor.getByRole('menuitem',{name:/导出.*md|Export.*md/i}).first();
 const exportClick=async()=>{
  if(await direct.isVisible())return direct.click();
  await editor.getByRole('menuitem',{name:/导出|Export/i}).first().hover();
  return editor.getByRole('menuitem',{name:/Markdown/i}).first().click();
 };
 const [download]=await Promise.all([editor.waitForEvent('download',{timeout:15000}),exportClick()]);
 const exported=await readFile(await download.path(),'utf8');
 expect(exported).toContain(marker);
 expect(exported).toContain(imageURL);
 expect(exported).toContain('![合成图片]');
 const importReview=await request.post(target+'/review',{data:{
  expectedLayoutRevision:before.layoutRevision,expectedDocumentRevision:before.sourceDocumentRevision,
  markdown:exported
 }});
 expect(importReview.ok()).toBe(true);
 const accepted=await request.put(target,{data:{
  expectedLayoutRevision:before.layoutRevision,expectedDocumentRevision:before.sourceDocumentRevision,
  markdown:exported,reviewToken:(await importReview.json()).reviewToken,acknowledgeDrift:true
 }});
 expect(accepted.ok()).toBe(true);
 const reloaded=await (await request.get(target)).json();
 expect(reloaded.markdown).toBe(exported);
 const readiness=await (await request.get('/api/delivery/projects/'+project.id+'/wechat')).json();
 expect(readiness.ready).toBe(false);
 expect(readiness.platformVerified).toBe(false);
 expect(readiness.published).toBe(false);

 // Updating a manual mapping does not (and must not silently) rewrite an
 // already imported external editor file. The operator must re-review it.
 const replace=await request.put('/api/assets/'+asset.id+'/mappings/wechat',{data:{
  url:changedImageURL,note:'合成测试修改映射，应显式检查旧稿，而不能假装已经远端同步'
 }});
 expect(replace.ok()).toBe(true);
 const newlyPrepared=await (await request.post('/api/assets/prepare',{data:{channel,markdown:tokensMarkdown}})).json();
 expect(newlyPrepared.markdown).toContain(changedImageURL);
 expect(newlyPrepared.markdown).not.toContain(imageURL);
 const unchanged=await (await request.get(target)).json();
 expect(unchanged.markdown).toBe(exported);
 expect(unchanged.markdown).toContain(imageURL);
 // The live CDN remains unverified; browser image was served from the
 // synthetic route in THIS test rather than from the public hostname.
 expect(intercepted.length).toBeGreaterThanOrEqual(1);
 expect(Array.isArray(blocked)).toBe(true);
 await editor.close();
});
