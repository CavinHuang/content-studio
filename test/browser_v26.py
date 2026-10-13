"""Browser ↔ actual local HTTP API bridge. Chromium navigation to localhost is blocked by runner policy;
page is HTML-injected and fetch is forwarded through Python to the real Node service.
This is not proof that Chromium can directly navigate to deployed localhost."""
import json, os, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
PORT=54427
BASE=f'http://127.0.0.1:{PORT}'
OUT=ROOT/'screenshots'
OUT.mkdir(exist_ok=True)
results=[]

def request(path, method='GET', data=None):
    raw=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request(BASE+path,data=raw,method=method,headers=({'Content-Type':'application/json'} if raw is not None else {}))
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            body=r.read().decode();return {'ok':r.status<400,'status':r.status,'body':json.loads(body) if r.headers.get_content_type()=='application/json' else body}
    except urllib.error.HTTPError as e:
        v=e.read().decode();return {'ok':False,'status':e.code,'body':json.loads(v)}

def check(name, condition):
    if not condition: raise AssertionError(name)
    results.append(name)

def prepare():
    check('fixture seeding', request('/api/fixture/seed','POST',{})['ok'])
    ev=request('/api/events')['body']['events'][0]
    r=request('/api/validations','POST',{'eventId':ev['id'],'hypothesis':'本地工具调试日志可能无法覆盖特定失败过程'})
    case=r['body']
    case=request('/api/validations/'+case['id']+'/evidence','POST',{'version':case['version'],'kind':'reproduction','result':'supports','observation':'One synthetic local test of the failure hides the complete diagnostic trace.'})['body']
    case=request('/api/validations/'+case['id']+'/decision','POST',{'version':case['version'],'status':'confirmed','conclusion':'Only the tested local synthetic run exhibited this narrow logging behavior.','nextAction':'Record a bounded finding.'})['body']
    card=request('/api/knowledge','POST',{'caseId':case['id'],'synthesis':'An isolated controlled reproduction showed missing trace context in one local environment.','limitations':'No real end users and no general deployment coverage were studied.'})['body']
    brief=request('/api/briefs','POST',{'eventId':ev['id']})['body']
    ref=request('/api/content-references','POST',{'briefId':brief['id'],'cardId':card['id'],'title':'如何谨慎解释 Agent 调试实验','channel':'wechat','status':'exported'})['body']
    return case,ref

