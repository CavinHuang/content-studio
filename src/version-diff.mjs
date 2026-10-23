// RD-03（Run D，Phase 4 首切片）— 版本历史两版对比 diff。
// 自有设计（Easel 无版本树，EASEL-PORT-PLAN §2 G6 / §11.8.2）：纯派生、零新依赖
// （package.json 无 diff 库）、零新增请求——对比所需两版 markdown 全在既有
// GET /history 载荷（src/writing.mjs:625-657），客户端按需计算。
// 诚实边界：任一侧超过 2000 行返回 {tooLarge:true} 降级，不假装对比；
// 只读渲染，不可变修订与「恢复此版」路径（WritingWorkspace restore）零改动。
// 输出措辞不出现「已发布」类承诺（单测断言）。

const MAX_LINES = 2000;

function splitLines(text) {
  return String(text ?? "").split(/\r?\n/);
}

// 行级最长公共子序列（LCS）动态规划：先裁剪公共前后缀（常见的小幅改写
// 只需极小的 DP 中段），上限内最坏 O(N·M)；任一侧超 2000 行诚实降级。
// 输出 ops：[{type:'same'|'add'|'del', text, oldLine?, newLine?}]，行号为 1-based。
export function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length > MAX_LINES || b.length > MAX_LINES)
    return { tooLarge: true, ops: [] };
  // 公共前缀
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  // 公共后缀（不与前缀重叠）
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA),
    midB = b.slice(start, endB);
  const n = midA.length,
    m = midB.length;
  // lcs[i][j] = midA[i..] 与 midB[j..] 的 LCS 长度
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] =
        midA[i] === midB[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = [];
  for (let k = 0; k < start; k++)
    ops.push({ type: "same", text: a[k], oldLine: k + 1, newLine: k + 1 });
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({
        type: "same",
        text: midA[i],
        oldLine: start + i + 1,
        newLine: start + j + 1,
      });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "del", text: midA[i], oldLine: start + i + 1 });
      i++;
    } else {
      ops.push({ type: "add", text: midB[j], newLine: start + j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "del", text: midA[i], oldLine: start + i + 1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", text: midB[j], newLine: start + j + 1 });
    j++;
  }
  for (let k = 0; k < a.length - endA; k++) {
    const ai = endA + k,
      bi = endB + k;
    ops.push({ type: "same", text: a[ai], oldLine: ai + 1, newLine: bi + 1 });
  }
  return { tooLarge: false, ops };
}

// 真实计数：{added, removed}（del/add 行数，不虚报）。
export function diffSummary(ops) {
  const list = Array.isArray(ops) ? ops : [];
  return {
    added: list.filter((o) => o.type === "add").length,
    removed: list.filter((o) => o.type === "del").length,
  };
}
