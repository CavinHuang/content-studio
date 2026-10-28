import { expect, test } from 'vitest'
import { normalizeUrl, urlKeyOf } from '../../packages/desktop/src/main/discovery/url-key'

test('规范化：小写主机、去 www、去默认端口、去尾斜杠、去 hash、去跟踪参数', () => {
  expect(normalizeUrl('https://Example.com/a/?utm_source=x&b=2#frag')).toBe('https://example.com/a?b=2')
  expect(normalizeUrl('http://www.example.com/a/')).toBe('http://example.com/a')
  expect(normalizeUrl('https://example.com:443/a')).toBe('https://example.com/a')
  expect(normalizeUrl('https://example.com/a?spm=1001&from=timeline&id=9')).toBe('https://example.com/a?id=9')
  expect(normalizeUrl('https://example.com')).toBe('https://example.com')
})

test('规范化：非法输入返回 null 而不是抛栈', () => {
  expect(normalizeUrl('not a url')).toBeNull()
  expect(normalizeUrl('')).toBeNull()
  expect(normalizeUrl('ftp://example.com/a')).toBeNull()
})

test('同一原文的常见变体得到同一去重键；不同主机不同键', () => {
  const variants = [
    'https://example.com/articles/a',
    'https://example.com/articles/a/',
    'https://www.example.com/articles/a',
    'https://example.com/articles/a?utm_medium=share',
  ]
  const keys = new Set(variants.map((v) => urlKeyOf(v)))
  expect(keys.size).toBe(1)
  expect(urlKeyOf('https://other.com/articles/a')).not.toBe(urlKeyOf('https://example.com/articles/a'))
  expect(urlKeyOf('https://example.com/articles/a')).toMatch(/^a_[0-9a-f]{16}$/)
  expect(urlKeyOf('bad')).toBeNull()
})
