// AI 腔扫描：本地启发式，无模型、无外呼、不改稿。输出是非阻断的辅助提示，
// 供作者在人工核查时参考（AGENTS：AI 输出是假设，提示不构成任何判定）。
// 标记词表为本仓库原创，参考的是"模板化中文 AI 措辞"这一公共现象而非任何
// 项目的词表拷贝。
export const AI_FLAVOR_MARKERS = [
  { id: "grand-opening", label: "宏大开场", pattern: /在当今(快速发展的|数字化|信息化)?时代|随着(科技|人工智能|互联网)的(发展|进步)/g },
  { id: "template-summary", label: "模板化总结", pattern: /综上所述|总而言之|总的来说|由此可见/g },
  { id: "filler-transition", label: "填充式过渡", pattern: /值得注意的是|值得一提的是|不得不说|可以说/g },
  { id: "hollow-depth", label: "空洞深度词", pattern: /深入(探讨|剖析|解析|解读)|全面(解析|梳理|盘点)/g },
  { id: "buzzword", label: "黑话堆砌", pattern: /赋能|抓手|闭环|打法|底层逻辑|顶层设计/g },
  { id: "fake-precision", label: "假精确数据", pattern: /\d{1,3}%以上的人|高达\d{1,3}%|提升了\d{1,3}%/g },
  { id: "slogan-appeal", label: "口号式呼告", pattern: /让我们(一起|共同)|共同(拥抱|迎接)/g },
  { id: "parallel-pile", label: "排比堆砌", pattern: /不仅[^。？\n]{1,24}(而且|更|还)[^。？\n]{1,24}/g },
];

export function scanAiFlavor(markdown) {
  // 代码块与行内代码是代码语义，不参与语气扫描。
  const text = String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  const chars = Math.max(1, text.replace(/\s/g, "").length);
  const hits = [];
  let total = 0;
  for (const marker of AI_FLAVOR_MARKERS) {
    const found = [...text.matchAll(new RegExp(marker.pattern.source, "g"))];
    if (!found.length) continue;
    const excerpt = found[0][0];
    hits.push({ id: marker.id, label: marker.label, count: found.length, excerpt: excerpt.slice(0, 60) });
    total += found.length;
  }
  const perThousand = total / (chars / 1000);
  const score = Math.min(100, Math.round(perThousand * 20));
  const level = hits.length === 0 ? "clean" : score >= 60 ? "high" : score >= 25 ? "medium" : "low";
  return {
    score,
    level,
    hits,
    hint:
      hits.length === 0
        ? "未发现常见 AI 模板措辞；这不能证明没有 AI 腔，语气仍需人工判断。"
        : "以上是常见 AI 模板措辞的出现位置，仅作人工核查提示；是否修改由作者决定，系统不会据此改稿或拦截。",
    scannedChars: chars,
  };
}
