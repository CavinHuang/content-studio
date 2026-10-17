import { createHash } from "node:crypto";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];

// Bound the LCS work. Large changed regions remain one conservative hunk.
export function markdownChanges(before, after) {
  const a = lines(before),
    b = lines(after);
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const x = a.slice(prefix, a.length - suffix),
    y = b.slice(prefix, b.length - suffix);
  const offset = a.slice(0, prefix).join("").length;
  if (!x.length && !y.length) return [];
  const one = () => [
    {
      from: offset,
      to: offset + x.join("").length,
      before: x.join(""),
      after: y.join(""),
      line: prefix + 1,
      coarse: true,
    },
  ];
  if ((x.length + 1) * (y.length + 1) > 300000) return one();
  const width = y.length + 1,
    table = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--)
    for (let k = y.length - 1; k >= 0; k--)
      table[i * width + k] =
        x[i] === y[k]
          ? table[(i + 1) * width + k + 1] + 1
          : Math.max(table[(i + 1) * width + k], table[i * width + k + 1]);
  const result = [];
  let i = 0,
    k = 0,
    pos = offset,
    hunk = null;
  const flush = () => {
    if (hunk) {
      result.push(hunk);
      hunk = null;
    }
  };
  while (i < x.length || k < y.length) {
    if (i < x.length && k < y.length && x[i] === y[k]) {
      flush();
      pos += x[i].length;
      i++;
      k++;
      continue;
    }
    if (!hunk)
      hunk = {
        from: pos,
        to: pos,
        before: "",
        after: "",
        line: prefix + i + 1,
        coarse: false,
      };
    if (
      k < y.length &&
      (i === x.length || table[i * width + k + 1] > table[(i + 1) * width + k])
    )
      hunk.after += y[k++];
    else {
      hunk.before += x[i];
      pos += x[i++].length;
      hunk.to = pos;
    }
  }
  flush();
  return result.length > 100 ? one() : result;
}
const overlaps = (a, b) =>
  a.from === a.to || b.from === b.to
    ? a.from <= b.to && b.from <= a.to
    : a.from < b.to && b.from < a.to;
const mapPosition = (position, local) =>
  position +
  local
    .filter((h) => h.to <= position)
    .reduce((n, h) => n + h.after.length - (h.to - h.from), 0);

export function compareMarkdown(base, current, incoming) {
  const local = markdownChanges(base, current);
  return markdownChanges(base, incoming).map((change) => {
    const affected = local.filter((h) => overlaps(change, h));
    const applied =
      affected.length === 1 &&
      affected[0].from === change.from &&
      affected[0].to === change.to &&
      affected[0].after === change.after;
    const from = Math.min(change.from, ...affected.map((h) => h.from)),
      to = Math.max(change.to, ...affected.map((h) => h.to));
    // At an overlapping insertion's start, the current view must include that insertion.
    const viewFrom =
      from +
      local
        .filter((h) => h.to < from || (h.to === from && h.from !== h.to))
        .reduce((n, h) => n + h.after.length - (h.to - h.from), 0);
    const viewTo = mapPosition(to, local);
    return {
      ...change,
      id: hash(change),
      state: applied ? "applied" : affected.length ? "conflict" : "clean",
      current: current.slice(viewFrom, viewTo),
      targetFrom: mapPosition(change.from, local),
      targetTo: mapPosition(change.to, local),
    };
  });
}
export const syncReviewToken = (value) => hash(value);
