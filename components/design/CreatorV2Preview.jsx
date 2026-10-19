'use client';
import {useMemo,useState} from 'react';
import {
  Home,Flame,Compass,Files,PenLine,Images,Send,CalendarDays,BarChart3,
  Library,Settings2,ChevronRight,ArrowRight,Sparkles,Search,Plus,Check,
  Clock3,AlertCircle,WandSparkles,RefreshCw,SlidersHorizontal,
  Eye,Bookmark,BookOpen,Link2,ShieldCheck,MessageSquare,Menu,X
} from 'lucide-react';

const navigation=[
  ['home','工作台',Home],['hotspots','热点雷达',Flame],['topics','选题发现',Compass],
  ['works','作品库',Files],['editor','创作空间',PenLine],['visual','视觉工作台',Images],
  ['publish','发布中心',Send],['calendar','内容日历',CalendarDays],
  ['insights','效果复盘',BarChart3],['library','素材库',Library],['settings','偏好与连接',Settings2]
];
const initialHotspots=[
  {id:1,title:'AI 编程工具正在从辅助补全转向任务协作',source:'Hacker News',category:'AI / 开发',time:'2 小时前',signal:'持续讨论',score:'高',reason:'与个人开发者和效率工具受众直接相关',risk:'需核对厂商声明和真实使用体验'},
  {id:2,title:'独立开发者如何判断订阅产品的付费意愿',source:'Reddit',category:'产品增长',time:'4 小时前',signal:'新兴话题',score:'中',reason:'适合输出实践框架',risk:'案例不能直接推断整体市场'},
  {id:3,title:'内容创作者开始重视可信来源与引用透明度',source:'RSS 精选',category:'内容创作',time:'今天',signal:'上升',score:'高',reason:'可转化为实用的内容工作流指南',risk:'需要补充具体公开研究和实例'},
  {id:4,title:'开源 Agent 工具的多角色编排成为社区焦点',source:'GitHub',category:'开源工具',time:'昨天',signal:'稳定关注',score:'中',reason:'适合技术分析长文',risk:'不能用仓库 star 直接推断活跃使用'}
];
const initialWorks=[
  {id:1,title:'AI 时代，个人开发者需要怎样的工作流？',status:'写作中',stage:'正文与配图',platform:'公众号 · 知乎',date:'今天'},
  {id:2,title:'让技术文章更可信：从观点到证据的写作方法',status:'待审核',stage:'事实与来源',platform:'公众号',date:'昨天'},
  {id:3,title:'一个人维护产品，如何持续发现真实需求',status:'准备发布',stage:'平台稿',platform:'知乎',date:'本周'}
];
const defaultShots=[
  {id:'cover',name:'文章封面',anchor:'作品标题前',why:'建立统一视觉识别',kind:'封面',ratio:'2.35:1'},
  {id:'workflow',name:'正文配图 · 工作流',anchor:'02 · 工作流如何改变',why:'把抽象协作过程变得直观',kind:'解释图',ratio:'16:9'},
  {id:'evidence',name:'正文配图 · 证据流程',anchor:'04 · 怎样判断结果可信',why:'将检查步骤表达为可理解结构',kind:'流程图',ratio:'16:9'}
];
const artThemes=[
  {id:0,name:'暖纸编辑',tone:'warm',subtitle:'Editorial / Paper'},
  {id:1,name:'靛蓝构成',tone:'indigo',subtitle:'Abstract / Geometry'},
  {id:2,name:'自然科技',tone:'sage',subtitle:'Soft / Organic'}
];

