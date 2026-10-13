from playwright.sync_api import sync_playwright
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError
import json
ROOT=Path(__file__).resolve().parents[1];BASE='http://127.0.0.1:4383';screens=ROOT/'screenshots';screens.mkdir(exist_ok=True)
results=[]

def check(name,cond):
    results.append({'name':name,'passed':bool(cond)});
    if not cond: raise AssertionError(name)

def respond(route):
    req=route.request; url=req.url
    if '/api/' not in url:return route.abort()
    if req.method=='OPTIONS':return route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'})
    try:
        payload=req.post_data.encode() if req.post_data is not None else None
        r=urlopen(Request(url,data=payload,headers={'Content-Type':'application/json'},method=req.method),timeout=12)
        return route.fulfill(status=r.status,content_type='application/json',body=r.read(),headers={'Access-Control-Allow-Origin':'*'})
    except HTTPError as e:
        return route.fulfill(status=e.code,content_type='application/json',body=e.read(),headers={'Access-Control-Allow-Origin':'*'})
    except Exception as e:
        return route.fulfill(status=502,content_type='application/json',body=json.dumps({'error':str(e)}),headers={'Access-Control-Allow-Origin':'*'})
html=(ROOT/'public/opportunities.html').read_text().replace('<head>','<head><base href="'+BASE+'/">',1)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);ctx=browser.new_context(viewport={'width':1440,'height':950},device_scale_factor=1)
    ctx.route('**/api/**',respond)
    page=ctx.new_page();page.set_content(html,wait_until='domcontentloaded');page.wait_for_function("document.querySelectorAll('.story').length > 0",timeout=12000)
    check('event cards loaded',page.locator('.story').count()>=4)
    check('source evidence renders',page.locator('#details').inner_text().find('事实与研究缺口')>=0)
    check('AI action disabled without configured provider',page.locator('#analyze').is_disabled())
    check('brief CTA present',page.locator('#brief').count()==1)
    check('opportunity ranking visibly caveated', '不是已经验证的真实需求' in page.locator('#details').inner_text())
    check('privacy and rights notice visible','授权' in page.locator('.notice').last.inner_text())
    page.screenshot(path=str(screens/'01-opportunities-desktop.png'),full_page=True)
    page.locator('#tier').select_option(label='素材归档');page.wait_for_timeout(200)
    check('tier filter selects archive',all('素材归档' in x.inner_text() for x in page.locator('.story .pill:first-child').all()))
    page.locator('#tier').select_option('all')
    page.locator('#area').select_option(label='Agent 与自动化');page.wait_for_timeout(200)
    check('topic filter narrows results',page.locator('.story').count()>=1)
    page.locator('#area').select_option('all')
    page.locator('#search').fill('this-string-definitely-not-present');page.wait_for_timeout(150)
    check('search empty state works','当前筛选没有候选' in page.locator('#list').inner_text())
    page.locator('#search').fill('');page.wait_for_timeout(150)
    check('search recovers list',page.locator('.story').count()>=4)
    page.locator('.story').nth(2).click();check('selection responds to click',page.locator('.story.active').count()==1)
    page.screenshot(path=str(screens/'02-problem-evidence.png'),full_page=True)
    ctx2=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
    ctx2.route('**/api/**',respond);mobile=ctx2.new_page();mobile.set_content(html,wait_until='domcontentloaded');mobile.wait_for_function("document.querySelectorAll('.story').length > 0",timeout=12000)
    check('mobile no document horizontal overflow',mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'))
    check('mobile navigation present',mobile.locator('.mobile-nav').is_visible())
    check('mobile can select event',mobile.locator('.story').first.is_visible());mobile.locator('.story').nth(1).click();check('mobile details updated',mobile.locator('#details h2').count()==1)
    mobile.screenshot(path=str(screens/'03-opportunities-mobile.png'),full_page=True)
    ctx2.close();ctx.close();browser.close()
(ROOT/'browser-results-v23.json').write_text(json.dumps({'passed':sum(x['passed'] for x in results),'total':len(results),'checks':results},ensure_ascii=False,indent=2))
print('passed',sum(x['passed'] for x in results),'/',len(results))
