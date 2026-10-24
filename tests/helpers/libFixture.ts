import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function makeLibrary(): string {
  return mkdtempSync(path.join(tmpdir(), 'deck-lib-'));
}
export function addContent(root: string, folder: string, frontmatter: string, body = '正文') {
  const dir = path.join(root, folder);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'content.md'), `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
  return dir;
}
