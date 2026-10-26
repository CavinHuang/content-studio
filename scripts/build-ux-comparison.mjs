import { readFile, writeFile } from 'node:fs/promises'

const checks = JSON.parse(await readFile('docs/ux/implementation/aligned/checks.json', 'utf8'))
const names = [
  '文稿与段落建议',
  '排版面板',
  '创作方案',
  '素材列表',
  '收集素材',
  '多来源热点',
  '来源管理',
  '热点发起创作',
  '选择发布平台',
  '发布前交付',
  '两类视频入口',
  '素材分镜',
  '配音与字幕',
  '代码动画',
  '紧凑桌面',
  '手机文稿',
  '手机 Agent',
  '手机热点',
]
const data = JSON.stringify(
  checks.screens.map((screen) => ({
    ...screen,
    name: screen.name ?? names[Number(screen.id.slice(0, 2)) - 1],
  })),
).replace(/</g, '\\u003c')
await writeFile(
  'docs/ux/alignment.html',
  `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Content Studio · 设计与实现对照</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;color:#303729;background:#fffcf7;font:14px/1.7 'Segoe UI','Microsoft YaHei',sans-serif}header{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:20px 28px;background:#f2eee5;border-bottom:1px solid #dddccf}header strong{font-size:18px;font-weight:600}nav{margin-left:auto;display:flex;gap:20px}a{color:#303729;text-underline-offset:4px}main{padding:24px 28px 48px;max-width:2000px;margin:auto}h1{font-size:28px;margin:0 0 8px}p{margin:8px 0;color:#606b57}.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:24px 0}select,button{font:inherit;min-height:40px;border:1px solid #dddccf;border-radius:6px;background:#fffcf7;color:#303729;padding:8px 12px}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}select{min-width:230px}.status{margin-left:auto;font-size:12px;color:#606b57}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0;background:#f2eee5;border:1px solid #dddccf;border-radius:8px;overflow:hidden}figcaption{padding:10px 14px;display:flex;justify-content:space-between;gap:10px;background:#fffcf7}figure>a{display:flex;align-items:flex-start;justify-content:center;min-height:220px;padding:8px}img{display:block;width:100%;height:auto;max-height:80vh;object-fit:contain;object-position:top}aside{margin-top:24px;border-left:3px solid #303729;padding:4px 16px;color:#606b57}:focus-visible{outline:2px solid #303729;outline-offset:3px}@media(max-width:850px){.pair{grid-template-columns:1fr}main{padding:20px 16px}.status{width:100%;margin:0}header{padding:18px}nav{margin:0}}
</style></head><body><header><strong>Content Studio</strong><span>设计系统 v2.3 · 设计稿与真实实现</span><nav><a href="index.html">设计总览</a><a href="VISUAL-ALIGNMENT.md">校准说明</a><a href="PAGE-COVERAGE.md">页面覆盖</a><a href="design-system.html">Token 手册</a></nav></header><main><p>当前视觉基准：设计稿配色 + Tailwind / shadcn 默认字体、间距和控件尺寸。左侧效果图作为颜色、布局与流程参考。</p><h1>逐页对照，查看落地细节。</h1><p>左侧为原始页面效果图或通用视觉参考，右侧为真实 Electron 窗口。点击图片可打开原尺寸。实拍使用隔离的 Mock 数据。</p><div class="controls"><button id="prev" aria-label="上一页">←</button><select id="screen" aria-label="选择对照界面"></select><button id="next" aria-label="下一页">→</button><span class="status" id="status" role="status"></span></div><p id="basis" class="basis" aria-live="polite"></p><div class="pair"><figure><figcaption><strong id="reference-label">原设计稿</strong><span id="reference-name"></span></figcaption><a id="reference-link" target="_blank" rel="noopener"><img id="reference" alt=""></a></figure><figure><figcaption><strong>当前实现</strong><span id="actual-name"></span></figcaption><a id="actual-link" target="_blank" rel="noopener"><img id="actual" alt=""></a></figure></div><aside>以最新交互规范为准：视频两条路线独立，发布平台由用户勾选。Mock、失败提示与键盘焦点保留；配图采用本地 SVG，静态生成稿中的照片与示例数字未逐像素复制。手机参考图包含多个画面，实拍按单个窗口展示。</aside></main><script>
const screens=${data};const select=document.getElementById('screen');let index=Number(new URLSearchParams(location.search).get('screen'))||0;index=Math.max(0,Math.min(screens.length-1,index));screens.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=String(i+1).padStart(2,'0')+' · '+s.name;select.append(o)});function render(){const s=screens[index];select.value=index;document.getElementById('basis').textContent='对照依据：'+(s.basis||'页面设计稿');document.getElementById('reference-label').textContent=s.basis?.includes('无独立')?'通用视觉参考':'页面设计参考';for(const [kind,path] of [['reference','assets/'+s.reference],['actual','implementation/aligned/'+s.id+'.png']]){document.getElementById(kind).src=path;document.getElementById(kind).alt=s.name+' · '+(kind==='reference'?'设计稿':'当前实现');document.getElementById(kind+'-link').href=path}document.getElementById('reference-name').textContent=s.reference;document.getElementById('actual-name').textContent=s.width+' × '+s.height;document.getElementById('status').textContent='${checks.date} · '+(s.horizontalOverflow?'存在横向溢出':'无横向溢出')+' · '+(s.agentHeaderOverlap?'标题重叠':'标题无重叠')+' · '+(s.dialogOverflow?'弹窗越界':'弹窗未越界');document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===screens.length-1}select.onchange=()=>{index=Number(select.value);render()};document.getElementById('prev').onclick=()=>{index--;render()};document.getElementById('next').onclick=()=>{index++;render()};render();
</script></body></html>
`,
)
console.log('Saved docs/ux/alignment.html with', checks.screens.length, 'screen pairs')
