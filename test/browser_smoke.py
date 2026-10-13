from playwright.sync_api import sync_playwright
import json,os,urllib.request
R='http://127.0.0.1:4312';ROOT='/mnt/data/content-studio-v22';folder=ROOT+'/screenshots';os.makedirs(folder,exist_ok=True)
results=[]
def check(name,fn):
    try:fn();results.append({'name':name,'status':'passed'});print('PASS',name,flush=True)
    except Exception as e:results.append({'name':name,'status':'failed','error':str(e)[:700]});print('FAIL',name,str(e)[:250],flush=True)
def relay(url,opts=None):
    opts=opts or {}
    req=urllib.request.Request(R+url,method=opts.get('method','GET'),headers=opts.get('headers',{}),data=opts.get('body',None).encode() if opts.get('body') else None)
    try:
      with urllib.request.urlopen(req,timeout=8) as x:return {'status':x.status,'body':x.read().decode('utf-8')}
    except urllib.error.HTTPError as e:return {'status':e.code,'body':e.read().decode('utf-8')}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 c=b.new_context(viewport={'width':1440,'height':900},accept_downloads=True)
 page=c.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.expose_binding('__backend',lambda src,url,opts:relay(url,opts))
 page.evaluate('''() => {window.fetch=async(url,opts={})=>{let r=await window.__backend(url,opts);return{status:r.status,ok:r.status>=200&&r.status<300,json:async()=>JSON.parse(r.body)}}}''')
 # avoid blocked local navigation; original script is injected as DOM while API calls are relayed through Python to actual Node HTTP server
 html=open(ROOT+'/public/live.html').read()
 check('live page injected',lambda:(page.set_content(html,wait_until='domcontentloaded'),page.get_by_text('聚合信息，不淹没判断。').wait_for(timeout=6000)))
 page.locator('[data-event]').first.wait_for(timeout=8000)
 page.screenshot(path=folder+'/01-live-overview.png',full_page=True)
 def source_view():
  page.locator('#tab-sources').click();page.get_by_text('AIHOT 精选').wait_for(timeout=4000)
 check('source tab with API state',source_view)
 page.screenshot(path=folder+'/02-source-status.png',full_page=True)
 def event_view():
  page.locator('#tab-events').click();assert page.locator('[data-event]').count()>=3
 check('events with real local API',event_view)
 def detail():
  shared=page.locator('[data-event]').filter(has_text='Official announcement')
  shared.click();assert page.locator('#details .part').count()>=3;assert '自动确认独立证据' in page.locator('#details').inner_text()
 check('merged event retains provenance',detail)
 page.evaluate('window.scrollTo(0,0)');page.screenshot(path=folder+'/03-merged-evidence.png',full_page=True)
 def search():
  page.locator('#search').fill('no-such-keyword');assert page.locator('[data-event]').count()==0
  page.locator('#search').fill('');assert page.locator('[data-event]').count()>=3
 check('search and reset',search)
 def serverBrief():
  page.locator('[data-event]').filter(has_text='Official announcement').click()
  evId=page.locator('[data-event].active').get_attribute('data-event');r=relay('/api/briefs',{'method':'POST','headers':{'Content-Type':'application/json'},'body':json.dumps({'eventId':evId})});assert r['status']==201
  br=json.loads(r['body']);assert br['sourceItems'];assert 'aihot' in [i['sourceId'] for i in br['sourceItems']]
  return br['id']
 created=[]
 check('API Brief with source snapshot',lambda:created.append(serverBrief()))
 def handoff():
  app=open(ROOT+'/public/app.html').read(); bid=created[0]
  # emulate exact query param in page-injection environment; the actual app uses location.search on deployed server.
  app=app.replace("history.replaceState(null,'','/app');","")
  app=app.replace("const imported=new URLSearchParams(location.search).get('brief');", "const imported='"+bid+"';")
  page.set_content(app,wait_until='domcontentloaded')
  page.get_by_text('先想清楚要说什么。').wait_for(timeout=7000)
  assert 'aihot' in page.locator('#brief-evidence').input_value();assert 'hackernews' in page.locator('#brief-evidence').input_value()
 check('source-rich Brief rendered in V21 editor',handoff)
 page.screenshot(path=folder+'/04-v21-brief-handoff.png',full_page=True)
 check('no browser JS runtime error',lambda: (_ for _ in ()).throw(AssertionError(str(errors))) if errors else None)
 mobile=b.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
 m=mobile.new_page();m.expose_binding('__backend',lambda src,url,opts:relay(url,opts));m.evaluate('''() => {window.fetch=async(url,opts={})=>{let r=await window.__backend(url,opts);return{status:r.status,ok:r.status>=200&&r.status<300,json:async()=>JSON.parse(r.body)}}}''');m.set_content(html,wait_until='domcontentloaded');m.locator('[data-event]').first.wait_for(timeout=6000)
 def no_overflow(pg):
  dims=pg.evaluate('({sw:document.documentElement.scrollWidth,w:innerWidth})');assert dims['sw']<=dims['w']+2,dims
 check('mobile no horizontal overflow',lambda:no_overflow(m))
 m.screenshot(path=folder+'/05-mobile-events.png',full_page=True)
 m.locator('#tab-sources').click();m.screenshot(path=folder+'/06-mobile-sources.png',full_page=True)
 check('mobile source tab no overflow',lambda:no_overflow(m))
 b.close()
with open(ROOT+'/browser-results.json','w') as f:json.dump(results,f,ensure_ascii=False,indent=2)
print('results',len([x for x in results if x['status']=='passed']),len(results),flush=True)
