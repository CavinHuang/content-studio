export async function consumeGeneration(response, onEvent) {
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.location.assign("/signin");
    const data = await response.json().catch(() => ({}));
    throw Error(data.error || "生成请求未完成");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("生成连接没有返回内容");
  const decoder = new TextDecoder();
  let buffer = "",
    size = 0,
    result,
    problem,
    complete = false;
  const line = (text) => {
    if (!text.trim()) return;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      throw Error("生成连接返回格式错误，正文未改变");
    }
    onEvent(event);
    if (event.type === "completed") {
      result = event.result;
      complete = true;
    }
    if (event.type === "failed") problem = event.error || "生成未完成";
  };
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > 5000000) throw Error("生成响应过大，正文未改变");
      buffer += decoder.decode(r.value, { stream: true });
      let n;
      while ((n = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, n));
        buffer = buffer.slice(n + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer);
    if (problem) throw Error(problem);
    if (!complete || !result) throw Error("生成连接中断，片段尚未写入正文");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
