import { ValidationError } from "./verification.mjs";
const fail = (s) => {
  throw new ValidationError(s, 502);
};
const boundary = (s, n) =>
  !(
    n > 0 &&
    n < s.length &&
    /[\uD800-\uDBFF]/.test(s[n - 1]) &&
    /[\uDC00-\uDFFF]/.test(s[n])
  );
export function validateWritingEdits(result, { current, from, to, mode }) {
  if (
    !result ||
    typeof result.reason !== "string" ||
    !result.reason.trim() ||
    result.reason.length > 4000
  )
    fail("Writing response has invalid content");
  if (mode === "discuss") {
    if (result.replacement !== "" || result.edits !== undefined)
      fail("讨论不能修改正文");
    return [{ from, to, replacement: "" }];
  }
  const edits =
    result.edits === undefined
      ? [{ from, to, replacement: result.replacement }]
      : result.edits;
  if (!Array.isArray(edits) || !edits.length || edits.length > 12)
    fail("每次最多提供 12 处独立修改");
  const out = edits
    .map((e) => {
      if (
        !e ||
        !Number.isInteger(e.from) ||
        !Number.isInteger(e.to) ||
        e.from < from ||
        e.to > to ||
        e.to < e.from ||
        !boundary(current.markdown, e.from) ||
        !boundary(current.markdown, e.to) ||
        typeof e.replacement !== "string" ||
        e.replacement.length > 150000 ||
        e.replacement.includes("\0") ||
        (e.from === e.to && !e.replacement) ||
        (e.original !== undefined &&
          e.original !== current.markdown.slice(e.from, e.to))
      )
        fail("模型修改范围或原文不匹配，正文未改变");
      if (result.edits === undefined && !e.replacement.trim())
        fail("Writing response has invalid content");
      return { from: e.from, to: e.to, replacement: e.replacement };
    })
    .sort((a, b) => a.from - b.from);
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1],
      b = out[i];
    if (
      a.to > b.from ||
      (a.to === b.from && (a.from === a.to || b.from === b.to))
    )
      fail("模型修改范围重叠，请重新生成");
  }
  if (
    current.markdown.length +
      out.reduce((n, e) => n + e.replacement.length - (e.to - e.from), 0) >
    150000
  )
    fail("Suggested document exceeds the size limit");
  return out;
}