with tempfile.TemporaryDirectory(prefix='cs26-browser-') as td:
 env=dict(os.environ,PORT=str(PORT),DB_PATH=str(Path(td)/'test.sqlite'),ENABLE_SCENARIO='1')
 proc=subprocess.Popen(['node','src/server.mjs'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
    for _ in range(70):
        try:
            if request('/api/health')['ok']:break
        except Exception:time.sleep(.08)
    else:raise RuntimeError('Local HTTP service failed to start')
    case,ref=prepare()
    html=(ROOT/'public'/'precision.html').read_text()
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
        page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
        page.expose_function('__csRequest',lambda url,method,body:request(url,method,json.loads(body) if body else None))
        page.evaluate('''(()=>{window.fetch=async(url,opts={})=>{
            let r=await window.__csRequest(url,opts.method||'GET',opts.body||null);
            return {ok:r.ok,status:r.status,json:async()=>r.body};
        };return true})()''')
        page.on('dialog',lambda dialog: dialog.accept())
        page.set_content(html,wait_until='load')
        page.locator('[data-ref]').first.wait_for(timeout=8000)
        check('loads real registered reference',page.locator('[data-ref]').count()==1)
        check('displays unpublished state', '已导出' in page.locator('#refs').inner_text())
        page.screenshot(path=str(OUT/'01-overview-empty-document.png'),full_page=True)
        page.locator('#addp').click()
        page.locator('[data-paragraph="0"]').fill('一次受控本地测试中，Agent 工具失败没有显示完整的调试线索。')
        page.locator('#addp').click()
        page.locator('[data-paragraph="1"]').fill('这只是一个合成样本，不代表所有用户都存在同样的问题。')
        page.locator('#docform button[type=submit]').click()
        page.get_by_text('本地文章版本已保存').wait_for(timeout=8000)
        check('document persisted through local API',request('/api/precision')['body']['stats']['documents']==1)
        page.screenshot(path=str(OUT/'02-paragraph-editor.png'),full_page=True)
        page.get_by_role('button',name='证据锚点').click()
        page.locator('#claimpara').select_option('p_'+('nonexistent') if False else request('/api/precision')['body']['documents'][0]['paragraphs'][0]['id'])
        page.locator('#claimquote').fill('工具失败没有显示完整的调试线索')
        page.locator('#claimevidence').select_option(index=1)
        page.locator('#claimform button').click()
        page.get_by_text('证据已绑定到精确原句').wait_for(timeout=8000)
        check('claim has real evidence ID',len(request('/api/precision')['body']['claims'][0]['evidenceIds'])==1)
        page.screenshot(path=str(OUT/'03-exact-evidence-anchor.png'),full_page=True)
        page.locator('#scan').click()
        page.get_by_text('研究变更扫描完成').wait_for(timeout=8000)
        check('no false correction before research change',len(request('/api/precision')['body']['tasks'])==0)
        case=request('/api/validations/'+case['id']+'/reopen','POST',{'version':case['version'],'reason':'A new synthetic build has different observed trace behavior'})['body']
        page.locator('#scan').click()
        page.get_by_text('研究变更扫描完成').wait_for(timeout=8000)
        page.locator('#newtext').wait_for(timeout=8000)
        check('creates correction from changed research',request('/api/precision')['body']['stats']['pendingReview']==1)
        page.screenshot(path=str(OUT/'04-precise-correction-pending.png'),full_page=True)
        page.locator('#newtext').fill('在较新的本地运行环境里，失败工具的完整调试线索已经能够显示，旧现象不再复现。')
        page.locator('#reason').fill('后续受控复现实验与旧实验的结果不同，因此需要调整原句，避免扩大结论。')
        page.locator('#propose').click()
        page.get_by_text('修改提案已保存').wait_for(timeout=8000)
        check('proposal did not overwrite document',request('/api/precision')['body']['documents'][0]['revision']==1)
        # Refreshed UI may switch to document tab; task panel persists.
        page.locator('#reviewnote').fill('根据后续的受控实验，人工批准在本地草稿中修正旧句子，保留原始版本供追溯。')
        page.locator('[data-decide="apply_local"]').click()
        page.get_by_text('本地稿已修订').wait_for(timeout=8000)
        state=request('/api/precision')['body']
        check('explicit approval creates revision 2',state['documents'][0]['revision']==2)
        check('original anchor now marked as changed',state['stats']['anchorMismatches']==1)
        check('correction task records local-only application',state['tasks'][0]['status']=='local_applied')
        page.screenshot(path=str(OUT/'05-correction-applied.png'),full_page=True)
        for width in [390,768,1024,1440]:
            page.set_viewport_size({'width':width,'height':900})
            page.wait_for_timeout(40)
            w=page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
            check(f'no horizontal overflow at {width}px',w)
        page.set_viewport_size({'width':390,'height':844})
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(OUT/'06-mobile-correction.png'),full_page=True)
        page.set_viewport_size({'width':1440,'height':900})
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(OUT/'07-desktop-preview.png'),full_page=False)
        check('HTML title present','精准更正' in page.title())
        browser.close()
 finally:proc.terminate();proc.wait(timeout=6)
Path(ROOT/'browser-results-v26.json').write_text(json.dumps({'passed':len(results),'checks':results,'transport':'Playwright set_content + Python bridge to real Node HTTP API; direct browser localhost navigation not verified'},ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(results),'checks':results},ensure_ascii=False,indent=2))