function Art({tone='warm',compact=false}) {
  return <div className={'dv-art dv-art-'+tone+(compact?' compact':'')} aria-label="抽象视觉效果示意">
    <div className="dv-art-grid"/><div className="dv-art-orb"/><div className="dv-art-ring"/>
    <span className="dv-art-small">CREATOR / VISUAL STORY</span>
    <div className="dv-art-type"><span>Good ideas.</span><strong>Made visible.</strong></div>
    <span className="dv-art-bottom">01 — EDITORIAL SERIES</span>
  </div>;
}
function Pill({children,tone=''}){return <span className={'dv-pill '+tone}>{children}</span>;}
function Section({eyebrow,title,desc,action}){return <header className="dv-section"><div><span className="dv-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{desc}</p></div>{action&&<div>{action}</div>}</header>;}
function Empty(){return <div className="dv-empty">没有符合条件的内容。试试更换筛选或搜索词。</div>;}

export default function CreatorV2Preview(){
  const [page,setPage]=useState('home');
  const [mobileMenu,setMobileMenu]=useState(false);
  const [notice,setNotice]=useState('');
  const [hotspots,setHotspots]=useState(initialHotspots);
  const [hotFilter,setHotFilter]=useState('全部');
  const [hotQuery,setHotQuery]=useState('');
  const [selectedHot,setSelectedHot]=useState(1);
  const [topic,setTopic]=useState(initialHotspots[0].title);
  const [works,setWorks]=useState(initialWorks);
  const [workFilter,setWorkFilter]=useState('全部');
  const [workQuery,setWorkQuery]=useState('');
  const [platform,setPlatform]=useState('主稿');
  const [editorPanel,setEditorPanel]=useState('visual');
  const [visualMode,setVisualMode]=useState('full');
  const [shotId,setShotId]=useState('cover');
  const [selectedVariant,setSelectedVariant]=useState(0);
  const [adopted,setAdopted]=useState({});
  const [briefText,setBriefText]=useState('');
  const [style,setStyle]=useState('暖纸编辑');
  const [checks,setChecks]=useState({});
  const [calendarMode,setCalendarMode]=useState('周');
  const [assetFilter,setAssetFilter]=useState('全部');
  const [settingsTab,setSettingsTab]=useState('创作者画像');

  const active= navigation.find(n=>n[0]===page)||navigation[0];
  const currentHot=hotspots.find(h=>h.id===selectedHot)||hotspots[0];
  const selectedShot=defaultShots.find(s=>s.id===shotId)||defaultShots[0];
  const visibleShots=visualMode==='cover'?defaultShots.slice(0,1):defaultShots;
  const filteredHot=useMemo(()=>hotspots.filter(h=>(hotFilter==='全部'||(hotFilter==='已关注'?h.followed:h.category.includes(hotFilter)))&&h.title.toLowerCase().includes(hotQuery.toLowerCase())),[hotspots,hotFilter,hotQuery]);
  const filteredWorks=useMemo(()=>works.filter(w=>(workFilter==='全部'||workFilter===w.status)&&w.title.includes(workQuery)),[works,workFilter,workQuery]);
  const announce=(message)=>{setNotice(message);};
  const go=(key)=>{setPage(key);setMobileMenu(false);setNotice('');};
  const createWork=(title)=>{const t=title||'未命名的新作品';setWorks(prev=>[{id:Date.now(),title:t,status:'写作中',stage:'刚刚创建',platform:'公众号 · 知乎',date:'今天'},...prev]);setTopic(t);go('editor');announce('演示：已创建本地示例作品，未写入真实数据库。');};
  const adopt=()=>{setAdopted(old=>({...old,[shotId]:selectedVariant}));announce('已在原型中采用该候选，正文与阅读预览同步更新（演示）。');};
  const runMock=()=>{setSelectedVariant((old)=>(old+1)%artThemes.length);announce('已模拟生成一个新候选版本。设计预览不会调用模型或计费。');};

  return <div className="dv-shell">
    <aside className={'dv-sidebar'+(mobileMenu?' open':'')}>
      <div className="dv-brand"><span className="dv-brand-mark">C</span><div><strong>Content Studio</strong><small>YOUR CREATIVE SPACE</small></div><button className="dv-mobile-close" onClick={()=>setMobileMenu(false)} aria-label="关闭导航"><X size={19}/></button></div>
      <div className="dv-sidebar-label">工作区 / WORKSPACE</div>
      <nav aria-label="Creator V2 设计导航">{navigation.map(([id,name,Icon],i)=><button key={id} className={'dv-nav-item'+(page===id?' active':'')+(i===5?' divider-before':'')} onClick={()=>go(id)}><Icon size={17}/><span>{name}</span>{page===id&&<span className="dv-nav-dot"/>}</button>)}</nav>
      <div className="dv-sidebar-foot"><div className="dv-avatar">C</div><div><strong>独立创作空间</strong><small>V2.2 × V2.3 DESIGN</small></div></div>
    </aside>
    {mobileMenu&&<button className="dv-menu-backdrop" aria-label="关闭导航" onClick={()=>setMobileMenu(false)}/>}
    <div className="dv-body">
      <div className="dv-topbar"><div className="dv-crumb"><button className="dv-menu-toggle" onClick={()=>setMobileMenu(true)} aria-label="打开导航"><Menu size={20}/></button>Creator <ChevronRight size={14}/> {active[1]}</div><div className="dv-top-actions"><span className="dv-preview-label">交互原型 · 示例数据</span><button className="dv-quiet" onClick={()=>go('home')}><Home size={15}/> 返回首页</button></div></div>
      {notice&&<div role="status" className="dv-notice"><Check size={15}/>{notice}<button onClick={()=>setNotice('')} aria-label="关闭提示"><X size={14}/></button></div>}
      <main className="dv-content">
        {page==='home'&&<>
          <Section eyebrow="TODAY / 创作节奏" title="今天，继续把好想法写出来。" desc="把下一篇文章往前推进，不需要先学习复杂的工作流。" action={<button className="dv-primary" onClick={()=>createWork('我的新作品')}><Plus size={16}/> 新建作品</button>}/>
          <div className="dv-hero"><div><Pill tone="light">当前正在创作</Pill><h2>{works[0].title}</h2><p>主稿进行中 · 下一步：核查证据，完善配图</p><button className="dv-primary light" onClick={()=>go('editor')}>继续创作 <ArrowRight size={16}/></button></div><div className="dv-hero-art"><Art compact tone="warm"/></div></div>
          <div className="dv-two"><section className="dv-card"><div className="dv-card-head"><h3>接下来要处理</h3><span>2 件重要事项</span></div><button className="dv-list-action" onClick={()=>{setEditorPanel('review');go('editor');}}><AlertCircle size={19}/> 文章中的关键判断需要来源核查 <ChevronRight size={17}/></button><button className="dv-list-action" onClick={()=>go('visual')}><Images size={19}/> 封面和正文图仍待挑选 <ChevronRight size={17}/></button></section><section className="dv-card"><div className="dv-card-head"><h3>为你发现的内容线索</h3><button onClick={()=>go('hotspots')} className="dv-link">全部热点 <ArrowRight size={14}/></button></div>{hotspots.slice(0,3).map(h=><button className="dv-story-mini" key={h.id} onClick={()=>{setSelectedHot(h.id);go('hotspots')}}><span>{h.title}</span><small>{h.source} · {h.time}</small></button>)}</section></div>
        </>}
        {page==='hotspots'&&<>
          <Section eyebrow="RADAR / 多源监控" title="热点雷达" desc="先看发生了什么，再判断值不值得写。热点只是线索，不等于已核实事实。" action={<button className="dv-secondary" onClick={()=>announce('设计演示：真实版将显示 RSS 同步时间和逐源失败状态。')}><RefreshCw size={16}/> 刷新信源</button>}/>
          <div className="dv-filterbar">{['全部','AI / 开发','内容创作','产品增长','已关注'].map(f=><button key={f} className={hotFilter===f?'active':''} onClick={()=>setHotFilter(f)}>{f}</button>)}<label className="dv-search"><Search size={15}/><input value={hotQuery} onChange={e=>setHotQuery(e.target.value)} placeholder="搜索热点"/></label></div>
          <div className="dv-main-aside"><div className="dv-card dv-no-pad">{filteredHot.length?filteredHot.map(h=><button key={h.id} className={'dv-hot-row'+(selectedHot===h.id?' selected':'')} onClick={()=>setSelectedHot(h.id)}><span className="dv-hot-icon"><Flame size={19}/></span><span className="dv-hot-title"><strong>{h.title}</strong><small>{h.source} · {h.category} · {h.time}</small></span><Pill>{h.signal}</Pill><ChevronRight size={16}/></button>):<Empty/>}</div><aside className="dv-card dv-detail"><span className="dv-eyebrow">SIGNAL DETAIL</span><Pill tone="soft">示例 · 未完成事实核验</Pill><h2>{currentHot.title}</h2><p>{currentHot.reason}</p><h4>写作价值</h4><p>建议先核对来源，再提炼对目标读者有用的观察与可操作建议。</p><h4>证据缺口</h4><p>{currentHot.risk}</p><div className="dv-actions"><button className="dv-primary" onClick={()=>{setTopic(currentHot.title);go('topics');}}>收为选题候选 <ArrowRight size={15}/></button><button className="dv-secondary" onClick={()=>{setHotspots(old=>old.map(h=>h.id===selectedHot?{...h,followed:!h.followed}:h));}}><Bookmark size={15}/>{currentHot.followed?'取消关注':'关注话题'}</button></div></aside></div>
        </>}
        {page==='topics'&&<>
          <Section eyebrow="EDITORIAL / 选题判断" title="从线索，走向值得写的文章" desc="先回答读者有什么真实问题，再决定文章观点和需要补充的证据。"/>
          <div className="dv-main-aside dv-topics"><section className="dv-card"><label className="dv-label">本次讨论的选题</label><input className="dv-input dv-topic-title" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="写下一个你想讨论的问题"/><div className="dv-stat-row"><span><BookOpen size={15}/> 目标读者：个人开发者与内容创作者</span><span><ShieldCheck size={15}/> 证据：待核实</span></div><h3>推荐切入角度</h3><p className="dv-text">不只盘点工具，而是帮助读者建立一套可检验、可复用的个人实践方法。</p><h3>创作前还需确认</h3><div className="dv-evidence"><AlertCircle size={18}/><span>厂商能力说明、社区案例、实际部署条件需要逐条核对。</span></div><div className="dv-actions"><button className="dv-primary" onClick={()=>createWork(topic)}>开始写作 <ArrowRight size={15}/></button><button className="dv-secondary" onClick={()=>announce('已将选题加入本地演示候选，真实保存待开发接入。')}>保存选题</button></div></section><aside className="dv-card"><h3>选题助手</h3><p>我可以协助你梳理读者的问题、文章结构和证据来源，而不会把推断写成事实。</p><div className="dv-ai-card"><Sparkles size={19}/><div><strong>推荐下一步</strong><p>先列出 3 个可核实的关键判断，再形成简洁的大纲。</p></div></div><button className="dv-secondary full" onClick={()=>announce('设计演示：正式版将通过已有的选题 Agent 接口生成大纲，并以建议形式供审阅。')}>生成大纲建议 <ArrowRight size={15}/></button></aside></div>
        </>}
        {page==='works'&&<>
          <Section eyebrow="LIBRARY / 作品生命周期" title="作品库" desc="一篇作品统一管理主稿、平台稿、配图与交付记录。" action={<button className="dv-primary" onClick={()=>createWork('我的新作品')}><Plus size={16}/> 新建作品</button>}/>
          <div className="dv-filterbar">{['全部','写作中','待审核','准备发布'].map(x=><button key={x} className={workFilter===x?'active':''} onClick={()=>setWorkFilter(x)}>{x}</button>)}<label className="dv-search"><Search size={16}/><input placeholder="搜索作品" value={workQuery} onChange={e=>setWorkQuery(e.target.value)}/></label></div>
          <div className="dv-works">{filteredWorks.length?filteredWorks.map(w=><button className="dv-work-card" key={w.id} onClick={()=>{setTopic(w.title);go('editor')}}><div className="dv-work-icon"><PenLine size={21}/></div><div><Pill tone="soft">{w.status}</Pill><h3>{w.title}</h3><p>{w.platform} · {w.stage}</p><small>最近编辑：{w.date}</small></div><ChevronRight size={19}/></button>):<Empty/>}</div>
        </>}
        {page==='editor'&&<>
          <Section eyebrow="COMPOSE / 作品创作" title={works[0].title} desc="自动保存、独立平台稿和审阅建议沿用现有领域模型；本页仅为界面原型。" action={<button className="dv-secondary" onClick={()=>go('publish')}>发布准备 <ArrowRight size={15}/></button>}/>
          <div className="dv-platform-tabs">{['主稿','公众号','知乎'].map(p=><button key={p} className={platform===p?'active':''} onClick={()=>setPlatform(p)}>{p}</button>)}<span>示例内容 · 编辑状态</span></div>
          <div className="dv-editor-layout"><aside className="dv-card dv-outline"><h4>文章大纲</h4><button onClick={()=>announce('已定位到作品开头（演示）。')}>01 · 发生了什么</button><button onClick={()=>announce('已定位到工作流段落（演示）。')}>02 · 工作流如何改变</button><button onClick={()=>announce('已定位到价值分析段落（演示）。')}>03 · 真正有价值的环节</button><button onClick={()=>announce('已定位到结论段落（演示）。')}>04 · 怎样判断结果可信</button><div className="dv-divider"/><h4>作品状态</h4><Pill tone="soft">事实待核查</Pill><p>本地演示数据；此设计路由不会写入真实文章。</p></aside>
          <article className="dv-paper"><span className="dv-eyebrow">{platform} / EDITORIAL DRAFT</span><h2>AI 时代，个人开发者需要怎样的工作流？</h2><p className="dv-paper-lead">真正的效率不是让 AI 自动完成一切，而是知道哪些环节值得交给它，以及如何验证结果。</p><h3>01 / 从工具到协作</h3><p>过去，我们关注自动补全和代码建议。如今，工作流开始围绕任务拆解、证据检查以及人机协作来组织。</p>{adopted.cover!==undefined?<Art compact tone={artThemes[adopted.cover].tone}/>:<button className="dv-slot" onClick={()=>{setShotId('cover');setEditorPanel('visual');}}> <Images size={19}/> 封面尚未采用 · 点击规划 <Plus size={15}/></button>}<h3>02 / 不让生成取代判断</h3><p>好的内容需要明确读者问题、论点来源，以及哪些结论仍然属于推断。Agent 可以帮助准备，但关键判断属于作者。</p>{adopted.workflow!==undefined?<Art compact tone={artThemes[adopted.workflow].tone}/>:<button className="dv-slot" onClick={()=>{setShotId('workflow');setEditorPanel('visual');}}> <Images size={19}/> 这里适合一张协作流程解释图 <Plus size={15}/></button>}<h3>03 / 记录、验证与复用</h3><p>一篇完成的文章，应该留下经过核实的资料、可以调整的表达和真正适合下一篇的经验。</p></article>
          <aside className="dv-card dv-assistant"><div className="dv-assistant-tabs"><button className={editorPanel==='visual'?'active':''} onClick={()=>setEditorPanel('visual')}>AI 配图</button><button className={editorPanel==='review'?'active':''} onClick={()=>setEditorPanel('review')}>事实审核</button></div>{editorPanel==='visual'?<><h3>先规划，再生成</h3><p>建议为作品配置 1 张封面 + 2 张必要的解释图。无需每一节都塞图片。</p><div className="dv-segments">{[['cover','只做封面'],['full','完整配图'],['selection','指定段落']].map(([id,name])=><button key={id} className={visualMode===id?'active':''} onClick={()=>setVisualMode(id)}>{name}</button>)}</div><div className="dv-plan-list">{visibleShots.map(s=><button key={s.id} className={shotId===s.id?'active':''} onClick={()=>setShotId(s.id)}><Images size={16}/><span><strong>{s.name}</strong><small>{s.anchor} · {s.why}</small></span><ChevronRight size={14}/></button>)}</div><div className="dv-budget">建议张数：{visibleShots.length} · 生成前需确认费用和对外发送范围</div><button className="dv-primary full" onClick={()=>go('visual')}>进入配图工作台 <ArrowRight size={15}/></button></>:<><h3>事实与来源核查</h3><p>这部分应该直接显示缺少哪些来源、哪些是推断，而不是只提供一个“AI 分数”。</p><div className="dv-evidence"><AlertCircle size={18}/> 有 2 项判断待引用来源</div><button className="dv-secondary full" onClick={()=>announce('演示：核查请求应调用已有 Agent 接口，返回可单独采纳的修改建议。')}>生成核查建议</button></>}</aside></div>
        </>}
        {page==='visual'&&<>
          <Section eyebrow="VISUAL STUDIO / 作品视觉制作" title="视觉工作台" desc="按文章位置管理每张图；候选图可以比较，但只有明确采用才进入正文。" action={<button className="dv-secondary" onClick={()=>go('editor')}>返回文章 <ArrowRight size={15}/></button>}/>
          <div className="dv-visual-layout"><aside className="dv-card dv-shot-list"><div className="dv-card-head"><h3>配图位置</h3><Pill>3 处</Pill></div>{defaultShots.map(s=><button key={s.id} className={'dv-shot'+(shotId===s.id?' active':'')} onClick={()=>{setShotId(s.id);setSelectedVariant(adopted[s.id]??0);}}><div className="dv-shot-thumb"><Images size={17}/></div><div><strong>{s.name}</strong><small>{s.anchor}</small><small>{adopted[s.id]!==undefined?'已采用 · 可替换':'等待挑选候选'}</small></div></button>)}</aside>
          <section className="dv-card dv-visual-center"><div className="dv-visual-heading"><div><span className="dv-eyebrow">{selectedShot.kind} · {selectedShot.ratio}</span><h3>{selectedShot.name}</h3><p>{selectedShot.why}</p></div><Pill tone={adopted[shotId]!==undefined?'success':'soft'}>{adopted[shotId]!==undefined?'已采用':'候选待确认'}</Pill></div><Art tone={artThemes[selectedVariant].tone}/><div className="dv-variant-top"><h4>选择候选版本</h4><span>选择仅改变预览，不会写入文章</span></div><div className="dv-variants">{artThemes.map(t=><button key={t.id} className={selectedVariant===t.id?'active':''} onClick={()=>setSelectedVariant(t.id)}><Art compact tone={t.tone}/><strong>{t.name}</strong><small>{t.subtitle}</small>{adopted[shotId]===t.id&&<Pill tone="success">正在使用</Pill>}</button>)}</div><div className="dv-actions"><button className="dv-primary" onClick={adopt}><Check size={16}/> 采用这张图</button><button className="dv-secondary" onClick={runMock}><RefreshCw size={15}/> 模拟重新生成</button><button className="dv-secondary" onClick={()=>go('editor')}><Eye size={15}/> 返回正文预览</button></div></section>
          <aside className="dv-card dv-visual-tools"><h3>创作意图与修改</h3><p>为当前图片选择风格、给出修改要求。改图应生成新版本，不覆盖原图。</p><label className="dv-label">系列视觉风格<select className="dv-input" value={style} onChange={e=>setStyle(e.target.value)}>{artThemes.map(x=><option key={x.id}>{x.name}</option>)}</select></label><label className="dv-label">自然语言改图<textarea value={briefText} onChange={e=>setBriefText(e.target.value)} placeholder="例如：去掉装饰线条，画面留白更多，主体向右移动……"/></label><button className="dv-secondary full" onClick={()=>{if(!briefText.trim()){announce('请先描述希望改变的部分。');return;}runMock();}}><WandSparkles size={16}/> 模拟生成修改版本</button><div className="dv-divider"/><h4>关于这张图</h4><p>所在位置：{selectedShot.anchor}</p><p>用途：{selectedShot.why}</p><p>发布前仍须确认事实、图片使用权与平台裁切。</p><div className="dv-budget">模型选择、真实费用、重试策略和图片历史应放到高级设置中。</div></aside></div>
        </>}
        {page==='publish'&&<>
          <Section eyebrow="DELIVERY / 渠道交付" title="发布中心" desc="设计完成、导出、进入草稿箱和真实发布是四个不同状态。"/>
          <div className="dv-two">{['微信公众号','知乎'].map(ch=><section className="dv-card" key={ch}><div className="dv-card-head"><h3>{ch}</h3><Pill tone="soft">待完成检查</Pill></div><p>当前作品：{works[0].title}</p>{['事实与引用已核查','隐私信息已核查','文字及图片使用权已核查','已在目标平台检查排版'].map((item,i)=><label className="dv-check" key={i}><input type="checkbox" checked={!!checks[ch+'-'+i]} onChange={e=>setChecks(old=>({...old,[ch+'-'+i]:e.target.checked}))}/>{item}</label>)}<div className="dv-actions"><button className="dv-primary" onClick={()=>announce('这里只模拟准备流程，绝不会推送真实平台或宣称已发布。')}>检查交付准备</button><button className="dv-secondary" onClick={()=>{setPlatform(ch==='微信公众号'?'公众号':'知乎');go('editor')}}>查看稿件</button></div></section>)}</div>
        </>}
        {page==='calendar'&&<>
          <Section eyebrow="PLANNING / 内容节奏" title="内容日历" desc="内容计划跟随作品，不会在未授权时自动发布。" action={<div className="dv-segments">{['周','月'].map(x=><button className={calendarMode===x?'active':''} key={x} onClick={()=>setCalendarMode(x)}>{x}视图</button>)}</div>}/>
          <div className="dv-card"><div className="dv-card-head"><h3>本周计划</h3><span>示例排期</span></div><div className={'dv-calendar '+(calendarMode==='月'?' month':'')}>{Array.from({length:calendarMode==='月'?28:7},(_,i)=><button key={i} onClick={()=>announce('已选择第 '+(i+1)+' 天；日历排期为示意交互。')}><small>{calendarMode==='月'?i+1:['周一','周二','周三','周四','周五','周六','周日'][i]}</small>{i%7===1&&<span>资料核查</span>}{i%7===3&&<span>正文定稿</span>}{i%7===5&&<span>发布准备</span>}</button>)}</div></div>
        </>}
        {page==='insights'&&<>
          <Section eyebrow="LEARNING / 可验证复盘" title="效果复盘" desc="数据缺失时明确显示未连接，不用样例数值假装真实增长。"/>
          <div className="dv-two"><section className="dv-card"><h3>当前数据状态</h3><div className="dv-ai-card"><AlertCircle size={22}/><div><strong>尚未连接真实平台统计</strong><p>需要接入有效的公众号或知乎账号数据后，才能分析阅读、互动与发布表现。</p></div></div><button className="dv-secondary" onClick={()=>go('settings')}>查看账号连接 <ArrowRight size={15}/></button></section><section className="dv-card"><h3>写作经验库</h3><p>只有确认过的修改规则才会进入个人写作画像。生成建议不能直接修改全局偏好。</p><button className="dv-secondary" onClick={()=>announce('风格学习建议需要真实文章修订和人工确认；当前为界面演示。')}>查看学习机制</button></section></div>
        </>}
        {page==='library'&&<>
          <Section eyebrow="MATERIALS / 可信素材" title="素材库" desc="把公开线索、文章引用、图片与历史稿件放在可追溯的资产视图中。"/>
          <div className="dv-filterbar">{['全部','图片','来源','文章'].map(x=><button key={x} className={assetFilter===x?'active':''} onClick={()=>setAssetFilter(x)}>{x}</button>)}<button className="dv-secondary" onClick={()=>announce('这是 UI 原型。真实上传需连接现有素材库 API。')}><Plus size={15}/> 添加素材</button></div><div className="dv-assets">{[{type:'图片',name:'暖纸编辑系列 · 封面',tone:'warm'},{type:'图片',name:'靛蓝科技 · 正文视觉',tone:'indigo'},{type:'来源',name:'AI 开发工作流参考资料',tone:'sage'},{type:'文章',name:'我的写作风格范例',tone:'warm'}].filter(x=>assetFilter==='全部'||x.type===assetFilter).map((x,i)=><button className="dv-asset" key={i} onClick={()=>announce('已打开「'+x.name+'」的模拟素材详情。')}><Art compact tone={x.tone}/><strong>{x.name}</strong><small>{x.type} · 关联作品可追溯</small></button>)}</div>
        </>}
        {page==='settings'&&<>
          <Section eyebrow="PREFERENCES / 简单但可控" title="偏好与连接" desc="平时只展示创作偏好，模型、信源、渠道与预算等高级配置按需进入。"/>
          <div className="dv-filterbar">{['创作者画像','模型连接','发布账号','热点信源','费用与授权'].map(x=><button className={settingsTab===x?'active':''} key={x} onClick={()=>setSettingsTab(x)}>{x}</button>)}</div><div className="dv-card dv-settings"><h3>{settingsTab}</h3>{settingsTab==='创作者画像'?<><label className="dv-label">内容方向<input className="dv-input" defaultValue="AI 工具、个人开发者、内容创作"/></label><label className="dv-label">希望写给谁<input className="dv-input" defaultValue="希望更高效地做出好产品的人"/></label><label className="dv-label">表达偏好<textarea defaultValue="直接、克制、具体，用实际证据支撑判断，减少套话。"/></label><button className="dv-primary" onClick={()=>announce('仅展示 UI 交互；没有修改真实创作者画像。')}>保存偏好演示</button></>:<><p>此区域将在正式实施时沿用 Content Studio 现有的服务与账号配置，不在原型中收集密钥或显示敏感信息。</p><div className="dv-evidence"><ShieldCheck size={20}/> 调用付费模型和正式发布之前，必须显示服务、范围与授权状态。</div><button className="dv-secondary" onClick={()=>announce('演示模式：未读取真实凭据，也未保存配置。')}>查看连接说明</button></>}</div>
        </>}
      </main>
      <nav className="dv-bottom-nav" aria-label="移动端快捷导航">{[['home','工作台',Home],['hotspots','热点',Flame],['topics','选题',Compass],['works','作品',Files],['visual','配图',Images]].map(([id,name,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>go(id)}><Icon size={18}/><small>{name}</small></button>)}<button onClick={()=>setMobileMenu(true)}><Menu size={18}/><small>更多</small></button></nav>
    </div>
  </div>;
}
