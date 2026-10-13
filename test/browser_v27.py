"""V27 real local Node API + Playwright UI injection bridge.
The browser environment rejects 127.0.0.1 direct navigation; the test proxies fetch via a Python bridge.
This does NOT verify direct browser navigation or refresh/persistence under a real origin.
"""
from pathlib import Path
import os,json,subprocess,time,tempfile,urllib.request,urllib.error
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
PORT=54327
BASE=f'http://127.0.0.1:{PORT}'
results=[]
def assert_case(name,condition):
 results.append({'case':name,'passed':bool(condition)})
 if not condition:raise AssertionError(name)
def call(path,method='GET',body=None):
 data=body.encode('utf-8') if isinstance(body,str) else json.dumps(body,ensure_ascii=False).encode() if body is not None else None
 rq=urllib.request.Request(BASE+path,data=data,method=method,headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(rq,timeout=10) as r:return r.status,json.loads(r.read().decode())
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read().decode())
def wait_ready():
 for _ in range(80):
  try:
   if call('/api/health')[0]==200:return
  except Exception:time.sleep(.08)
 raise RuntimeError('Node server unavailable')
with tempfile.TemporaryDirectory(prefix='content-studio-v27-browser-') as d:
 proc=subprocess.Popen(['node','src/server.mjs'],cwd=ROOT,env={**os.environ,'PORT':str(PORT),'DB_PATH':str(Path(d)/'test.sqlite'),'NODE_ENV':'browser-v27'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  wait_ready()
  status,project=call('/api/editor/projects','POST',{'title':'Agent 产品调试：一项可复现但仍待核实的观察','paragraphs':[{'id':'p_workflow_01','text':'某次本地调试过程中，Agent 工具的失败信息没有完整出现在视图中。'},{'id':'p_workflow_02','text':'这是一条作者复现实验的观察，不意味着问题具有普遍性。'}]})
  assert_case('创建真实 SQLite 支撑的统一文章',status==201 and project['channels']['master']['document']['revision']==1)
  with sync_playwright() as playwright:
   browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   pages=[]
   try:
    for width,name in [(1440,'desktop'),(390,'mobile')]:
     page=browser.new_page(viewport={'width':width,'height':900},accept_downloads=True)
     errors=[];page.on('pageerror',lambda error,errors=errors:errors.append(str(error)))
     page.expose_function('__bridge',lambda path,method='GET',body='',**kw: {'status':(out:=call(path,method,body))[0],'body':out[1]})
     html=(ROOT/'public/editor.html').read_text()
     bridge_script="""<script>window.fetch=async function(path,opt={}){const x=await window.__bridge(path,opt.method||'GET',opt.body||'');return {ok:x.status>=200&&x.status<300,status:x.status,json:async()=>x.body};};</script>"""
     html=html.replace('</head>','</head>'+bridge_script)
     page.set_content(html,wait_until='domcontentloaded')
     page.wait_for_function("document.querySelectorAll('[data-project]').length>0",timeout=15000)
     assert_case(f'{name} 初始文章可见',page.locator('.paper-head h2').inner_text().startswith('Agent 产品调试'))
     assert_case(f'{name} 原文可见且编辑区存在',page.locator('[data-text="p_workflow_01"]').count()==1)
     assert_case(f'{name} 无浏览器脚本错误',len(errors)==0)
     assert_case(f'{name} 无页面级横向溢出',page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2'))
     if width==1440:
      folder=ROOT/'screenshots';folder.mkdir(exist_ok=True)
      page.screenshot(path=str(folder/'01-editor-desktop.png'),full_page=True)
      page.locator('[data-text="p_workflow_01"]').fill('经过进一步阅读日志，当前只确认在一次本地实验中出现过上下文缺失。')
      assert_case('正文修改立刻标记未保存',page.locator('#save-draft').is_enabled())
      page.locator('#save-draft').click()
      page.wait_for_function("document.querySelector('.paper-bar .tag')?.textContent?.includes('v2')",timeout=10000)
      assert_case('保存创建主稿不可变版本',call('/api/editor/projects/'+project['id'])[1]['channels']['master']['document']['revision']==2)
      page.locator('[data-channel="wechat"]').click()
      assert_case('主稿更新未覆盖公众号旧稿',page.locator('.callout.warn').count()>0 and '某次本地调试' in page.locator('[data-text="p_workflow_01"]').input_value())
      page.locator('[data-ins="publish"]').click()
      page.locator('#export').click()
      page.wait_for_selector('.toast.error',timeout=10000)
      assert_case('未核查或旧主稿渠道不能直接导出',call('/api/editor/projects/'+project['id'])[1]['channels']['wechat']['exportedRevision']==0)
      page.locator('[data-ins="evidence"]').click()
      page.screenshot(path=str(folder/'02-source-annotations.png'),full_page=True)
      page.once('dialog',lambda dlg:dlg.accept())
      page.locator('#copy-master').click()
      page.wait_for_function("document.querySelector('.paper-bar .tag')?.textContent?.includes('v2')",timeout=10000)
      # Explicit refresh should match master
      assert_case('渠道明确更新且保留旧历史',call('/api/editor/projects/'+project['id'])[1]['channels']['wechat']['document']['revision']==2)
      page.locator('[data-ins="publish"]').click()
      for x in page.locator('[data-check]').all():x.check()
      page.locator('#save-checks').click()
      page.wait_for_timeout(250)
      page.screenshot(path=str(folder/'03-channel-checks.png'),full_page=True)
      p=call('/api/editor/projects/'+project['id'])[1]
      assert_case('四项人工核查落库',all(p['channels']['wechat']['checks'].values()))
      page.locator('[data-ins="versions"]').click()
      page.locator('#view-history').click();page.wait_for_selector('#history-result .evidence-row')
      assert_case('本地版本历史可查看',page.locator('#history-result .evidence-row').count()==2)
      # Test the outgoing API separately because file download UI is browser-policy-dependent.
      assert_case('后端导出独立 HTML/TXT',call('/api/editor/projects/'+project['id']+'/wechat/export','POST',{'expectedRevision':2})[0]==200)
      assert_case('导出不构成发表',call('/api/editor/projects/'+project['id'])[1]['channels']['wechat']['status']=='exported')
     if width==390:
      (ROOT/'screenshots').mkdir(exist_ok=True)
      page.screenshot(path=str(ROOT/'screenshots'/'04-editor-mobile.png'),full_page=True)
     pages.append(page)
   finally:browser.close()
 finally:proc.terminate();proc.wait(timeout=10)
out={'tests':len(results),'passed':sum(x['passed'] for x in results),'failed':sum(not x['passed'] for x in results),'checks':results,'approach':'Chromium injected HTML plus bridge to actual Node localhost HTTP/SQLite; direct URL navigation blocked'}
(ROOT/'browser-results-v27.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps({'passed':out['passed'],'tests':out['tests'],'failed':out['failed']},ensure_ascii=False))
