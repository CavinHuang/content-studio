import { describe, it, expect } from 'vitest';
import { validateVariant, xWeightedLength, PLATFORM_RULES } from '../../src/shared/platform-rules';
import type { PlatformKey, VariantDoc } from '../../src/shared/types';

const doc = (platform: PlatformKey, over: Partial<VariantDoc> = {}): VariantDoc => ({
  platform, title: '标题', topics: [], body: '正文', ...over,
});

describe('平台规则（spec §5 硬规则）', () => {
  it('X 加权计数：中文计 2、链接计 23、其余计 1', () => {
    expect(xWeightedLength('abc')).toBe(3);
    expect(xWeightedLength('中文')).toBe(4);
    expect(xWeightedLength('看 https://example.com/a 这篇')).toBe(31); // 看(2)+空格(1)+链接(23)+空格(1)+这(2)+篇(2)
    expect(xWeightedLength('ｆｕｌｌｗｉｄｔｈ')).toBe(18); // 9 个全角 ASCII，每字计 2（计划原值 16 与 9×2 矛盾，按 spec §5 规则修正）
  });
  it('X 校验：无标题、加权 ≤280 才通过', () => {
    expect(validateVariant('x', doc('x', { title: '', body: 'hello' })).ok).toBe(true);
    expect(validateVariant('x', doc('x', { title: '有标题', body: 'hi' })).errors).toContain('X 动态没有标题，请把内容放进正文');
    const over = validateVariant('x', doc('x', { title: '', body: '字'.repeat(141) })); // 282
    expect(over.ok).toBe(false);
    expect(over.errors[0]).toContain('280');
  });
  it('小红书：标题 ≤20 硬上限；正文 600–900 建议区间、1000 硬上限', () => {
    expect(validateVariant('xiaohongshu', doc('xiaohongshu', { title: '一二三四五六七八九十', body: '字'.repeat(700) })).ok).toBe(true);
    const titleOver = validateVariant('xiaohongshu', doc('xiaohongshu', { title: '一二三四五六七八九十一二三四五六七八九十一', body: '字'.repeat(700) })); // 21 字 > 20（计划原 11 字不超限，与 20 字上限规则矛盾，按规则修正）
    expect(titleOver.ok).toBe(false);
    const warnLow = validateVariant('xiaohongshu', doc('xiaohongshu', { body: '字'.repeat(500) }));
    expect(warnLow.ok).toBe(true);
    expect(warnLow.warnings.join()).toContain('600');
    const hardOver = validateVariant('xiaohongshu', doc('xiaohongshu', { body: '字'.repeat(1001) }));
    expect(hardOver.ok).toBe(false);
    expect(hardOver.errors.join()).toContain('1000');
  });
  it('即刻：需至少一个话题', () => {
    expect(validateVariant('jike', doc('jike', { title: '', topics: [] })).errors).toContain('即刻动态需至少一个话题');
    expect(validateVariant('jike', doc('jike', { title: '', topics: ['产品沉思'] })).ok).toBe(true);
  });
  it('公众号文章：标题必填 ≤32、摘要 ≤120、封面必填、正文 <2 万字符', () => {
    const ok = validateVariant('wechat-article', doc('wechat-article', { title: '标题', cover: 'assets/cover.png', body: '正文' }));
    expect(ok.ok).toBe(true);
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '', cover: 'a.png', body: 'x' })).errors.join()).toContain('标题');
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '标', digest: '摘'.repeat(121), cover: 'a.png', body: 'x' })).errors.join()).toContain('120');
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '标', body: 'x' })).errors.join()).toContain('封面');
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '标', cover: 'a.png', body: 'x'.repeat(20000) })).errors.join()).toContain('2 万');
  });
  it('四平台规则齐备且 notes 非空（技能与 UI 共用文案）', () => {
    for (const key of ['xiaohongshu', 'x', 'jike', 'wechat-article'] as PlatformKey[]) {
      expect(PLATFORM_RULES[key].label).toBeTruthy();
      expect(PLATFORM_RULES[key].notes.length).toBeGreaterThan(0);
    }
  });
});
