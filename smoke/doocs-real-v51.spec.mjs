import {readFile} from 'node:fs/promises';
/**
 * V51: true integration against the public doocs/md Docker image.
 *
 * Uses only synthetic Markdown and a local disposable Content Studio SQLite.
 * No paid providers, third-party accounts, clipboard upload or publishing.
 * Requests from the doocs page to non-loopback URLs are aborted to keep the
 * synthetic draft inside the two locally controlled services.
 */
import {test,expect} from '@playwright/test';

const marker='V51_REAL_DOOCS_LOCAL_MARKDOWN_'+Date.now();
const articleText='离线测试正文：此文本由 Content Studio 创建，在真正的 doocs/md CodeMirror 中渲染。';
const editorOrigin='http://127.0.0.1:8800';

test('V51 takes actual Content Studio Markdown into live doocs CodeMirror and renders the real preview',async({page,request,context})=>{
 const health=await request.get('/api/integrations/doocs/preflight');
 expect(health.ok()).toBeTruthy();
 const reached=await health.json();
 expect(reached.status).toBe('reachable');
 expect(reached.articleBytesSent).toBe(0);
 expect(reached.platformVerified).toBe(false);
 expect(reached.editorIdentityVerified).toBe(false);

 const created=await request.post('/api/editor/projects',{data:{
  title:'V51 本机 doocs 实例真实交接 '+marker,
  paragraphs:[{text:marker},{text:articleText}]
 }});
 expect(created.status()).toBe(201);
 const project=await created.json();
 const current=await request.get('/api/composer/projects/'+project.id+'/wechat');
 expect(current.ok()).toBeTruthy();
 const saved=await current.json();
 expect(saved.markdown).toContain(marker);
 expect(saved.markdown).toContain(articleText);

 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4312'});
 await page.goto('/compose?project='+project.id+'&channel=wechat');
 await expect(page.getByTestId('v50-doocs-status')).toContainText('本机排版器服务可连接');
 await page.getByRole('button',{name:'复制 Markdown'}).click();
 const copied=await page.evaluate(()=>navigator.clipboard.readText());
 expect(copied).toContain(marker);
 expect(copied).toBe(saved.markdown);

 const doocs=await context.newPage();
 const external=[];
 await doocs.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith('http://127.0.0.1:8800/')||url.startsWith('http://localhost:8800/')||
     url.startsWith('data:')||url.startsWith('blob:'))return route.continue();
  external.push(new URL(url).hostname);
  return route.abort();
 });
 await doocs.goto(editorOrigin+'/');
 const cm=doocs.locator('#editor .cm-content[contenteditable="true"]');
 const rootLoaded=await cm.waitFor({state:'visible',timeout:12000}).then(()=>true).catch(()=>false);
 if(!rootLoaded)await doocs.goto(editorOrigin+'/md/');
 await expect(cm).toBeVisible({timeout:20000});
 // CodeMirror uses contenteditable; browser-backed fill exercises the
 // third-party editor, NOT a mocked textarea or a direct DOM innerHTML write.
 await cm.fill(copied);
 await expect(doocs.locator('#output')).toContainText(marker,{timeout:20000});
 await expect(doocs.locator('#output')).toContainText(articleText);
 const previewMarkup=await doocs.locator('#output').innerHTML();
 expect(previewMarkup).not.toContain('<script');
 expect(previewMarkup).toContain(marker);
 // The live formatter is permitted to change styles, but not source meaning.
 const stillStored=await request.get('/api/composer/projects/'+project.id+'/wechat');
 const after=await stillStored.json();
 expect(after.markdown).toBe(saved.markdown);
 expect(after.layoutRevision).toBe(saved.layoutRevision);

 // Exercise doocs/md's own menu-driven export, not a programmatically
 // re-created Markdown string. Then review/import the actual downloaded file
 // via Content Studio's version-bound Markdown API.
 await doocs.getByRole('menuitem',{name:/^(文件|File)$/}).first().click();
 await doocs.getByRole('menuitem',{name:/^(导出|Export)$/}).first().hover();
 const exportedFile=doocs.waitForEvent('download',{timeout:15000});
 await doocs.getByRole('menuitem',{name:/Markdown/i}).first().click();
 const download=await exportedFile;
 const exported=await readFile(await download.path(),'utf8');
 expect(exported).toContain(marker);
 expect(exported).toContain(articleText);
 const review=await request.post('/api/composer/projects/'+project.id+'/wechat/review',{
  data:{expectedLayoutRevision:saved.layoutRevision,
   expectedDocumentRevision:saved.sourceDocumentRevision,markdown:exported}});
 expect(review.ok()).toBeTruthy();
 const checked=await review.json();
 const imported=await request.put('/api/composer/projects/'+project.id+'/wechat',{
  data:{expectedLayoutRevision:saved.layoutRevision,
   expectedDocumentRevision:saved.sourceDocumentRevision,
   markdown:exported,reviewToken:checked.reviewToken,acknowledgeDrift:true}});
 expect(imported.ok()).toBeTruthy();
 const returned=await request.get('/api/composer/projects/'+project.id+'/wechat');
 expect((await returned.json()).markdown).toBe(exported);

 // A real external Markdown editor export is not a publishing-platform QA.
 const readiness=await request.get('/api/delivery/projects/'+project.id+'/wechat');
 const report=await readiness.json();
 expect(report.platformVerified).toBe(false);
 expect(report.published).toBe(false);
 // Any optional external font/analytics requests were aborted, not sent.
 expect(Array.isArray(external)).toBe(true);
 await doocs.close();
});
