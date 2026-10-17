import { ValidationError } from "./verification.mjs";
const fail = (s) => {
  throw new ValidationError(s, 502);
};
export function partialWritingText(raw, mode = "edit") {
  const key = mode === "discuss" ? "reason" : "replacement",
    m = new RegExp('"' + key + '"\\s*:\\s*"').exec(raw);
  if (!m) return "";
  let result = "";
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') break;
    if (c !== "\\") {
      result += c;
      continue;
    }
    if (++i >= raw.length) break;
    const e = raw[i];
    if (e === "u") {
      const hex = raw.slice(i + 1, i + 5);
      if (!/^[a-f0-9]{4}$/i.test(hex)) break;
      result += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else if ('"\\/bfnrt'.includes(e))
      result += {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      }[e];
    else break;
  }
  if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
  return result.slice(0, 150000);
}
export async function readWritingResponse(
  response,
  { onPartial = () => {}, mode = "edit" } = {}
) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    fail(
      "Writing service returned HTTP " +
        response.status +
        "; the article is unchanged"
    );
  }
  const reader = response.body?.getReader();
  if (!reader) fail("Writing service returned no response");
  const decoder = new TextDecoder(),
    sse = /text\/event-stream/i.test(
      response.headers.get("content-type") || ""
    );
  let bytes = 0,
    raw = "",
    buffer = "",
    data = [],
    doneMarker = false,
    finish = null;
  const event = () => {
    if (!data.length) return;
    const value = data.join("\n");
    data = [];
    if (value === "[DONE]") {
      doneMarker = true;
      return;
    }
    if (doneMarker) fail("模型流在完成标记后继续返回内容");
    let chunk;
    try {
      chunk = JSON.parse(value);
    } catch {
      fail("模型流返回格式错误");
    }
    if (chunk.error) fail("模型流未完成");
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content !== undefined) {
      if (typeof choice.delta.content !== "string") fail("模型流内容无效");
      raw += choice.delta.content;
      if (raw.length > 1000000)
        fail("Writing response exceeded the size limit");
      onPartial(partialWritingText(raw, mode));
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
  };
  const feed = () => {
    let n;
    while ((n = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, n).replace(/\r$/, "");
      buffer = buffer.slice(n + 1);
      if (!line) event();
      else if (line.startsWith("data:"))
        data.push(line.slice(5).replace(/^ /, ""));
    }
  };
  let complete = false;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.byteLength;
      if (bytes > 1500000) fail("Writing response exceeded the size limit");
      const text = decoder.decode(r.value, { stream: true });
      if (sse) {
        buffer += text;
        feed();
      } else raw += text;
    }
    if (sse) {
      buffer += decoder.decode();
      if (buffer) buffer += "\n";
      feed();
      event();
      if (!doneMarker || finish !== "stop")
        fail("模型生成中断或未完成，片段尚未写入正文");
    } else {
      raw += decoder.decode();
      let outer;
      try {
        outer = JSON.parse(raw);
      } catch {
        fail(
          "Writing response was incomplete or invalid JSON; the article is unchanged"
        );
      }
      if (outer.choices?.[0]?.finish_reason === "length")
        fail(
          "Writing response was incomplete or invalid JSON; the article is unchanged"
        );
      raw = outer.choices?.[0]?.message?.content;
      if (typeof raw !== "string") fail("Writing response has invalid content");
      onPartial(partialWritingText(raw, mode));
    }
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      fail(
        "Writing response was incomplete or invalid JSON; the article is unchanged"
      );
    }
    complete = true;
    return result;
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
