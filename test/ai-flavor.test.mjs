import test from 'node:test';
import assert from 'node:assert/strict';
import {scanAiFlavor,AI_FLAVOR_MARKERS} from '../src/ai-flavor.mjs';

test('clean text scores zero with honest limitation note',()=>{
  const r=scanAiFlavor('# 真实记录\n\n昨天把部署脚本改完了，服务恢复正常。');
  assert.equal(r.score,0);assert.equal(r.level,'clean');assert.equal(r.hits.length,0);
  assert.match(r.hint,/不能证明/);
});

test('template phrasing is detected with labels and density score',()=>{
  const md='在当今快速发展的时代，值得注意的是这一变化。综上所述，让我们共同拥抱新范式。这不仅是一种工具，更是一种思维方式。'.repeat(3);
  const r=scanAiFlavor(md);
  assert.equal(r.level,'high');
  const labels=r.hits.map(h=>h.label);
  for(const want of ['宏大开场','填充式过渡','模板化总结','口号式呼告','排比堆砌'])
    assert.ok(labels.includes(want),'missing '+want);
  assert.ok(r.score>0&&r.score<=100);
  assert.ok(r.hits.every(h=>h.excerpt.length<=60));
});

test('code blocks are exempt from tone scanning',()=>{
  const code='```js\n// 综上所述，让我们共同拥抱\n```';
  const r=scanAiFlavor('正文没有模板词。\n'+code);
  assert.equal(r.hits.length,0);
  assert.ok(r.scannedChars>0);
});

test('marker list itself is original and bounded',()=>{
  assert.ok(AI_FLAVOR_MARKERS.length>=5&&AI_FLAVOR_MARKERS.length<=20);
  for(const m of AI_FLAVOR_MARKERS){
    assert.ok(m.id&&m.label&&m.pattern instanceof RegExp);
    new RegExp(m.pattern.source,'g').test('');
  }
});
