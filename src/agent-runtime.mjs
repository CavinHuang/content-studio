import { randomUUID } from "node:crypto";
import { ValidationError } from "./verification.mjs";
import { AGENT_SKILLS, skillById } from "./agent-skills.mjs";
import { AGENT_TOOLS } from "./agent-tools.mjs";

const fail = (message, status = 400) => {
  throw new ValidationError(message, status);
};
const stamp = () => new Date().toISOString();
// 轨迹记录专用：仅限制落盘副本中的字符串长度，回传模型的消息保持原样。
const slim = (value) => {
  try {
    return JSON.parse(JSON.stringify(value, (k, v) => typeof v === "string" ? v.slice(0, 2000) : v));
  } catch {
    return { unserializable: true };
  }
};
export const AGENT_MAX_STEPS = 24;
export const DEFAULT_AGENT_TOOLS = [
  "read_document","read_brief","read_context","search_assets",
  "write_suggestions","write_revision",
  "plan_illustrations","generate_image",
  "render_xhs_group","edit_xhs_page",
];

export class AgentRuntime {
  constructor(core) {
    this.core = core;
    this.db = core.db;
    this.controllers = new Map();
    this.loopPromises = new Map();
    this.owner = randomUUID();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_profiles(
        id TEXT PRIMARY KEY,name TEXT NOT NULL,connection_id TEXT NOT NULL,
        write_mode TEXT NOT NULL,tools_json TEXT NOT NULL,channels_json TEXT NOT NULL,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_runs(
        id TEXT PRIMARY KEY,project_id TEXT NOT NULL,channel TEXT NOT NULL,
        base_revision INTEGER NOT NULL,skill_id TEXT NOT NULL,skill_version INTEGER NOT NULL,
        agent_id TEXT NOT NULL,status TEXT NOT NULL,stop_reason TEXT NOT NULL DEFAULT '',
        instruction TEXT NOT NULL DEFAULT '',binding_json TEXT NOT NULL DEFAULT '{}',
        owner TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_run_steps(
        run_id TEXT NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,PRIMARY KEY(run_id,seq));
      CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id,channel,created_at);
    `);
    this.db
      .prepare("UPDATE agent_runs SET status='interrupted',stop_reason=?,updated_at=? WHERE status='running'")
      .run("进程重启，请核对运行轨迹后重试", stamp());
    if (!this.db.prepare("SELECT 1 FROM agent_profiles WHERE id='ag_default'").get())
      this.db.prepare("INSERT INTO agent_profiles VALUES(?,?,?,?,?,?,?,?)").run(
        "ag_default","默认写作代理","platform","suggestions",
        JSON.stringify(DEFAULT_AGENT_TOOLS),
        JSON.stringify(["master","wechat","zhihu","xiaohongshu"]),
        stamp(), stamp());
  }
  profile(id = "ag_default") {
    const row = this.db.prepare("SELECT * FROM agent_profiles WHERE id=?").get(id);
    if (!row) fail("代理配置不存在", 404);
    return { id: row.id, name: row.name, connectionId: row.connection_id,
      writeMode: row.write_mode, tools: JSON.parse(row.tools_json),
      channels: JSON.parse(row.channels_json) };
  }
  saveProfile({ writeMode, tools, connectionId } = {}) {
    const p = this.profile(),
      next = { writeMode: writeMode ?? p.writeMode, tools: tools ?? p.tools,
        connectionId: connectionId ?? p.connectionId };
    if (!["suggestions", "revisions"].includes(next.writeMode)) fail("写模式无效");
    if (!Array.isArray(next.tools) || next.tools.some(t => !DEFAULT_AGENT_TOOLS.includes(t)))
      fail("工具白名单无效");
    if (next.connectionId !== "platform" &&
        !this.db.prepare("SELECT 1 FROM service_connections WHERE id=? AND kind='text'").get(next.connectionId))
      fail("绑定的文字服务连接不存在", 404);
    this.db
      .prepare("UPDATE agent_profiles SET connection_id=?,write_mode=?,tools_json=?,updated_at=? WHERE id=?")
      .run(next.connectionId, next.writeMode, JSON.stringify([...new Set(next.tools)]), stamp(), p.id);
    return this.profile();
  }
  runs(projectId) {
    const rows = this.db
      .prepare("SELECT * FROM agent_runs WHERE project_id=? ORDER BY rowid DESC LIMIT 20")
      .all(projectId);
    if (!rows.length) return [];
    // 一次取回全部步骤（IN 查询），避免逐运行 N+1。
    const placeholders = rows.map(() => "?").join(","),
      stepRows = this.db
        .prepare(
          "SELECT run_id,seq,kind,payload_json AS payload,created_at AS createdAt FROM agent_run_steps WHERE run_id IN (" + placeholders + ") ORDER BY run_id,rowid"
        )
        .all(...rows.map(r => r.id));
    const byRun = new Map();
    for (const s of stepRows) {
      if (!byRun.has(s.run_id)) byRun.set(s.run_id, []);
      byRun.get(s.run_id).push({ seq: s.seq, kind: s.kind, payload: JSON.parse(s.payload), createdAt: s.createdAt });
    }
    return rows.map(row => ({
      id: row.id, projectId, channel: row.channel, baseRevision: row.base_revision,
      skillId: row.skill_id, skillVersion: row.skill_version, agentId: row.agent_id,
      status: row.status, stopReason: row.stop_reason, instruction: row.instruction,
      createdAt: row.created_at, updatedAt: row.updated_at,
      steps: byRun.get(row.id) ?? [],
    }));
  }
  run(projectId, runId) {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id=? AND project_id=?").get(runId, projectId);
    if (!row) fail("运行不存在", 404);
    return { id: row.id, projectId, channel: row.channel, baseRevision: row.base_revision,
      skillId: row.skill_id, skillVersion: row.skill_version, agentId: row.agent_id,
      status: row.status, stopReason: row.stop_reason, instruction: row.instruction,
      createdAt: row.created_at, updatedAt: row.updated_at,
      steps: this.db
        .prepare("SELECT seq,kind,payload_json AS payload,created_at AS createdAt FROM agent_run_steps WHERE run_id=? ORDER BY seq").all(runId)
        .map(s => ({ ...s, payload: JSON.parse(s.payload) })) };
  }
  // 事件流游标读取：仅返回 seq 大于游标的步骤，运行行字段保持与 run() 一致。
  runSince(projectId, runId, afterSeq = 0) {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id=? AND project_id=?").get(runId, projectId);
    if (!row) fail("运行不存在", 404);
    return { id: row.id, projectId, channel: row.channel, baseRevision: row.base_revision,
      skillId: row.skill_id, skillVersion: row.skill_version, agentId: row.agent_id,
      status: row.status, stopReason: row.stop_reason, instruction: row.instruction,
      createdAt: row.created_at, updatedAt: row.updated_at,
      steps: this.db
        .prepare("SELECT seq,kind,payload_json AS payload,created_at AS createdAt FROM agent_run_steps WHERE run_id=? AND seq>? ORDER BY seq").all(runId, afterSeq)
        .map(s => ({ ...s, payload: JSON.parse(s.payload) })) };
  }
  _step(runId, seq, kind, payload) {
    this.db.prepare("INSERT INTO agent_run_steps VALUES(?,?,?,?,?)")
      .run(runId, seq, kind, JSON.stringify(payload), stamp());
  }
  _runRow(runId) {
    return this.db.prepare("SELECT * FROM agent_runs WHERE id=?").get(runId);
  }
  _finish(runId, status, stopReason) {
    this.db.prepare("UPDATE agent_runs SET status=?,stop_reason=?,updated_at=? WHERE id=? AND status='running'")
      .run(status, String(stopReason || "").slice(0, 500), stamp(), runId);
  }
  skills() {
    return AGENT_SKILLS.map(({ id, version, title, description, tools, outputContract }) =>
      ({ id, version, title, description, tools, outputContract }));
  }
  async startRun(projectId, channel, { skillId, instruction, expectedRevision, allowExternalAI, fetchImpl } = {}) {
    const profile = this.profile(),
      skill = skillById(String(skillId || ""));
    if (!skill) fail("技能不存在", 404);
    if (!profile.channels.includes(channel)) fail("该渠道未获代理授权", 403);
    const tools = skill.tools.filter(t => profile.tools.includes(t));
    if (!tools.length) fail("该技能所需工具均未获代理授权", 403);
    if (allowExternalAI !== true) fail("请确认本次 agent 运行将调用模型与图片服务", 403);
    const doc = this.core.writing.document(projectId, channel);
    if (doc.mode !== "markdown") fail("请先将该稿件保存为 Markdown 模式", 409);
    if (doc.revision !== expectedRevision) fail("文章已变化，请刷新后启动运行", 409);
    if (this.db.prepare("SELECT 1 FROM agent_runs WHERE project_id=? AND channel=? AND status='running'").get(projectId, channel))
      fail("该稿件已有运行中的任务，请先等待完成或取消", 409);
    const binding = this.core.services.captureBinding("text"),
      id = "ar_" + randomUUID();
    this.db.prepare("INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id, projectId, channel, doc.revision, skill.id, skill.version, profile.id,
      "running", "", String(instruction || "").slice(0, 4000),
      JSON.stringify(binding), this.owner, stamp(), stamp());
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const tracked = { revision: doc.revision },
      ctx = { projectId, channel, runId: id, skillTitle: skill.title, writeMode: profile.writeMode,
        expectedRevision: () => tracked.revision, onWritten: rev => { tracked.revision = rev; },
        binding, skill, tools, signal: controller.signal, fetchImpl };
    const loop = this._loop(id, ctx).catch(() => {});
    this.loopPromises.set(id, loop);
    loop.finally(() => {
      this.controllers.delete(id);
      this.loopPromises.delete(id);
    });
    return this.run(projectId, id);
  }
  runSettled(runId) {
    const p = this.loopPromises.get(runId);
    return p ? p.catch(() => {}) : Promise.resolve();
  }
  cancelRun(projectId, runId) {
    const row = this.run(projectId, runId);
    if (row.status !== "running") fail("运行已结束", 409);
    this._finish(runId, "cancelled", "作者取消运行");
    this.controllers.get(runId)?.abort();
    return this.run(projectId, runId);
  }
  async _loop(runId, ctx) {
    const { projectId, channel, skill, tools, writeMode, binding, signal, fetchImpl } = ctx;
    let seq = 0;
    const record = (kind, payload) => this._step(runId, ++seq, kind, payload);
    try {
      const doc = this.core.writing.document(projectId, channel);
      const messages = [
        { role: "system", content: skill.systemPrompt },
        { role: "user", content: JSON.stringify({ instruction: this._runRow(runId).instruction,
          channel, revision: doc.revision, title: doc.title, brief: doc.brief || null,
          markdown: String(doc.markdown).slice(0, 60000), writeMode }) }];
      let failures = 0;
      for (let step = 1; step <= AGENT_MAX_STEPS; step++) {
        if (signal.aborted) return;
        let message;
        try {
          message = await this.core.services.chatWithTools({ binding, messages,
            tools: tools.filter(t => writeMode === "revisions" || t !== "write_revision").map(t =>
              ({ type: "function", function: { name: AGENT_TOOLS[t].name,
                description: AGENT_TOOLS[t].description, parameters: AGENT_TOOLS[t].parameters } })),
            runConsent: true, signal, ...(fetchImpl ? { fetchImpl } : {}) });
          failures = 0;
        } catch (e) {
          if (signal.aborted) return;
          failures++;
          record("model_error", { message: String(e.message || e).slice(0, 300) });
          if (failures >= 3) throw e;
          await new Promise(r => setTimeout(r, 250 * failures));
          if (signal.aborted) return;
          continue;
        }
        const calls = message.tool_calls || [];
        record("model", { content: String(message.content || "").slice(0, 2000),
          toolCalls: calls.map(c => ({ id: c.id, name: c.function?.name,
            arguments: String(c.function?.arguments || "").slice(0, 2000) })) });
        if (!calls.length) return this._finish(runId, "completed", String(message.content || "").slice(0, 500));
        messages.push(message);
        for (const call of calls) {
          if (signal.aborted) return;
          const outcome = await this._executeTool(runId, ctx, call);
          if (outcome.halted) return;
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outcome).slice(0, 4000) });
          record("tool", { name: call.function?.name, outcome: slim(outcome) });
        }
      }
      this._finish(runId, "failed", "达到单次运行步数上限，请核对已有结果后重试");
    } catch (e) {
      if (signal.aborted) return;
      this._finish(runId, "failed", "模型调用连续失败：" + String(e.message || e).slice(0, 300));
    }
  }
  async _executeTool(runId, ctx, call) {
    const name = call.function?.name, tool = AGENT_TOOLS[name];
    if (!tool) return { error: "未知工具：" + String(name).slice(0, 60) };
    const profile = this.profile(this._runRow(runId).agent_id);
    if (!profile.tools.includes(name)) {
      this._finish(runId, "failed", "工具未获代理授权：" + name);
      return { halted: true };
    }
    if (tool.mode === "revisions" && profile.writeMode !== "revisions") {
      this._finish(runId, "failed", "当前代理为建议制写模式，不能直接写入修订");
      return { halted: true };
    }
    let args = {};
    try { args = JSON.parse(call.function?.arguments || "{}"); }
    catch { return { error: "工具参数不是有效 JSON" }; }
    try {
      return { result: await tool.execute(this.core, ctx, args) };
    } catch (e) {
      if (e?.status === 409) {
        this._finish(runId, "interrupted", "正文已被作者修改，运行中断待核对");
        return { halted: true };
      }
      return { error: String(e.message || "工具执行失败").slice(0, 300) };
    }
  }
}
