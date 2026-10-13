"""Browser interaction through Playwright route → local HTTP, because container Chromium blocks direct loopback navigation."""
from playwright.sync_api import sync_playwright
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from pathlib import Path
import subprocess, os, time, json, tempfile
ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:4385'
SCREENS=ROOT/'screenshots';SCREENS.mkdir(exist_ok=True)
results=[]
def check(name, condition):
    state=bool(condition);results.append({'name':name,'passed':state});print(('PASS' if state else 'FAIL'),name,flush=True)
    if not state:raise AssertionError(name)
def request(path, method='GET', body=None):
    data=json.dumps(body).encode() if body is not None else None
    q=Request(BASE+path,method=method,data=data,headers={'Content-Type':'application/json'})
    with urlopen(q,timeout=12) as r:return json.loads(r.read())
def proxy(route):
    req=route.request
    try:
        payload=req.post_data.encode() if req.post_data is not None else None
        with urlopen(Request(req.url,data=payload,method=req.method,headers={'Content-Type':'application/json'}),timeout=12) as r:
            return route.fulfill(status=r.status,content_type='application/json',body=r.read(),headers={'Access-Control-Allow-Origin':'*'})
    except HTTPError as e:return route.fulfill(status=e.code,content_type='application/json',body=e.read(),headers={'Access-Control-Allow-Origin':'*'})
    except Exception as e:return route.fulfill(status=502,content_type='application/json',body=json.dumps({'error':str(e)}))
