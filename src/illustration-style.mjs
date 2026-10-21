// 从正文提炼视觉风格建议：纯启发式（词频分桶 + 高频实体），不调用模型、不发起
// 外部请求、不写任何存储——结果只是待作者确认的建议稿（AGENTS：AI 输出是假设）。
const BUCKETS = [
  { id: "tech", words: ["架构", "模型", "算法", "代码", "系统", "工程", "数据", "接口", "协议", "部署", "参数", "性能"],
    palette: ["#2d5379", "#7d9cbf", "#f0f5fa"], mood: "冷静克制、结构感强，留白充分", avoid: "暖色手绘、贴纸拼贴与高饱和渐变" },
  { id: "life", words: ["生活", "周末", "散步", "早餐", "家人", "朋友", "旅行", "天气", "傍晚", "日常"],
    palette: ["#c9a86a", "#8a5a2b", "#faf5ec"], mood: "温暖松弛、有生活肌理", avoid: "冷调仪表盘、金属质感与锐利几何" },
  { id: "business", words: ["增长", "成本", "用户", "市场", "策略", "收入", "竞争", "渠道", "定价", "复盘"],
    palette: ["#1f3a56", "#c9a86a", "#ffffff"], mood: "沉稳可信、层级清晰", avoid: "玩具化插画与过度装饰" },
];
const STOP = new Set();

export function suggestStyleProfile(markdown) {
  const text = String(markdown ?? "");
  if (text.trim().length < 80) {
    return { profile: null, basis: [], reason: "正文太短（少于 80 字），不足以判断基调；请先写作再提炼。" };
  }
  const scored = BUCKETS
    .map((b) => ({ ...b, count: b.words.reduce((n, w) => n + (text.split(w).length - 1), 0) }))
    .sort((a, b) => b.count - a.count);
  const top = scored[0];
  const second = scored[1];
  // 实体只取拉丁词：中文无分词器时对连续文本切片会产生任意"伪实体"，
  // 属于假精度——纯中文正文如实回退到通用命名。
  const freq = new Map();
  for (const m of text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || []) {
    freq.set(m, (freq.get(m) || 0) + 1);
  }
  const entities = [...freq.entries()].filter(([w, n]) => n >= 3 && !STOP.has(w)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  const profile = {
    name: entities.length ? entities.join(" · ") + " 视觉系列" : "正文基调视觉系列",
    palette: top.palette.join(" / "),
    mood: top.mood,
    avoid: top.avoid,
  };
  const basis = [
    `词汇倾向：${top.id} 类词 ${top.count} 次（${top.words.filter((w) => text.includes(w)).slice(0, 4).join("、")}）`,
    entities.length ? `高频实体：${entities.join("、")}，可作封面视觉隐喻` : "未发现稳定复现的高频实体",
    second.count > 0 ? `次基调：${second.id}（${second.count} 次），配色已做中和` : null,
  ].filter(Boolean);
  return { profile, basis, reason: "由正文词频启发式提炼，仅是建议稿；请按作者意图修改后再保存。" };
}
