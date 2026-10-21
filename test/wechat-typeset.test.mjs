import test from 'node:test';
import assert from 'node:assert/strict';
import {WECHAT_THEMES,wechatThemeById,renderWechatHtml,cjkSpacing,movePunctuationOutOfEmphasis,externalLinksToFootnotes,validateWechatHtml} from '../src/wechat-typeset.mjs';

test('themes carry complete inline-style tokens and resolve by id',()=>{
  for(const t of WECHAT_THEMES){
    assert.equal(wechatThemeById(t.id).name,t.name);
    for(const key of ['root','h1','h2','p','blockquote','strong','code','img','footnote'])
      assert.ok(t.tokens[key]&&t.tokens[key].includes(':'),t.id+' token '+key);
  }
  assert.equal(wechatThemeById('missing'),null);
});

test('external links become visible text plus numbered footnotes section',()=>{
  const {html,notes}=externalLinksToFootnotes('<p>见 <a href="https://example.com/a">来源一</a> 与 <a href="https://example.com/b">来源二</a>。</p>');
  assert.match(html,/来源一<sup>\[1\]<\/sup>/);
  assert.match(html,/来源二<sup>\[2\]<\/sup>/);
  assert.match(html,/参考链接/);
  assert.match(html,/1\. 来源一：https:\/\/example\.com\/a/);
  assert.equal(notes.length,2);
  const bare=externalLinksToFootnotes('<p>没有外链</p>');
  assert.equal(bare.notes.length,0);
  assert.ok(!bare.html.includes('参考链接'));
});

test('trailing CJK punctuation moves out of emphasis tags',()=>{
  assert.equal(
    movePunctuationOutOfEmphasis('<p><strong>这个结论。</strong></p>'),
    '<p><strong>这个结论</strong>。</p>');
  assert.equal(
    movePunctuationOutOfEmphasis('<em>前半，后半。</em>'),
    '<em>前半，后半</em>。');
  assert.equal(movePunctuationOutOfEmphasis('<strong>无标点</strong>'),'<strong>无标点</strong>');
});

test('cjk spacing inserts gaps between CJK and latin but skips code blocks',()=>{
  assert.equal(cjkSpacing('<p>用Node.js构建</p>'),'<p>用 Node.js 构建</p>');
  assert.equal(cjkSpacing('<p>提升3倍性能</p>'),'<p>提升 3 倍性能</p>');
  const code=cjkSpacing('<pre><code>const a=1;// 保持原样</code></pre>');
  assert.equal(code,'<pre><code>const a=1;// 保持原样</code></pre>');
});

test('renderWechatHtml produces themed document with inlined styles and footnotes',()=>{
  const md='# 标题\n\n正文引用了 [外部证据](https://example.com/x)。<blockquote>引用</blockquote>\n\n**加粗结论。**\n\n```js\nconst noSpacing=1;// CJK注释\n```';
  const r=renderWechatHtml(md,{themeId:'cool-tech'});
  assert.equal(r.themeId,'cool-tech');
  assert.ok(r.html.startsWith('<!doctype html>'));
  assert.ok(r.html.includes('class="wechat-article"'),'root section');
  assert.ok(r.html.includes('<h1 style="'),'h1 themed');
  assert.ok(r.html.includes('<blockquote style="'),'blockquote themed');
  assert.ok(r.html.includes('外部证据<sup>[1]</sup>'),'footnote sup');
  assert.ok(r.html.includes('参考链接'),'footnote section');
  assert.match(r.html,/加粗结论<\/strong>。/,'punctuation out of strong');
  assert.ok(r.html.includes('const noSpacing=1;// CJK注释'),'code block untouched');
  assert.ok(r.validation.ok,'validation passes for themed output');
  assert.equal(r.footnotes.length,1);
});

test('validation rejects scripts, style tags, iframes and external images',()=>{
  assert.equal(validateWechatHtml('<p>ok</p>').ok,true);
  for(const [bad,needle] of [
    ['<script>alert(1)</script>','script'],
    ['<style>b{}</style>','style'],
    ['<iframe src="https://x"></iframe>','iframe'],
    ['<img src="https://cdn.example.com/a.png">','外链图片'],
  ]){
    const v=validateWechatHtml(bad);
    assert.equal(v.ok,false,bad);
    assert.ok(v.errors.some(e=>e.includes(needle)),bad+' message');
  }
});