with tempfile.TemporaryDirectory() as temp:
    env={**os.environ,'PORT':'4385','DB_PATH':str(Path(temp)/'test.sqlite'),'ENABLE_SCENARIO':'1'}
    srv=subprocess.Popen(['node','src/server.mjs'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(70):
            try:request('/api/health');break
            except Exception:time.sleep(.12)
        else:raise RuntimeError('server failed')
        request('/api/fixture/seed','POST',{})
        ev=request('/api/events')['events'][0]
        c=request('/api/validations','POST',{'eventId':ev['id'],'hypothesis':'In a failed Agent run, the developer cannot see which tool failed.'})
        c=request('/api/validations/'+c['id']+'/evidence','POST',{'version':c['version'],'kind':'reproduction','result':'supports','observation':'In a clearly synthetic fixture, the trace omits the tool failure reason and reproduction step.'})
        c=request('/api/validations/'+c['id']+'/decision','POST',{'version':c['version'],'status':'confirmed','conclusion':'One synthetic reproduction of missing traces occurred; no real demand is established.','nextAction':'Write a bounded engineering note'})
        brief=request('/api/briefs','POST',{'eventId':ev['id']})
        html=(ROOT/'public/knowledge.html').read_text().replace('<head>','<head><base href="'+BASE+'/">',1)
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            ctx=browser.new_context(viewport={'width':1440,'height':980},device_scale_factor=1)
            ctx.route('**/api/**',proxy)
            pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
            pg.set_content(html,wait_until='domcontentloaded')
            pg.wait_for_function("document.querySelector('#kc-case') !== null",timeout=15000)
            check('loads actual local cases and empty knowledge state',pg.locator('#kc-case option').count()>1 and pg.locator('.metric').count()==4)
            check('shows no invented knowledge records','当前没有记录' in pg.locator('#list').inner_text())
            pg.locator('#kc-case').select_option(c['id'])
            pg.locator('#kc-synthesis').fill('A controlled local reproduction supports the narrow symptom; it does not demonstrate repeated user demand.')
            pg.locator('#kc-limitations').fill('Only a synthetic fixture and no external users were involved.')
            pg.locator('#knowledge-form button').click()
            pg.wait_for_function("document.querySelectorAll('#list .entry').length === 1",timeout=15000)
            check('publishes knowledge card via real HTTP API','知识 v1' in pg.locator('#list').inner_text())
            check('shows original evidence limitations','Only a synthetic fixture' in pg.locator('#detail').inner_text())
            pg.screenshot(path=str(SCREENS/'01-knowledge-desktop.png'),full_page=True)
            pg.locator('[data-tab="impact"]').click()
            pg.wait_for_selector('#ref-form')
            check('brief option filtered to research case',pg.locator('#ref-brief option').count()==2)
            pg.locator('#ref-brief').select_option(brief['id'])
            pg.locator('#ref-title').fill('A technical note about Agent traces')
            pg.locator('#ref-channel').select_option('wechat')
            pg.locator('#ref-status').select_option('reported_published')
            pg.locator('#ref-url').fill('https://mp.weixin.qq.com/s/synthetic-example')
            pg.locator('#ref-form button').click()
            pg.wait_for_function("document.querySelectorAll('#list .entry').length === 1",timeout=15000)
            check('registers author-reported publication, not platform-verified','作者报告已发表' in pg.locator('#list').inner_text())
            pg.screenshot(path=str(SCREENS/'02-article-links-desktop.png'),full_page=True)
            pg.locator('[data-tab="feedback"]').click();pg.wait_for_selector('#feedback-form')
            pg.locator('#feedback-ref').select_option(index=1)
            pg.locator('#feedback-summary').fill('A simulated reader asked how to find the failed call in the trace; user identity is not collected.')
            pg.locator('#feedback-hypothesis').fill('Developers might struggle to identify the failed tool call without a trace.')
            pg.locator('#feedback-form button').click()
            check('privacy consent blocks feedback submission',not pg.locator('#feedback-form').evaluate('(f)=>f.checkValidity()'))
            pg.locator('#feedback-privacy').check()
            pg.locator('#feedback-form button').click()
            pg.wait_for_function("document.querySelector('#promote') !== null",timeout=12000)
            check('author feedback is initially not verified','待验证' in pg.locator('#list').inner_text())
            pg.screenshot(path=str(SCREENS/'03-feedback-before-promotion.png'),full_page=True)
            pg.locator('#promote').click();pg.wait_for_function("document.querySelector('#detail').innerText.includes('继续验证该问题')",timeout=12000)
            check('feedback promotion creates a pending research case','继续验证该问题' in pg.locator('#detail').inner_text())
            # Simulate a human reopening the original research; assertions check impact recomputation.
            c=request('/api/validations/'+c['id']+'/reopen','POST',{'version':c['version'],'reason':'A later synthetic test produced the opposite behavior.'})
            pg.locator('[data-tab="impact"]').click();pg.wait_for_function("document.querySelector('#impact-warning') && document.querySelector('#impact-warning').textContent.includes('当前未检测')") if False else None
            pg.evaluate('() => refresh()');pg.wait_for_function("document.querySelector('#impact-warning') && document.querySelector('#impact-warning').textContent.includes('研究结论或知识版本已变化')",timeout=12000)
            check('case version change highlights impacted article','研究结论或知识版本已变化' in pg.locator('#impact-warning').inner_text())
            pg.screenshot(path=str(SCREENS/'04-impact-after-reopen.png'),full_page=True)
            pg.locator('#review-note').fill('The original research was reopened; its exported article will be reviewed for accuracy.')
            pg.locator('#review-form button').click()
            pg.wait_for_function("document.querySelector('#impact-warning').textContent.includes('Brief 使用历史研究快照')",timeout=12000)
            check('human review clears alert but preserves old Brief warning','Brief 使用历史研究快照' in pg.locator('#impact-warning').inner_text())
            check('JS runtime had no errors',not errors)
            mob=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
            mob.route('**/api/**',proxy)
            mp=mob.new_page();mp.set_content(html,wait_until='domcontentloaded');mp.wait_for_selector('.metric')
            check('mobile viewport has no horizontal scroll',mp.evaluate('document.documentElement.scrollWidth <= window.innerWidth+2'))
            mp.screenshot(path=str(SCREENS/'05-mobile-knowledge.png'),full_page=True)
            mp.locator('[data-tab="feedback"]').click();mp.wait_for_selector('.entry')
            check('mobile feedback accessible',mp.locator('#list .entry').count()==1)
            mob.close();ctx.close();browser.close()
    finally:
        srv.terminate()
        try:srv.wait(timeout=4)
        except Exception:srv.kill()
(ROOT/'browser-results-v25.json').write_text(json.dumps({'passed':sum(x['passed'] for x in results),'total':len(results),'results':results,'mode':'Playwright page injection with intercepted local HTTP; no direct browser navigation'},ensure_ascii=False,indent=2))
print('BROWSER TOTAL',len(results),'PASS',sum(x['passed'] for x in results))
