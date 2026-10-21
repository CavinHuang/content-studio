import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestStyleProfile} from '../src/illustration-style.mjs';

test('too-short text refuses to fabricate a profile',()=>{
  const r=suggestStyleProfile('太短了');
  assert.equal(r.profile,null);
  assert.match(r.reason,/太短/);
});

test('tech-leaning text maps to cool palette with entity-driven name',()=>{
  const md='这篇讲 Agent 架构。模型层的算法要考虑系统性能，接口协议决定了数据部署方式。'.repeat(6)+'Agent 架构与模型系统是核心。';
  const r=suggestStyleProfile(md);
  assert.equal(r.profile.palette,'#2d5379 / #7d9cbf / #f0f5fa');
  assert.match(r.profile.mood,/冷静/);
  assert.ok(r.basis.some(b=>b.includes('词汇倾向')),'basis explains word lean');
  assert.ok(r.reason.includes('建议稿'));
});

test('life-leaning text maps to warm palette',()=>{
  const md='周末的早餐之后，我们陪家人散步。傍晚的天气适合日常的旅行。'.repeat(6)+'生活需要日常的散步。';
  const r=suggestStyleProfile(md);
  assert.equal(r.profile.palette,'#c9a86a / #8a5a2b / #faf5ec');
  assert.match(r.profile.mood,/温暖/);
});

test('entity names come from latin terms only; pure CJK falls back honestly',()=>{
  const latin='Using Agent architecture with Redis and Kubernetes. Agent Redis Kubernetes systems data model interface protocol deployment.'.repeat(4);
  const r=suggestStyleProfile(latin);
  assert.match(r.profile.name,/Agent|Redis|Kubernetes/,'latin entity in name');
  const pure='我们这个那些问题进行出现。'.repeat(20)+'真正的写作与记录。'.repeat(10);
  const r2=suggestStyleProfile(pure);
  assert.match(r2.profile.name,/正文基调视觉系列/,'pure CJK falls back to generic name');
  assert.ok(r2.basis.some(b=>b.includes('未发现稳定复现')), 'basis states no entities found');
});
