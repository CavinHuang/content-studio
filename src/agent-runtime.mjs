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
// SC-01：单 core 全局并发上限（读时求值，形态同 lib/creator-api.mjs 心跳间隔
// 先例——环境变量非 secret、非 NEXT_PUBLIC；更小值被 Math.max 抬到下限 1，
// 缺省/非法回 2）。并发按 core 计：每个作者一份 SQLite，即每作者独立上限。
export const agentMaxConcurrent = () =>
  Math.max(1, Number(process.env.CONTENT_STUDIO_AGENT_MAX_CONCURRENT) || 2);
// SC-02：单次 run 的模型请求预算（usingTask 单调用包裹）。读时求值，钳制在
// [1,20]：20 是 usingTask 既有校验上限（creator-services.mjs maxRequests>20
// 即 fail），钳制不报错；AGENT_MAX_STEPS=24 的极端运行第 21 次请求会 429
// 快速失败，重驱动获得新 run 新预算，不放宽共享上界。
export const agentRunRequestCap = () =>
  Math.min(20, Math.max(1, Number(process.env.CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP) || 20));

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
    // SC-01 启动清扫：queued 与 running 一样不跨进程存活——consent 未落库，
    // 跨重启自动开跑等于用旧 consent 发新付费调用；排队不承诺跨重启存活。
    // queued 用专属 stop_reason 与 running 清扫区分（设计决定，记 QA）。
    this.db
      .prepare("UPDATE agent_runs SET status='interrupted',stop_reason=?,updated_at=? WHERE status='running'")
      .run("进程重启，请核对运行轨迹后重试", stamp());
    this.db
      .prepare("UPDATE agent_runs SET status='interrupted',stop_reason=?,updated_at=? WHERE status='queued'")
      .run("进程重启，排队任务未保留，请重新发起或重驱动", stamp());
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
  // SC-01 只读派生：queued 行的全局排队位次 = 全库活跃行（running+queued）
  // 中 rowid 更早者的计数 + 1（按 core 计；认领按 rowid 全局推进，这是对
  // 「等待并发空位」最诚实的口径）。非 queued 一律 null。
  _queuePosition(row) {
    if (!row || row.status !== "queued") return null;
    return this.db
      .prepare("SELECT COUNT(*)+1 AS n FROM agent_runs WHERE status IN ('running','queued') AND rowid<?")
      .get(row._rid).n;
  }
  runs(projectId) {
    const rows = this.db
      .prepare("SELECT rowid AS _rid,* FROM agent_runs WHERE project_id=? ORDER BY rowid DESC LIMIT 20")
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
      queuePosition: this._queuePosition(row),
      steps: byRun.get(row.id) ?? [],
    }));
  }
  run(projectId, runId) {
    const row = this.db.prepare("SELECT rowid AS _rid,* FROM agent_runs WHERE id=? AND project_id=?").get(runId, projectId);
    if (!row) fail("运行不存在", 404);
    return { id: row.id, projectId, channel: row.channel, baseRevision: row.base_revision,
      skillId: row.skill_id, skillVersion: row.skill_version, agentId: row.agent_id,
      status: row.status, stopReason: row.stop_reason, instruction: row.instruction,
      createdAt: row.created_at, updatedAt: row.updated_at,
      queuePosition: this._queuePosition(row),
      steps: this.db
        .prepare("SELECT seq,kind,payload_json AS payload,created_at AS createdAt FROM agent_run_steps WHERE run_id=? ORDER BY seq").all(runId)
        .map(s => ({ ...s, payload: JSON.parse(s.payload) })) };
  }
  // 事件流游标读取：仅返回 seq 大于游标的步骤，运行行字段保持与 run() 一致。
  runSince(projectId, runId, afterSeq = 0) {
    const row = this.db.prepare("SELECT rowid AS _rid,* FROM agent_runs WHERE id=? AND project_id=?").get(runId, projectId);
    if (!row) fail("运行不存在", 404);
    return { id: row.id, projectId, channel: row.channel, baseRevision: row.base_revision,
      skillId: row.skill_id, skillVersion: row.skill_version, agentId: row.agent_id,
      status: row.status, stopReason: row.stop_reason, instruction: row.instruction,
      createdAt: row.created_at, updatedAt: row.updated_at,
      queuePosition: this._queuePosition(row),
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
    // stage（VA-04）与 preset（AW-02，一句话指令模板）都是纯展示字段：
    // 只进 skills() UI 投影，不进 systemPrompt/门禁/存储（agent_runs 行不含两者）。
    return AGENT_SKILLS.map(({ id, version, title, description, tools, outputContract, stage, preset }) =>
      ({ id, version, title, description, tools, outputContract, stage, preset }));
  }
  async startRun(projectId, channel, { skillId, instruction, expectedRevision, allowExternalAI, fetchImpl, resumeOf } = {}) {
    // 续跑缺省技能：未传 skillId 时直接用原运行的技能（计划 §SA-02）。
    if (resumeOf && !String(skillId || "")) {
      const target = this.run(projectId, resumeOf); // 不存在自然 404
      skillId = target.skillId;
    }
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
    // SC-01 单飞扩为 running/queued 双态：命中 running（同渠道无 queued）→
    // 改为入队（status='queued'，消除 409 死胡同）；命中 queued → 仍 409
    // （队列槽每 project+channel 至多 1，防堆积）。无同渠道活跃行但全局
    // running 已达 maxConcurrent()（按 core 计）→ 也入队等待补位。
    const sameChannelActive = this.db
      .prepare("SELECT status FROM agent_runs WHERE project_id=? AND channel=? AND status IN ('running','queued') ORDER BY rowid DESC LIMIT 1")
      .get(projectId, channel);
    let enqueue = false;
    if (sameChannelActive) {
      if (sameChannelActive.status === "queued")
        fail("该稿件已有排队中的任务，请先等待完成或取消", 409);
      enqueue = true;
    } else if (this.db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE status='running'").get().n >= agentMaxConcurrent())
      enqueue = true;
    // SA-02 重驱动（resumeOf）：续跑以当前正文为基准开新运行，不是断点续传。
    // 既有门禁（consent/markdown/expectedRevision/单飞）全部照旧在上面的检查里。
    let resumeSource = null;
    if (resumeOf) {
      const old = this.run(projectId, resumeOf); // 不存在自然 404
      if (old.channel !== channel) fail("续跑须沿用原渠道", 409);
      // cancelled 是作者显式意图（口径同 src/writing.mjs 的恢复请求）
      if (!["interrupted", "failed"].includes(old.status))
        fail(old.status === "cancelled" ? "原运行已被作者取消，请直接重新发起" : "原运行仍在进行中，不能续跑", 409);
      if (old.skillId !== skill.id) fail("续跑须沿用原技能", 409);
      // binding_json 列 DDL 默认 '{}'：解析结果无 id 即 409——不建跑、不留
      // 必然失败的轨迹（captureBinding 产物必含 id，手工/陈旧行可能为 '{}'）。
      let savedBinding = null;
      try { savedBinding = JSON.parse(this._runRow(old.id).binding_json); } catch { savedBinding = null; }
      if (!savedBinding || typeof savedBinding !== "object" || !savedBinding.id)
        fail("原运行无可用模型绑定，请直接重新发起", 409);
      resumeSource = { id: old.id, fromStatus: old.status, binding: savedBinding };
    }
    const binding = resumeSource ? resumeSource.binding : this.core.services.captureBinding("text"),
      id = "ar_" + randomUUID();
    // SC-01：绑定在入队时定格，drain 不重新 capture（入队时的授权即运行授权）。
    this.db.prepare("INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id, projectId, channel, doc.revision, skill.id, skill.version, profile.id,
      enqueue ? "queued" : "running", "", String(instruction || "").slice(0, 4000),
      JSON.stringify(binding), this.owner, stamp(), stamp());
    // 溯源零 schema 变更：重驱动的首步骤记 resume 事实，随既有投影与流透出。
    // 排队行同样照常落 resume 首步骤（drain 时 _loop 从其后继续）。
    let seqStart = 0;
    if (resumeSource) {
      this._step(id, 1, "resume", { resumeOf: resumeSource.id, baseRevision: doc.revision, fromStatus: resumeSource.fromStatus });
      seqStart = 1;
    }
    if (enqueue) {
      // 排队行不建 controller/loopPromises：认领由 drainQueued（loop.finally
      // 链 / creator-worker tick）完成；HTTP 语义仍是 201（运行已受理）。
      return this.run(projectId, id);
    }
    this._attachLoop(id, {
      projectId, channel, skillTitle: skill.title, writeMode: profile.writeMode,
      expectedRevision: () => doc.revision, onWritten: () => {},
      binding, skill, tools, fetchImpl,
    }, seqStart);
    return this.run(projectId, id);
  }
  // SC-01：controller/loopPromises 的统一附着。loop.finally 除清理外追加
  // drainQueued 补位——同渠道/全局空位出现后，最旧可认领的 queued 行自动开跑。
  _attachLoop(id, ctx, seqStart = 0) {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    ctx.runId = id; // 工具链（write_suggestions 溯源）从 ctx.runId 取运行 ID
    ctx.signal = controller.signal;
    const tracked = { revision: ctx.expectedRevision() };
    ctx.expectedRevision = () => tracked.revision;
    ctx.onWritten = rev => { tracked.revision = rev; };
    const loop = this._loop(id, ctx, seqStart).catch(() => {});
    this.loopPromises.set(id, loop);
    loop.finally(() => {
      this.controllers.delete(id);
      this.loopPromises.delete(id);
      void this.drainQueued().catch(() => {});
    });
  }
  // SC-01 认领（r6.1 评审 high 项——与入队单飞是同一不变量「每 project+channel
  // 至多 1 running + 1 queued」的执行半边）：单条 BEGIN IMMEDIATE 事务内
  // 「数 running → 按同渠道守卫取最旧可认领 queued → CAS UPDATE 校验 .changes」，
  // 守卫 SELECT 与 CAS 同事务无 TOCTOU。守卫用按 project+channel 配对的相关
  // 子查询（评审建议的裸 channel NOT IN 会把其它项目同渠道 running 之下的
  // queued 一并误伤，不采纳；跨项目同渠道互不相干）。忙渠道的 queued 自动
  // 跳过、不阻塞其它渠道补位。.changes=0 即他人已认领，直接返回。
  async drainQueued() {
    const cap = agentMaxConcurrent();
    this.db.exec("BEGIN IMMEDIATE");
    let claimId = null;
    try {
      if (this.db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE status='running'").get().n < cap) {
        const row = this.db
          .prepare(
            "SELECT rowid AS _rid,id FROM agent_runs WHERE status='queued' AND NOT EXISTS (" +
            "SELECT 1 FROM agent_runs r2 WHERE r2.project_id=agent_runs.project_id AND r2.channel=agent_runs.channel AND r2.status='running')" +
            " ORDER BY rowid LIMIT 1"
          )
          .get();
        if (row && this.db
          .prepare("UPDATE agent_runs SET status='running',updated_at=? WHERE id=? AND status='queued'")
          .run(stamp(), row.id).changes)
          claimId = row.id;
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    if (claimId) this._startClaimed(claimId);
  }
  // 认领后复核（不静默换基准）：排队期间正文/模式/技能/工具/绑定可能已变化，
  // 复核失败转 interrupted（revisions 直写制下前序推进 revision 后必然如此，
  // 由 redrive 一步接手；建议制不推进 revision 正常补位），不用旧基准续跑。
  // 复核过且重读行仍 'running'（防认领后 controllers.set 前 cancelRun 空档）
  // 才起 _loop；seq 起点 COALESCE(MAX(seq),0) 兼容 resume 已占用的首步骤。
  _startClaimed(runId) {
    const row = this._runRow(runId);
    const interrupted = reason => this._finish(runId, "interrupted", reason);
    const doc = this.core.writing.document(row.project_id, row.channel);
    if (!doc || doc.mode !== "markdown") return interrupted("排队期间稿件已退出 Markdown 模式，请核对后重新发起");
    if (doc.revision !== row.base_revision) return interrupted("排队期间正文已变化，请核对后重新发起或重驱动");
    const skill = skillById(row.skill_id);
    if (!skill) return interrupted("排队期间技能已不可用，请重新发起");
    const profile = this.profile(row.agent_id);
    const tools = skill.tools.filter(t => profile.tools.includes(t));
    if (!tools.length) return interrupted("排队期间工具授权已变化，该技能所需工具均未获代理授权，请重新发起");
    let binding = null;
    try { binding = JSON.parse(row.binding_json); } catch { binding = null; }
    if (!binding || typeof binding !== "object" || !binding.id)
      return interrupted("排队运行无可用模型绑定，请直接重新发起");
    if (this._runRow(runId).status !== "running") return; // 认领后已被取消
    let seqStart = 0;
    try { seqStart = this.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM agent_run_steps WHERE run_id=?").get(runId).n; } catch { seqStart = 0; }
    this._attachLoop(runId, {
      projectId: row.project_id, channel: row.channel, skillTitle: skill.title,
      writeMode: profile.writeMode, expectedRevision: () => doc.revision, onWritten: () => {},
      binding, skill, tools,
    }, seqStart);
  }
  runSettled(runId) {
    const p = this.loopPromises.get(runId);
    return p ? p.catch(() => {}) : Promise.resolve();
  }
  cancelRun(projectId, runId) {
    const row = this.run(projectId, runId);
    if (row.status !== "running" && row.status !== "queued") fail("运行已结束", 409);
    if (row.status === "queued") {
      // SC-01：queued 行没有 controller——纯 UPDATE CAS 取消；输掉竞态
      // （已被 drain 认领）落回下方 running 分支用 abort 收敛。
      const claimed = this.db
        .prepare("UPDATE agent_runs SET status='cancelled',stop_reason=?,updated_at=? WHERE id=? AND status='queued'")
        .run("作者取消运行", stamp(), runId).changes;
      if (claimed) return this.run(projectId, runId);
    }
    this._finish(runId, "cancelled", "作者取消运行");
    this.controllers.get(runId)?.abort();
    return this.run(projectId, runId);
  }
  async _loop(runId, ctx, seqStart = 0) {
    const { projectId, channel, skill, tools, writeMode, binding, signal, fetchImpl } = ctx;
    // 起始 seq 支持重驱动（resumeOf）已占用的首步骤，避免 PRIMARY KEY(run_id,seq) 冲突。
    let seq = seqStart;
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
          // SC-02：只包这一单次聊天调用进 usingTask（任务上下文仅对此请求的
          // _reserve 生效）——绝不包整个 _loop：await 返回后 AsyncLocalStorage
          // 上下文即退出，_executeTool 内的图片工具预留天然在上下文外，
          // 不会撞「任务未授权该用途」403。
          message = await this.core.services.usingTask(runId, binding, agentRunRequestCap(), () =>
            this.core.services.chatWithTools({ binding, messages,
              tools: tools.filter(t => writeMode === "revisions" || t !== "write_revision").map(t =>
                ({ type: "function", function: { name: AGENT_TOOLS[t].name,
                  description: AGENT_TOOLS[t].description, parameters: AGENT_TOOLS[t].parameters } })),
              runConsent: true, signal, ...(fetchImpl ? { fetchImpl } : {}) }));
          failures = 0;
        } catch (e) {
          if (signal.aborted) return;
          // SC-02 429 快速失败：额度用尽不再走 3 次必然失败的重试；429 尝试
          // 不消耗额度（_reserve 在 BEGIN IMMEDIATE 内 fail 即 ROLLBACK）。
          if (e?.status === 429) {
            record("model_error", { message: String(e.message || e).slice(0, 300) });
            return this._finish(runId, "failed", "模型请求额度已用完，本次运行快速失败；请核对每日额度或重驱动接续新预算");
          }
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
