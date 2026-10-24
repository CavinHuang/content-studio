import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadPi } from '../../src/main/agent/pi-loader';

describe('随应用分发的技能', () => {
  it('longform-draft 与 review-revise 可被 pi 加载且无诊断', async () => {
    const pi = await loadPi();
    const r = pi.loadSkillsFromDir({ dir: path.resolve('skills'), source: 'contentdeck' });
    expect(r.skills.map((s) => s.name).sort()).toEqual(['longform-draft', 'review-revise']);
    expect(r.diagnostics).toEqual([]);
  }, 30_000);
});
