import { sourceLifecycle } from "./creator-source-lifecycle.mjs";
import { randomUUID, createHash } from "node:crypto";
import { ValidationError } from "./verification.mjs";
import { publicResource, publicRequest } from "./public-http.mjs";
import { parseFeed, item } from "./normalize.mjs";
import { decodeHTML } from "entities";
const fail = (s, status = 400) => {
  throw new ValidationError(s, status);
};
const now = () => new Date().toISOString(),
  hash = (s) => createHash("sha256").update(s).digest("hex"),
  j = JSON.parse;
const text = (s, label, max = 2000, min = 0) => {
  if (
    typeof s !== "string" ||
    s.trim().length < min ||
    s.length > max ||
    s.includes("\0")
  )
    fail(label + "格式或长度不正确");
  return s.trim();
};
const initialProfile = {
  domain: "",
  audience: "",
  goals: "",
  tone: "",
  structure: "",
  avoid: "",
  length: "",
  visual: "",
  timezone: "Asia/Shanghai",
  learningEnabled: true,
  backgroundAI: false,
};
export function nextSeriesRun(input, days, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(input))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)])
  );
  const d = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + days,
      parts.hour,
      parts.minute,
      parts.second
    )
  );
  let result = d.getTime();
  for (let i = 0; i < 4; i++) {
    const current = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(result))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)])
    );
    const actual = Date.UTC(
      current.year,
      current.month - 1,
      current.day,
      current.hour,
      current.minute,
      current.second
    );
    const offset = d.getTime() - actual;
    if (!offset) break;
    result += offset;
  }
  return new Date(result).toISOString();
}
export class CreatorService {
  constructor(core) {
    Object.assign(this, {
      core,
      db: core.store.db,
      services: core.services,
      writing: core.writing,
    });
    this.db.exec(`
  CREATE TABLE IF NOT EXISTS creator_profile_versions(revision INTEGER PRIMARY KEY,data_json TEXT NOT NULL,source_json TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_style_suggestions(id TEXT PRIMARY KEY,data_json TEXT NOT NULL,evidence_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_materials(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,url TEXT NOT NULL,tags_json TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_topics(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,title TEXT NOT NULL,angle TEXT NOT NULL,audience TEXT NOT NULL,outline TEXT NOT NULL,refs_json TEXT NOT NULL,status TEXT NOT NULL,favorite INTEGER NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_topic_messages(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,candidate_json TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_project_context(project_id TEXT PRIMARY KEY,topic_id TEXT NOT NULL DEFAULT '',refs_json TEXT NOT NULL,excluded_json TEXT NOT NULL,profile_json TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_project_topic ON creator_project_context(topic_id) WHERE topic_id!='';
  CREATE TABLE IF NOT EXISTS creator_channel_profiles(project_id TEXT NOT NULL,channel TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(project_id,channel));
  CREATE TABLE IF NOT EXISTS creator_project_accounts(project_id TEXT NOT NULL,channel TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(project_id,channel));
  CREATE TABLE IF NOT EXISTS creator_series(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,name TEXT NOT NULL,goal TEXT NOT NULL,status TEXT NOT NULL,timezone TEXT NOT NULL,cadence_days INTEGER NOT NULL,next_run_at TEXT NOT NULL,background_ai INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_series_entries(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,topic_id TEXT NOT NULL,position INTEGER NOT NULL,status TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS creator_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,target_id TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL,lease_until TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_notifications(id TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,href TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_asset_meta(kind TEXT NOT NULL,asset_id TEXT NOT NULL,tags_json TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,asset_id));
  CREATE TABLE IF NOT EXISTS creator_asset_usage(project_id TEXT NOT NULL,kind TEXT NOT NULL,asset_id TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,kind,asset_id));
  CREATE TABLE IF NOT EXISTS creator_sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,enabled INTEGER NOT NULL,last_run TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'waiting');
  CREATE TABLE IF NOT EXISTS creator_metrics(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,channel TEXT NOT NULL,url TEXT NOT NULL,views INTEGER,likes INTEGER,comments INTEGER,note TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_style_decisions(id TEXT PRIMARY KEY,suggestion_id TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_topic_details(topic_id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_topic_history(topic_id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(topic_id,revision));
  CREATE TABLE IF NOT EXISTS creator_topic_feedback(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_context_state(project_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_context_history(project_id TEXT NOT NULL,revision INTEGER NOT NULL,channel TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,revision));
  CREATE TABLE IF NOT EXISTS creator_job_payloads(job_id TEXT PRIMARY KEY,data_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_job_reviews(job_id TEXT PRIMARY KEY,outcome TEXT NOT NULL,note TEXT NOT NULL,retry_job_id TEXT,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS creator_source_removals(kind TEXT NOT NULL,source_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(kind,source_id));
  CREATE TABLE IF NOT EXISTS creator_learning_exclusions(project_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,kind,source_id));
  CREATE TABLE IF NOT EXISTS creator_profile_field_sources(revision INTEGER NOT NULL,field TEXT NOT NULL,sources_json TEXT NOT NULL,PRIMARY KEY(revision,field));
  CREATE TABLE IF NOT EXISTS creator_style_revocations(suggestion_id TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE VIRTUAL TABLE IF NOT EXISTS creator_search USING fts5(id UNINDEXED,kind UNINDEXED,title,body,tags,tokenize='trigram');
 `);
    if (!this.profile())
      this.db
        .prepare("INSERT INTO creator_profile_versions VALUES(1,?,?,?)")
        .run(JSON.stringify(initialProfile), "[]", now());
    this._ensureProfileFieldSources();
  }
  profile() {
    const row = this.db
      .prepare(
        "SELECT * FROM creator_profile_versions ORDER BY revision DESC LIMIT 1"
      )
      .get();
    return row
      ? {
          revision: row.revision,
          ...j(row.data_json),
          createdAt: row.created_at,
        }
      : null;
  }
  profileHistory() {
    return this.db
      .prepare("SELECT * FROM creator_profile_versions ORDER BY revision DESC")
      .all()
      .map((r) => ({
        revision: r.revision,
        data: Object.fromEntries(
          Object.entries(j(r.data_json)).map(([k, v]) => [
            k,
            this.invalidProfileFields(r.revision).includes(k) ? "" : v,
          ])
        ),
        revoked: !!this.invalidProfileFields(r.revision).length,
        sources: j(r.source_json).map((e) =>
          e.projectId && this.learningExcluded(e.projectId)
            ? { projectId: e.projectId, title: "来源已移除", revoked: true }
            : e
        ),
        createdAt: r.created_at,
      }));
  }
  saveProfile(input, sources = []) {
    return this._atomic("creator_save_profile", () =>
      this._saveProfile(input, sources)
    );
  }
  _saveProfile({ expectedRevision, data }, sources = []) {
    const old = this.profile();
    if (expectedRevision !== old.revision)
      fail("作者画像已变化，请重新载入", 409);
    if (!data || typeof data !== "object" || Array.isArray(data))
      fail("画像格式无效");
    const next = { ...old };
    delete next.revision;
    delete next.createdAt;
    for (const [key, value] of Object.entries(data)) {
      if (!(key in initialProfile)) fail("未知画像字段");
      next[key] =
        typeof initialProfile[key] === "boolean"
          ? (() => {
              if (typeof value !== "boolean") fail("开关格式无效");
              return value;
            })()
          : text(value, key, key === "timezone" ? 80 : 2000);
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: next.timezone });
    } catch {
      fail("时区无效");
    }
    this.db
      .prepare("INSERT INTO creator_profile_versions VALUES(?,?,?,?)")
      .run(
        old.revision + 1,
        JSON.stringify(next),
        JSON.stringify(sources),
        now()
      );
    this._storeProfileFieldSources(
      old.revision,
      old.revision + 1,
      data,
      sources
    );
    return this.profile();
  }
  styleSuggestions() {
    return this.db
      .prepare(
        "SELECT * FROM creator_style_suggestions ORDER BY created_at DESC"
      )
      .all()
      .map((r) => ({
        id: r.id,
        data: this.db
          .prepare(
            "SELECT 1 FROM creator_style_revocations WHERE suggestion_id=?"
          )
          .get(r.id)
          ? {}
          : j(r.data_json),
        evidence: j(r.evidence_json).map((e) =>
          this.learningExcluded(e.projectId)
            ? {
                projectId: e.projectId,
                title: "来源已移除",
                revision: e.revision,
                revoked: true,
              }
            : e
        ),
        status:
          r.status === "deleted"
            ? "deleted"
            : this.db
                .prepare(
                  "SELECT 1 FROM creator_style_revocations WHERE suggestion_id=?"
                )
                .get(r.id)
            ? "revoked"
            : r.status,
        decisions: this.db
          .prepare(
            "SELECT data_json,created_at AS createdAt FROM creator_style_decisions WHERE suggestion_id=? ORDER BY rowid"
          )
          .all(r.id)
          .map((d) => ({ data: j(d.data_json), createdAt: d.createdAt })),
        createdAt: r.created_at,
      }))
      .map((s) =>
        s.status === "revoked" ||
        this.db
          .prepare(
            "SELECT 1 FROM creator_style_revocations WHERE suggestion_id=?"
          )
          .get(s.id)
          ? { ...s, decisions: [] }
          : s
      );
  }
  async inferStyle({
    projectIds,
    allowExternalAI = false,
    revisions = {},
    requireBackgroundConsent = false,
    jobId,
  } = {}) {
    if (!this.profile().learningEnabled) fail("画像学习已暂停", 409);
    if (
      !Array.isArray(projectIds) ||
      projectIds.length < 1 ||
      projectIds.length > 8
    )
      fail("请选择 1–8 篇自己的文章");
    const evidence = projectIds.map((id) => {
      this.assertLearningAllowed(id);
      const current = this.writing.document(id, "master"),
        sourceRevision = revisions[id];
      const historical =
        sourceRevision === undefined
          ? current
          : this.writing
              .history(id, "master")
              .find((d) => d.revision === sourceRevision);
      if (!historical) fail("画像学习的文章版本不存在", 404);
      const d = { ...historical, title: current.title };
      return {
        projectId: id,
        revision: d.revision,
        sha256: hash(d.markdown),
        title: d.title,
        markdown: d.markdown.slice(0, 10000),
        feedback: this.writing
          .suggestions(id, "master")
          .filter(
            (s) =>
              ["accepted", "rejected"].includes(s.status) &&
              s.baseRevision <= d.revision
          )
          .slice(0, 8)
          .map((s) => ({
            suggestionId: s.id,
            instruction: s.instruction,
            status: s.status,
          })),
      };
    });
    const result = await this.services.chat(
      '提炼作者表达习惯。返回 {"tone":"语气","structure":"结构","avoid":"应避免的表达","length":"篇幅习惯"}；只描述写作风格，不推断作者身份、观点或事实。',
      { articles: evidence },
      { allowExternalAI }
    );
    for (const e of evidence) this.assertLearningAllowed(e.projectId);
    if (!this.profile().learningEnabled)
      fail("画像学习已暂停，返回结果未保存", 409);
    if (requireBackgroundConsent && !this.profile().backgroundAI)
      fail("后台学习已暂停，返回结果未保存", 409);
    if (jobId) this._assertJobRunning(jobId);
    const data = Object.fromEntries(
        ["tone", "structure", "avoid", "length"].map((key) => [
          key,
          text(result[key] || "", key, 2000),
        ])
      ),
      id = "st_" + randomUUID();
    this.db
      .prepare("INSERT INTO creator_style_suggestions VALUES(?,?,?,?,?)")
      .run(
        id,
        JSON.stringify(data),
        JSON.stringify(evidence.map(({ markdown, ...r }) => r)),
        "pending",
        now()
      );
    return this.styleSuggestions().find((s) => s.id === id);
  }
  decideStyle(id, { action, expectedRevision, data } = {}) {
    const row = this.db
      .prepare("SELECT * FROM creator_style_suggestions WHERE id=?")
      .get(id);
    if (!row) fail("画像建议不存在", 404);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM creator_style_revocations WHERE suggestion_id=?"
        )
        .get(id)
    )
      fail("来源已移除，建议已撤销", 409);
    if (!["accept", "reject", "delete"].includes(action)) fail("操作无效");
    if (
      row.status === "deleted" ||
      (action !== "delete" && row.status !== "pending")
    )
      fail("建议已处理", 409);
    let accepted = j(row.data_json);
    if (data !== undefined) {
      if (
        action !== "accept" ||
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.keys(data).some(
          (k) => !["tone", "structure", "avoid", "length"].includes(k)
        )
      )
        fail("只能修订写作语气、结构、避免表达与篇幅");
      accepted = {
        ...accepted,
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, text(v, k, 2000)])
        ),
      };
    }
    return this._atomic("creator_style_decide", () => {
      if (action === "accept")
        this.saveProfile(
          { expectedRevision, data: accepted },
          j(row.evidence_json)
        );
      this.db
        .prepare("UPDATE creator_style_suggestions SET status=? WHERE id=?")
        .run(
          action === "accept"
            ? "accepted"
            : action === "reject"
            ? "rejected"
            : "deleted",
          id
        );
      this.db
        .prepare("INSERT INTO creator_style_decisions VALUES(?,?,?,?)")
        .run(
          "sd_" + randomUUID(),
          id,
          JSON.stringify({
            action,
            ...(action === "accept"
              ? {
                  original: j(row.data_json),
                  accepted,
                  authorEdited: JSON.stringify(accepted) !== row.data_json,
                }
              : {}),
          }),
          now()
        );
      return this.profile();
    });
  }
  material(id) {
    const row = this.db
      .prepare("SELECT * FROM creator_materials WHERE id=?")
      .get(id);
    if (!row) fail("素材不存在", 404);
    return { ...row, tags: j(row.tags_json) };
  }
  addMaterial({ kind = "note", title, body = "", url = "", tags = [] } = {}) {
    if (!["note", "file", "link"].includes(kind)) fail("素材类型无效");
    title = text(title, "素材标题", 240, 2);
    body = text(body, "素材正文", 150000);
    if (url) url = publicResource(url).href;
    if (!Array.isArray(tags) || tags.length > 20) fail("标签过多");
    const id = "mt_" + randomUUID();
    this.db
      .prepare("INSERT INTO creator_materials VALUES(?,?,?,?,?,?,0,?)")
      .run(
        id,
        kind,
        title,
        body,
        url,
        JSON.stringify(tags.map((t) => text(t, "标签", 40, 1))),
        now()
      );
    return this.material(id);
  }
  async importURL({ url, allowExternalRequest = false } = {}) {
    if (!allowExternalRequest) fail("请确认读取该公开链接", 403);
    const u = publicResource(url),
      r = await publicRequest(u, { maxBytes: 1500000, timeout: 12000 });
    if (!r.ok) fail("链接返回 HTTP " + r.status, 502);
    const source = await r.text(),
      title = decodeHTML(
        source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || u.hostname
      )
        .trim()
        .slice(0, 240),
      body = decodeHTML(
        source
          .replace(/<(script|style|nav)[\s\S]*?<\/\1>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/[ \t]+/g, " ")
      ).slice(0, 150000);
    return this.addMaterial({ kind: "link", title, body, url: u.href });
  }
  topic(id) {
    const row = this.db
      .prepare("SELECT * FROM creator_topics WHERE id=?")
      .get(id);
    if (!row) fail("选题不存在", 404);
    return {
      id: row.id,
      revision: row.revision,
      title: row.title,
      angle: row.angle,
      audience: row.audience,
      outline: row.outline,
      refs: j(row.refs_json),
      status: row.status,
      favorite: !!row.favorite,
      reason: row.reason,
      createdAt: row.created_at,
      ...this._briefDetails(
        j(
          this.db
            .prepare(
              "SELECT data_json FROM creator_topic_details WHERE topic_id=?"
            )
            .get(id)?.data_json || "{}"
        )
      ),
      feedback: this.db
        .prepare(
          "SELECT action,reason,created_at AS createdAt FROM creator_topic_feedback WHERE topic_id=? ORDER BY rowid DESC"
        )
        .all(id),
      projectId:
        this.db
          .prepare(
            "SELECT project_id FROM creator_project_context WHERE topic_id=?"
          )
          .get(id)?.project_id || null,
    };
  }
  topics() {
    return this.db
      .prepare(
        "SELECT id FROM creator_topics ORDER BY created_at DESC LIMIT 300"
      )
      .all()
      .map((r) => this.topic(r.id));
  }
  _refs(refs) {
    if (!Array.isArray(refs) || refs.length > 30) fail("最多选择 30 条素材");
    return refs.map((ref) => {
      if (!ref || !["material", "article", "image"].includes(ref.kind))
        fail("素材引用格式无效");
      if (ref.kind === "material") this.material(ref.id);
      if (ref.kind === "article") {
        const current = this.writing.document(ref.id, "master"),
          revision = ref.revision ?? current.revision;
        if (
          !Number.isInteger(revision) ||
          !this.writing
            .history(ref.id, "master")
            .some((h) => h.revision === revision)
        )
          fail("历史素材版本不存在", 404);
        return { kind: ref.kind, id: ref.id, revision };
      }
      if (ref.kind === "image") this.core.assets.get(ref.id);
      return { kind: ref.kind, id: ref.id };
    });
  }
  _atomic(name, fn) {
    this.db.exec("SAVEPOINT " + name);
    try {
      const result = fn();
      this.db.exec("RELEASE " + name);
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK TO " + name + "; RELEASE " + name);
      throw e;
    }
  }
  _briefDetails(input = {}) {
    const platforms = input.platforms ?? ["wechat"];
    if (
      !Array.isArray(platforms) ||
      platforms.length < 1 ||
      platforms.length > 3 ||
      new Set(platforms).size !== platforms.length ||
      platforms.some((p) => !["wechat", "zhihu", "xiaohongshu"].includes(p))
    )
      fail("请选择 1–3 个目标平台");
    return {
      problem: text(input.problem ?? "", "核心问题", 4000),
      keyPoints: text(input.keyPoints ?? "", "核心观点", 8000),
      evidenceGaps: text(input.evidenceGaps ?? "", "证据缺口", 4000),
      platforms,
    };
  }
  _recordTopic(id) {
    const topic = this.topic(id);
    this.db
      .prepare("INSERT OR IGNORE INTO creator_topic_history VALUES(?,?,?,?)")
      .run(id, topic.revision, JSON.stringify(topic), now());
    return topic;
  }
  topicHistory(id) {
    const current = this.topic(id),
      rows = this.db
        .prepare(
          "SELECT revision,data_json,created_at AS createdAt FROM creator_topic_history WHERE topic_id=? ORDER BY revision DESC"
        )
        .all(id)
        .map(({ data_json, ...row }) => ({ ...row, data: j(data_json) }));
    if (!rows.some((r) => r.revision === current.revision))
      rows.unshift({
        revision: current.revision,
        data: current,
        createdAt: current.createdAt,
      });
    return rows;
  }
  createTopic({
    title,
    angle = "",
    audience = "",
    outline = "",
    refs = [],
    reason = "作者提出的选题",
    ...details
  } = {}) {
    const id = "tp_" + randomUUID(),
      brief = this._briefDetails(details);
    refs = this._refs(refs);
    const values = [
      id,
      text(title, "选题标题", 240, 3),
      text(angle, "写作角度", 4000),
      text(audience, "读者", 1000),
      text(outline, "大纲", 12000),
      JSON.stringify(refs),
      text(reason, "推荐原因", 2000),
      now(),
    ];
    return this._atomic("creator_topic_create", () => {
      this.db
        .prepare(
          "INSERT INTO creator_topics VALUES(?,1,?,?,?,?,?,'draft',0,?,?)"
        )
        .run(...values);
      this.db
        .prepare("INSERT INTO creator_topic_details VALUES(?,?)")
        .run(id, JSON.stringify(brief));
      return this._recordTopic(id);
    });
  }
  updateTopic(id, { expectedRevision, ...input } = {}) {
    const t = this.topic(id);
    if (t.revision !== expectedRevision) fail("选题已变化，请重新载入", 409);
    if (
      input.status !== undefined &&
      !["draft", "prepared", "confirmed", "dismissed", "writing"].includes(
        input.status
      )
    )
      fail("选题状态无效");
    if (input.favorite !== undefined && typeof input.favorite !== "boolean")
      fail("收藏状态无效");
    const next = { ...t, ...input },
      refs = this._refs(next.refs),
      brief = this._briefDetails(next),
      reason = text(input.feedbackReason ?? "", "反馈原因", 2000);
    const values = [
      text(next.title, "标题", 240, 3),
      text(next.angle, "角度", 4000),
      text(next.audience, "读者", 1000),
      text(next.outline, "大纲", 12000),
      JSON.stringify(refs),
      next.status,
      next.favorite ? 1 : 0,
      id,
    ];
    return this._atomic("creator_topic_update", () => {
      this._recordTopic(id);
      this.db
        .prepare(
          "UPDATE creator_topics SET revision=revision+1,title=?,angle=?,audience=?,outline=?,refs_json=?,status=?,favorite=? WHERE id=?"
        )
        .run(...values);
      this.db
        .prepare(
          "INSERT INTO creator_topic_details VALUES(?,?) ON CONFLICT(topic_id) DO UPDATE SET data_json=excluded.data_json"
        )
        .run(id, JSON.stringify(brief));
      if (next.favorite !== t.favorite || next.status !== t.status) {
        const action =
          next.status !== t.status
            ? next.status
            : next.favorite
            ? "favorite"
            : "unfavorite";
        this.db
          .prepare("INSERT INTO creator_topic_feedback VALUES(?,?,?,?,?)")
          .run("tf_" + randomUUID(), id, action, reason, now());
      }
      return this._recordTopic(id);
    });
  }
  async recommend({
    useAI = false,
    allowExternalAI = false,
    materialIds,
  } = {}) {
    if (
      materialIds !== undefined &&
      (!Array.isArray(materialIds) ||
        materialIds.length > 20 ||
        new Set(materialIds).size !== materialIds.length)
    )
      fail("最多选择 20 条独立素材");
    const profile = this.profile(),
      materials =
        materialIds === undefined
          ? useAI
            ? []
            : this.db
                .prepare(
                  "SELECT id FROM creator_materials WHERE archived=0 ORDER BY created_at DESC LIMIT 20"
                )
                .all()
                .map((r) => this.material(r.id))
          : materialIds.map((id) => this.material(id)),
      events = this.core.store.events({ limit: 20 }),
      articles = this.core.editorial
        .list()
        .map((p) => ({ id: p.id, title: p.title })),
      series = this.allSeries().map((s) => ({
        id: s.id,
        name: s.name,
        goal: s.goal,
        topics: s.entries.map((e) => e.topic.title),
      })),
      feedback = this.db
        .prepare(
          "SELECT t.title,f.action,f.reason FROM creator_topic_feedback f JOIN creator_topics t ON t.id=f.topic_id ORDER BY f.rowid DESC LIMIT 30"
        )
        .all();
    let candidates;
    if (useAI) {
      const result = await this.services.chat(
        '结合画像、历史文章标题、系列与作者反馈推荐最多 8 个选题。返回 {"topics":[{"title":"","angle":"","audience":"","reason":"","problem":"","keyPoints":"","evidenceGaps":"","platforms":["wechat"],"materialIds":[]}]}。仅使用输入素材 ID。不要重新推荐作者已拒绝的相同选题；不同角度须解释区别。未核实内容列入证据缺口，不编造结论。',
        {
          profile,
          materials: materials.map((m) => ({
            id: m.id,
            title: m.title,
            body: m.body.slice(0, 3000),
            url: m.url,
            createdAt: m.created_at,
          })),
          events: events.map((e) => ({
            title: e.title,
            url: e.url,
            publishedAt: e.publishedAt,
          })),
          articles,
          series,
          feedback,
        },
        { allowExternalAI }
      );
      candidates = result.topics;
      if (!Array.isArray(candidates) || candidates.length > 8)
        fail("选题响应格式不正确", 502);
    } else
      candidates = [
        ...materials.map((m) => ({
          title: m.title,
          angle: "围绕这份素材提出自己的观点与待核实问题",
          audience: profile.audience,
          reason:
            "来自你的素材库；结合领域 " +
            (profile.domain || "待设置") +
            " 继续讨论",
          materialIds: [m.id],
        })),
        ...events.map((e) => ({
          title: e.title,
          angle: "回到来源核对后选择创作角度",
          audience: profile.audience,
          reason: "来自已采集信源；不是已核实的事实结论",
          materialIds: [],
        })),
      ].slice(0, 8);
    const allowed = new Set(materials.map((m) => m.id)),
      existing = new Set(
        this.db
          .prepare("SELECT title FROM creator_topics")
          .all()
          .map((t) => t.title)
      ),
      prepared = [];
    for (const c of candidates) {
      if (!c || typeof c.title !== "string") fail("选题响应格式不正确", 502);
      const title = text(c.title, "选题标题", 240, 3);
      if (existing.has(title)) continue;
      if (
        !Array.isArray(c.materialIds) ||
        c.materialIds.some((id) => !allowed.has(id))
      )
        fail("模型引用了未提供的素材", 502);
      const refs = c.materialIds.map((id) => ({ kind: "material", id })),
        duplicate = articles.some(
          (a) => a.title.includes(title) || title.includes(a.title)
        );
      prepared.push({
        ...this._briefDetails(c),
        title,
        angle: text(c.angle ?? "", "角度", 4000),
        audience: text(c.audience ?? profile.audience, "读者", 1000),
        reason:
          text(c.reason ?? "来源候选，需核实", "推荐原因", 1900) +
          (duplicate ? "；与历史文章主题相近，请检查重复" : ""),
        refs,
      });
      existing.add(title);
    }
    const topics = this._atomic("creator_recommend", () =>
      prepared.map((t) => this.createTopic(t))
    );
    return {
      topics,
      mode: useAI ? "model" : "local-source-candidates",
      sources: materials.map((m) => ({
        id: m.id,
        title: m.title,
        url: m.url,
        createdAt: m.created_at,
      })),
      privateMaterialsSent: useAI ? materials.length : 0,
    };
  }
  messages(id) {
    this.topic(id);
    return this.db
      .prepare(
        "SELECT id,role,content,candidate_json AS candidate,created_at AS createdAt FROM creator_topic_messages WHERE topic_id=? ORDER BY rowid"
      )
      .all(id)
      .map((r) => ({ ...r, candidate: r.candidate ? j(r.candidate) : null }));
  }
  async discussTopic(id, { message, allowExternalAI = false } = {}) {
    const topic = this.topic(id),
      profile = this.profile(),
      sources = this.resolveRefs(topic.refs);
    const result = await this.services.chat(
      '与作者讨论选题。返回 {"reply":"回复","brief":{"title":"","angle":"","audience":"","outline":"Markdown 大纲","problem":"","keyPoints":"","evidenceGaps":"","platforms":["wechat"]}}。brief 是待作者采纳的建议，不直接修改原简报。',
      {
        topic,
        profile,
        sources,
        history: this.messages(id).slice(-8),
        message: text(message, "讨论内容", 4000, 2),
      },
      { allowExternalAI }
    );
    const brief = {
      ...this._briefDetails({ ...topic, ...result.brief }),
      baseRevision: topic.revision,
      title: text(result.brief?.title || topic.title, "标题", 240, 3),
      angle: text(result.brief?.angle || "", "角度", 4000),
      audience: text(result.brief?.audience || "", "读者", 1000),
      outline: text(result.brief?.outline || "", "大纲", 12000),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [role, content, candidate] of [
        ["user", message, null],
        [
          "assistant",
          text(result.reply, "讨论回复", 6000, 1),
          JSON.stringify(brief),
        ],
      ])
        this.db
          .prepare("INSERT INTO creator_topic_messages VALUES(?,?,?,?,?,?)")
          .run("tm_" + randomUUID(), id, role, content, candidate, now());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.messages(id);
  }
  acceptTopicMessage(id, messageId, { expectedRevision } = {}) {
    const topic = this.topic(id),
      message = this.messages(id).find(
        (m) => m.id === messageId && m.role === "assistant"
      );
    if (!message?.candidate) fail("选题建议不存在", 404);
    if (
      topic.revision !== expectedRevision ||
      message.candidate.baseRevision !== expectedRevision
    )
      fail("选题已在讨论后变化，请对照旧建议重新合并", 409);
    return this.updateTopic(id, { ...message.candidate, expectedRevision });
  }
  startTopic(id) {
    const t = this.topic(id);
    if (t.projectId) return this.writing.document(t.projectId, "master");
    const doc = this.writing.create({
      title: t.title,
      idempotencyKey: "topic/" + id,
    });
    this.db
      .prepare(
        "INSERT OR IGNORE INTO creator_project_context VALUES(?,?,?,'[]','{}')"
      )
      .run(doc.projectId, id, JSON.stringify(t.refs));
    for (const ref of t.refs)
      this.db
        .prepare("INSERT OR REPLACE INTO creator_asset_usage VALUES(?,?,?,?,?)")
        .run(doc.projectId, ref.kind, ref.id, ref.revision || 0, now());
    this.updateTopic(id, { expectedRevision: t.revision, status: "writing" });
    this.db
      .prepare(
        "UPDATE creator_series_entries SET project_id=?,status='writing' WHERE topic_id=?"
      )
      .run(doc.projectId, id);
    return this.writing.document(doc.projectId, "master");
  }
  resolveRefs(refs) {
    return refs.map((ref) => {
      if (this.sourceRemoved(ref.kind, ref.id))
        return {
          ...ref,
          title: "已移除的参考来源",
          unavailable: true,
          text: "",
        };

      if (ref.kind === "material") {
        const m = this.material(ref.id);
        return {
          ...ref,
          title: m.title,
          text: m.body.slice(0, 15000),
          url: m.url,
          sourceRevision: null,
        };
      }
      if (ref.kind === "article") {
        const current = this.writing.document(ref.id, "master"),
          d = ref.revision
            ? this.writing
                .history(ref.id, "master")
                .find((h) => h.revision === ref.revision)
            : current;
        if (!d) fail("参考文章历史版本不存在", 404);
        return {
          ...ref,
          title: current.title,
          text: d.markdown.slice(0, 15000),
          sourceRevision: d.revision,
          currentRevision: current.revision,
          outdated: current.revision !== d.revision,
        };
      }
      const a = this.core.assets.get(ref.id);
      return { ...ref, title: a.alt || a.filename, assetId: a.id };
    });
  }
  context(id, channel = "master") {
    this.core.editorial._project(id);
    const row = this.db
        .prepare("SELECT * FROM creator_project_context WHERE project_id=?")
        .get(id),
      profile = this.profile();
    const refs = row ? j(row.refs_json) : [],
      excluded = row ? j(row.excluded_json) : [],
      overrides = row ? j(row.profile_json) : {};
    const channelOverrides =
      channel === "master"
        ? {}
        : j(
            this.db
              .prepare(
                "SELECT data_json FROM creator_channel_profiles WHERE project_id=? AND channel=?"
              )
              .get(id, channel)?.data_json || "{}"
          );
    const accountRow = this.db
        .prepare(
          "SELECT a.id,a.name FROM creator_project_accounts p JOIN publishing_accounts a ON a.id=p.account_id WHERE p.project_id=? AND p.channel=?"
        )
        .get(id, channel),
      accountProfile = accountRow
        ? this.core.publishing.accountProfile(accountRow.id)
        : null;
    return {
      account: accountRow
        ? {
            ...accountRow,
            revision: accountProfile.revision,
            positioning: accountProfile.data.positioning || "",
          }
        : null,
      accountOverrides: accountProfile?.data || {},
      revision:
        this.db
          .prepare(
            "SELECT revision FROM creator_context_state WHERE project_id=?"
          )
          .get(id)?.revision || 0,
      channelOverrides,
      topic: row?.topic_id ? this.topic(row.topic_id) : null,
      profile: {
        ...profile,
        ...accountProfile?.data,
        ...overrides,
        ...channelOverrides,
      },
      profileRevision: profile.revision,
      overrides,
      refs,
      excluded,
      sources: this.resolveRefs(
        refs.filter((ref) => !excluded.includes(ref.id))
      ),
    };
  }
  setContext(
    id,
    {
      refs = [],
      excluded = [],
      overrides = {},
      channelOverrides = {},
      expectedRevision,
      accountId,
    } = {},
    channel = "master"
  ) {
    this.core.editorial._project(id);
    refs = this._refs(refs);
    this.core.editorial._channel(id, channel);
    if (
      accountId !== undefined &&
      accountId !== null &&
      typeof accountId !== "string"
    )
      fail("账号格式无效");
    if (accountId) {
      const account = this.core.publishing.account(accountId);
      if (account.platform !== channel) fail("账号不属于当前平台", 400);
    }
    const revision = this.context(id, channel).revision;
    if (expectedRevision !== undefined && expectedRevision !== revision)
      fail("创作上下文已在其他页面变化，请重新载入后合并", 409);
    if (
      !overrides ||
      typeof overrides !== "object" ||
      Array.isArray(overrides) ||
      !channelOverrides ||
      typeof channelOverrides !== "object" ||
      Array.isArray(channelOverrides)
    )
      fail("写作偏好格式无效");
    if (
      !channelOverrides ||
      Object.keys(channelOverrides).some(
        (k) =>
          ![
            "tone",
            "audience",
            "structure",
            "avoid",
            "length",
            "visual",
          ].includes(k)
      )
    )
      fail("平台偏好字段无效");
    for (const value of Object.values(channelOverrides))
      text(value, "平台偏好", 2000);
    overrides = Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== "")
    );
    channelOverrides = Object.fromEntries(
      Object.entries(channelOverrides).filter(([, v]) => v !== "")
    );
    if (
      !Array.isArray(excluded) ||
      excluded.some((id) => !refs.some((r) => r.id === id))
    )
      fail("排除项不属于所选素材");
    if (
      !overrides ||
      Object.keys(overrides).some(
        (k) =>
          ![
            "tone",
            "audience",
            "structure",
            "avoid",
            "length",
            "visual",
          ].includes(k)
      )
    )
      fail("单篇偏好字段无效");
    for (const value of Object.values(overrides)) text(value, "单篇偏好", 2000);
    return this._atomic("creator_context", () => {
      if (accountId !== undefined) {
        if (accountId)
          this.db
            .prepare(
              "INSERT INTO creator_project_accounts VALUES(?,?,?) ON CONFLICT(project_id,channel) DO UPDATE SET account_id=excluded.account_id"
            )
            .run(id, channel, accountId);
        else
          this.db
            .prepare(
              "DELETE FROM creator_project_accounts WHERE project_id=? AND channel=?"
            )
            .run(id, channel);
      }
      const old = this.db
        .prepare(
          "SELECT topic_id FROM creator_project_context WHERE project_id=?"
        )
        .get(id);
      this.db
        .prepare(
          "INSERT INTO creator_project_context VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET refs_json=excluded.refs_json,excluded_json=excluded.excluded_json,profile_json=excluded.profile_json"
        )
        .run(
          id,
          old?.topic_id || "",
          JSON.stringify(refs),
          JSON.stringify(excluded),
          JSON.stringify(overrides)
        );
      for (const ref of refs)
        this.db
          .prepare(
            "INSERT OR REPLACE INTO creator_asset_usage VALUES(?,?,?,?,?)"
          )
          .run(
            id,
            ref.kind,
            ref.id,
            ref.kind === "article" ? ref.revision : 0,
            now()
          );
      if (channel !== "master")
        this.db
          .prepare(
            "INSERT INTO creator_channel_profiles VALUES(?,?,?) ON CONFLICT(project_id,channel) DO UPDATE SET data_json=excluded.data_json"
          )
          .run(id, channel, JSON.stringify(channelOverrides));
      this.db
        .prepare(
          "INSERT INTO creator_context_state VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision"
        )
        .run(id, revision + 1);
      const result = this.context(id, channel);
      this.db
        .prepare("INSERT INTO creator_context_history VALUES(?,?,?,?,?)")
        .run(id, result.revision, channel, JSON.stringify(result), now());
      return result;
    });
  }
  library({
    q = "",
    kind = "",
    tag = "",
    archived = false,
    seriesId = "",
    platform = "",
    from = "",
    to = "",
  } = {}) {
    if (platform && !["wechat", "zhihu", "xiaohongshu"].includes(platform))
      fail("平台筛选无效");
    if (seriesId) this.series(seriesId);
    const boundary = (value) => {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
      )
        fail("日期筛选无效");
      return Date.parse(value + "T00:00:00+08:00");
    };
    const start = from ? boundary(from) : -Infinity,
      end = to ? boundary(to) + 86400000 : Infinity;
    if (start >= end) fail("开始日期需早于或等于结束日期");
    const projects = this.core.editorial.list(),
      projectMap = new Map(projects.map((p) => [p.id, p])),
      members = this.db
        .prepare(
          "SELECT series_id,project_id FROM creator_series_entries WHERE project_id!=''"
        )
        .all(),
      facts = this.db
        .prepare("SELECT DISTINCT project_id,channel FROM publishing_facts")
        .all(),
      xhsUses = new Map();
    for (const plan of this.db
      .prepare(
        "SELECT project_id,channel_revision,data_json,created_at FROM xhs_plans"
      )
      .all()) {
      for (const page of j(plan.data_json).pages || [])
        for (const assetId of [
          page.asset?.id,
          page.assetId,
          page.backgroundAssetId,
        ].filter(Boolean)) {
          const records = xhsUses.get(assetId) || [];
          if (!records.some((r) => r.projectId === plan.project_id))
            records.push({
              projectId: plan.project_id,
              revision: plan.channel_revision,
              createdAt: plan.created_at,
            });
          xhsUses.set(assetId, records);
        }
    }
    const entries = [
      ...this.db
        .prepare("SELECT * FROM creator_materials ORDER BY created_at DESC")
        .all()
        .map((m) => ({
          id: m.id,
          kind: "material",
          title: m.title,
          text: m.body,
          url: m.url,
          tags: j(m.tags_json),
          createdAt: m.created_at,
          archived: !!m.archived,
        })),
      ...projects.map((p) => ({
        id: p.id,
        kind: "article",
        title: p.title,
        text: this.writing.document(p.id, "master").markdown,
        tags: [],
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        archived: false,
      })),
      ...this.db
        .prepare("SELECT id FROM content_assets ORDER BY created_at DESC")
        .all()
        .map((row) => this.core.assets.get(row.id))
        .map((a) => ({
          id: a.id,
          kind: "image",
          title: a.alt || a.filename,
          text: a.filename,
          previewUrl: a.previewUrl,
          tags: [],
          createdAt: a.createdAt,
          archived: false,
        })),
    ];
    for (const e of entries) {
      const m = this.db
        .prepare("SELECT * FROM creator_asset_meta WHERE kind=? AND asset_id=?")
        .get(e.kind, e.id);
      if (m) {
        e.tags = j(m.tags_json);
        e.archived = !!m.archived;
      }
      e.usage = this.db
        .prepare(
          "SELECT project_id AS projectId,revision,created_at AS createdAt FROM creator_asset_usage WHERE kind=? AND asset_id=?"
        )
        .all(e.kind, e.id);
    }
    for (const entry of entries) {
      if (entry.kind === "image")
        for (const use of xhsUses.get(entry.id) || [])
          if (!entry.usage.some((r) => r.projectId === use.projectId))
            entry.usage.push(use);
      const projectIds = new Set([
        ...(entry.kind === "article" ? [entry.id] : []),
        ...entry.usage.map((r) => r.projectId),
      ]);
      entry.series = [
        ...new Set(
          members
            .filter((m) => projectIds.has(m.project_id))
            .map((m) => m.series_id)
        ),
      ];
      const channels = new Set(
        facts.filter((f) => projectIds.has(f.project_id)).map((f) => f.channel)
      );
      for (const projectId of projectIds) {
        const project = projectMap.get(projectId);
        if (!project) continue;
        for (const channel of ["wechat", "zhihu", "xiaohongshu"])
          if (project.channels[channel]) {
            const doc = this.writing.document(projectId, channel);
            if (
              doc.markdown.trim() &&
              (doc.mode === "markdown" || doc.revision > 1)
            )
              channels.add(channel);
          }
      }
      if (entry.kind === "image" && xhsUses.has(entry.id))
        channels.add("xiaohongshu");
      entry.platforms = [...channels];
    }
    let hits = null;
    if (q.length >= 3) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec("DELETE FROM creator_search");
        const put = this.db.prepare(
          "INSERT INTO creator_search VALUES(?,?,?,?,?)"
        );
        for (const e of entries)
          if (!this.sourceRemoved(e.kind, e.id))
            put.run(e.id, e.kind, e.title, e.text, e.tags.join(" "));
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
      const term = '"' + q.slice(0, 100).replaceAll('"', '""') + '"';
      hits = new Set(
        this.db
          .prepare(
            "SELECT id FROM creator_search WHERE creator_search MATCH ? LIMIT 500"
          )
          .all(term)
          .map((r) => r.id)
      );
    }
    return entries
      .filter(
        (e) =>
          (!kind || e.kind === kind) &&
          !this.sourceRemoved(e.kind, e.id) &&
          e.archived === archived &&
          (!seriesId || e.series.includes(seriesId)) &&
          (!platform || e.platforms.includes(platform)) &&
          Date.parse(e.createdAt) >= start &&
          Date.parse(e.createdAt) < end &&
          (!tag || e.tags.includes(tag)) &&
          (!q ||
            (hits
              ? hits.has(e.id)
              : (e.title + e.text).toLowerCase().includes(q.toLowerCase())))
      )
      .map((e) => ({ ...e, text: e.text.slice(0, 1500) }));
  }
  assetMeta({ kind, id, tags = [], archived = false } = {}) {
    this._refs([{ kind, id }]);
    if (
      !Array.isArray(tags) ||
      tags.length > 20 ||
      typeof archived !== "boolean"
    )
      fail("资产设置格式无效");
    this.db
      .prepare(
        "INSERT INTO creator_asset_meta VALUES(?,?,?,?) ON CONFLICT(kind,asset_id) DO UPDATE SET tags_json=excluded.tags_json,archived=excluded.archived"
      )
      .run(
        kind,
        id,
        JSON.stringify(tags.map((t) => text(t, "标签", 40, 1))),
        archived ? 1 : 0
      );
    return { ok: true };
  }
  createSeries({
    name,
    goal,
    timezone = this.profile().timezone,
    cadenceDays = 7,
    nextRunAt,
    backgroundAI = false,
    entries = [],
  } = {}) {
    text(name, "系列名称", 160, 2);
    text(goal, "系列目标", 4000, 2);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      fail("时区无效");
    }
    if (!Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 365)
      fail("创作间隔需为 1–365 天");
    const first = nextRunAt ? new Date(nextRunAt) : new Date();
    if (!Number.isFinite(first.getTime())) fail("准备时间无效");
    if (!Array.isArray(entries) || entries.length > 50) fail("系列最多 50 篇");
    if (backgroundAI && !this.services.availability().text)
      fail("自动调用 AI 前请先配置写作服务");
    const id = "sr_" + randomUUID();
    const checked = entries.length
      ? entries
      : [
          goal + "：入门与目标",
          goal + "：具体方法",
          goal + "：实践复盘",
          goal + "：常见问题",
        ];
    checked.forEach((t) => text(t, "篇目标题", 240, 3));
    this.db
      .prepare("INSERT INTO creator_series VALUES(?,1,?,?,'active',?,?,?,?,?)")
      .run(
        id,
        name.trim(),
        goal.trim(),
        timezone,
        cadenceDays,
        first.toISOString(),
        backgroundAI ? 1 : 0,
        now()
      );
    const list = checked;
    list.forEach((title, index) => {
      const t = this.createTopic({
        title,
        angle: goal,
        audience: this.profile().audience,
        reason: "系列计划候选，等待作者确认",
      });
      this.db
        .prepare(
          "INSERT INTO creator_series_entries VALUES(?,?,?,?,'pending','')"
        )
        .run("se_" + randomUUID(), id, t.id, index);
    });
    return this.series(id);
  }
  series(id) {
    const row = this.db
      .prepare("SELECT * FROM creator_series WHERE id=?")
      .get(id);
    if (!row) fail("系列不存在", 404);
    return {
      id: row.id,
      revision: row.revision,
      name: row.name,
      goal: row.goal,
      status: row.status,
      timezone: row.timezone,
      cadenceDays: row.cadence_days,
      nextRunAt: row.next_run_at,
      backgroundAI: !!row.background_ai,
      entries: this.db
        .prepare(
          "SELECT * FROM creator_series_entries WHERE series_id=? ORDER BY position"
        )
        .all(id)
        .map((e) => ({ ...e, topic: this.topic(e.topic_id) })),
    };
  }
  allSeries() {
    return this.db
      .prepare("SELECT id FROM creator_series ORDER BY created_at DESC")
      .all()
      .map((r) => this.series(r.id));
  }
  updateSeries(
    id,
    {
      expectedRevision,
      status,
      name,
      goal,
      nextRunAt,
      backgroundAI,
      timezone,
      cadenceDays,
    } = {}
  ) {
    const s = this.series(id);
    if (s.revision !== expectedRevision) fail("系列已变化，请重新载入", 409);
    if (status && !["active", "paused", "completed"].includes(status))
      fail("系列状态无效");
    if (nextRunAt && !Number.isFinite(Date.parse(nextRunAt)))
      fail("准备时间无效");
    if (
      cadenceDays !== undefined &&
      (!Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 365)
    )
      fail("准备间隔需为 1–365 天");
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone || s.timezone });
    } catch {
      fail("时区无效");
    }
    if (backgroundAI && !this.services.availability().text)
      fail("请先配置写作服务");
    this.db
      .prepare(
        "UPDATE creator_series SET revision=revision+1,status=?,name=?,goal=?,next_run_at=?,background_ai=?,timezone=?,cadence_days=? WHERE id=?"
      )
      .run(
        status || s.status,
        name === undefined ? s.name : text(name, "名称", 160, 2),
        goal === undefined ? s.goal : text(goal, "目标", 4000, 2),
        nextRunAt || s.nextRunAt,
        backgroundAI === undefined
          ? s.backgroundAI
            ? 1
            : 0
          : backgroundAI
          ? 1
          : 0,
        timezone || s.timezone,
        cadenceDays ?? s.cadenceDays,
        id
      );
    if (status && status !== "active")
      this.db
        .prepare(
          "UPDATE creator_jobs SET status='cancelled' WHERE target_id=? AND status='queued'"
        )
        .run(id);
    return this.series(id);
  }
  _seriesPayload(series) {
    const entry = series.entries.find((e) => e.status === "pending"),
      refs = entry
        ? entry.topic.refs.length
          ? entry.topic.refs
          : this.library()
              .filter((x) => x.kind === "material")
              .slice(0, 5)
              .map((x) => ({ kind: "material", id: x.id }))
        : [];
    return {
      kind: "series_prepare",
      seriesRevision: series.revision,
      series: { name: series.name, goal: series.goal },
      entryId: entry?.id || null,
      topic: entry?.topic || null,
      refs: this._refs(refs),
      materials: this.resolveRefs(this._refs(refs)),
      profile: this.profile(),
      backgroundAI: series.backgroundAI,
      providerBinding: series.backgroundAI
        ? this.services.captureBinding()
        : null,
      maxRequests: series.backgroundAI ? 1 : 0,
      capturedAt: now(),
    };
  }
  _jobPayload(job) {
    return j(
      this.db
        .prepare("SELECT data_json FROM creator_job_payloads WHERE job_id=?")
        .get(job.id)?.data_json || "null"
    );
  }
  _storeJobPayload(id, payload) {
    this.db
      .prepare("INSERT OR IGNORE INTO creator_job_payloads VALUES(?,?)")
      .run(id, JSON.stringify(payload));
  }
  enqueueSeries(id, key = "manual/" + randomUUID()) {
    const series = this.series(id);
    if (series.status !== "active") fail("请先恢复该系列", 409);
    const existing = this.db
      .prepare("SELECT * FROM creator_jobs WHERE dedupe_key=?")
      .get(key);
    if (existing) return this.job(existing.id);
    const active = this.db
      .prepare(
        "SELECT * FROM creator_jobs WHERE target_id=? AND kind='series_prepare' AND status IN ('queued','running') ORDER BY rowid LIMIT 1"
      )
      .get(id);
    if (active) return this.job(active.id);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM creator_jobs WHERE target_id=? AND kind='series_prepare' AND status IN ('unknown','blocked')"
        )
        .get(id)
    )
      fail("请先核对未完成的准备任务，再创建新任务", 409);
    const identifier = "cj_" + randomUUID(),
      payload = this._seriesPayload(series);
    return this._atomic("creator_enqueue", () => {
      this.db
        .prepare(
          "INSERT INTO creator_jobs(id,kind,target_id,dedupe_key,status,created_at) VALUES(?,'series_prepare',?,?,'queued',?)"
        )
        .run(identifier, id, key, now());
      this._storeJobPayload(identifier, payload);
      return this.job(identifier);
    });
  }
  job(id) {
    const row = this.db
      .prepare("SELECT * FROM creator_jobs WHERE id=?")
      .get(id);
    if (!row) fail("准备任务不存在", 404);
    const p = this._jobPayload(row);
    return {
      ...row,
      summary: p
        ? {
            topic: p.topic?.title || null,
            projectId: p.projectId || null,
            revision: p.revision || null,
            profileRevision: p.profile?.revision || null,
            seriesRevision: p.seriesRevision || null,
            backgroundAI: !!p.backgroundAI,
            capturedAt: p.capturedAt,
            service: p.providerBinding
              ? {
                  id: p.providerBinding.id,
                  name: p.providerBinding.name,
                  model: p.providerBinding.model,
                }
              : null,
            maxRequests: p.maxRequests ?? null,
          }
        : null,
      review:
        this.db
          .prepare(
            "SELECT outcome,note,retry_job_id AS retryJobId,created_at AS createdAt FROM creator_job_reviews WHERE job_id=?"
          )
          .get(id) || null,
    };
  }
  jobs() {
    return this.db
      .prepare("SELECT id FROM creator_jobs ORDER BY rowid DESC LIMIT 100")
      .all()
      .map((r) => this.job(r.id));
  }
  _assertJobRunning(id) {
    if (
      this.db.prepare("SELECT status FROM creator_jobs WHERE id=?").get(id)
        ?.status !== "running"
    )
      fail("任务已中断或已被核对，返回结果未保存", 409);
  }
  reviewJob(
    id,
    {
      expectedStatus,
      outcome,
      note,
      allowExternalAI = false,
      rebindService = false,
    } = {}
  ) {
    const original = this.job(id);
    if (!["cancel", "retry"].includes(outcome))
      fail("请选择取消或确认后重新执行");
    note = text(note, "核对依据", 2000, 8);
    if (original.review) {
      if (original.review.outcome === outcome && original.review.note === note)
        return {
          job: original,
          retryJob: original.review.retryJobId
            ? this.job(original.review.retryJobId)
            : null,
        };
      fail("任务已经核对，不能重复变更", 409);
    }
    if (
      original.status !== expectedStatus ||
      !["unknown", "blocked"].includes(original.status)
    )
      fail("任务状态已变化，请重新载入", 409);
    const payload = this._jobPayload(original);
    if (typeof rebindService !== "boolean") fail("服务重新绑定选项无效");
    if (outcome === "retry") {
      if (!payload) fail("旧任务缺少版本快照，请取消旧任务后重新准备", 409);
      if (payload.backgroundAI && !allowExternalAI)
        fail("重试会产生新的模型请求，请确认本次费用授权", 403);
      if (original.kind === "series_prepare") {
        const s = this.series(original.target_id);
        if (
          s.status !== "active" ||
          s.revision !== payload.seriesRevision ||
          (payload.topic &&
            this.topic(payload.topic.id).revision !== payload.topic.revision)
        )
          fail("系列或选题已变化，请取消旧任务后按新计划准备", 409);
      } else if (
        !this.profile().learningEnabled ||
        !this.profile().backgroundAI
      )
        fail("请先恢复后台画像学习", 409);
    }
    return this._atomic("creator_review_job", () => {
      const retryId = outcome === "retry" ? "cj_" + randomUUID() : null;
      if (
        !this.db
          .prepare(
            "UPDATE creator_jobs SET status='reconciled',detail=? WHERE id=? AND status=?"
          )
          .run(
            outcome === "retry"
              ? "作者核对后创建新尝试"
              : "作者核对后取消，不代表费用退还",
            id,
            expectedStatus
          ).changes
      )
        fail("任务状态已变化", 409);
      if (retryId) {
        this.db
          .prepare(
            "INSERT INTO creator_jobs(id,kind,target_id,dedupe_key,status,created_at) VALUES(?,?,?,?,'queued',?)"
          )
          .run(
            retryId,
            original.kind,
            original.target_id,
            "retry/" + id,
            now()
          );
        this._storeJobPayload(
          retryId,
          rebindService && payload.backgroundAI
            ? {
                ...payload,
                providerBinding: this.services.captureBinding(),
                maxRequests: 1,
              }
            : payload
        );
      }
      this.db
        .prepare("INSERT INTO creator_job_reviews VALUES(?,?,?,?,?)")
        .run(id, outcome, note, retryId, now());
      return {
        job: this.job(id),
        retryJob: retryId ? this.job(retryId) : null,
      };
    });
  }
  async runDue(clock = Date.now()) {
    this.db
      .prepare(
        "UPDATE creator_jobs SET status='unknown',detail='执行中断，请核对已有结果和模型用量后处理' WHERE status='running' AND lease_until<?"
      )
      .run(new Date(clock).toISOString());
    const dueSource = this.sources().find(
      (s) =>
        s.enabled && (!s.last_run || clock - Date.parse(s.last_run) > 3600000)
    );
    if (dueSource)
      try {
        await this.syncSource(dueSource.id);
      } catch {}
    for (const series of this.allSeries().filter(
      (s) => s.status === "active" && Date.parse(s.nextRunAt) <= clock
    ))
      try {
        this.enqueueSeries(series.id, series.id + "/" + series.nextRunAt);
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    const job = this.db
      .prepare(
        "SELECT * FROM creator_jobs WHERE status='queued' ORDER BY rowid LIMIT 1"
      )
      .get();
    if (!job) return;
    if (
      !this.db
        .prepare(
          "UPDATE creator_jobs SET status='running',lease_until=? WHERE id=? AND status='queued'"
        )
        .run(new Date(clock + 180000).toISOString(), job.id).changes
    )
      return;
    if (job.kind === "style_learn") {
      try {
        if (!this.profile().learningEnabled || !this.profile().backgroundAI)
          fail("学习已暂停", 409);
        const payload = this._jobPayload(job);
        if (!payload?.revision)
          fail("旧学习任务缺少来源版本，请核对后重新选择文章", 409);
        await this.services.usingTask(
          job.id,
          payload.providerBinding,
          payload.maxRequests,
          () =>
            this.inferStyle({
              projectIds: [job.target_id],
              revisions: { [job.target_id]: payload.revision },
              allowExternalAI: true,
              requireBackgroundConsent: true,
              jobId: job.id,
            })
        );
        this._assertJobRunning(job.id);
        this.db
          .prepare(
            "UPDATE creator_jobs SET status='completed',detail='画像建议已生成，等待作者确认' WHERE id=?"
          )
          .run(job.id);
        this.db
          .prepare(
            "INSERT OR IGNORE INTO creator_notifications VALUES(?,?,?,?,0,?)"
          )
          .run(
            "nt_" + randomUUID(),
            job.id,
            "新的写作画像建议待审阅",
            "/settings",
            now()
          );
      } catch (e) {
        this.db
          .prepare(
            "UPDATE creator_jobs SET status=?,detail=? WHERE id=? AND status='running'"
          )
          .run(
            e.status === 409 ? "cancelled" : "blocked",
            e.status === 409
              ? "学习授权或任务状态已变化，未应用画像"
              : "学习未完成，请检查服务与用量后核对",
            job.id
          );
      }
      return;
    }
    try {
      const series = this.series(job.target_id);
      if (series.status !== "active") fail("系列已暂停", 409);
      let payload = this._jobPayload(job);
      if (!payload) {
        payload = {
          ...this._seriesPayload(series),
          providerBinding: null,
          legacySnapshot: true,
        };
        this._storeJobPayload(job.id, payload);
      }
      if (series.revision !== payload.seriesRevision)
        fail("系列在排队后已调整", 409);
      const entry = series.entries.find((e) => e.id === payload.entryId);
      if (!payload.entryId) {
        this.db
          .prepare("UPDATE creator_series SET next_run_at=? WHERE id=?")
          .run(
            nextSeriesRun(
              new Date(clock).toISOString(),
              series.cadenceDays,
              series.timezone
            ),
            series.id
          );
        this.db
          .prepare(
            "UPDATE creator_jobs SET status='completed',detail='全部篇目已准备，正文与发布仍由作者决定' WHERE id=?"
          )
          .run(job.id);
        return;
      }
      if (
        !entry ||
        entry.status !== "pending" ||
        entry.topic.revision !== payload.topic.revision
      )
        fail("篇目在排队后已变化", 409);
      if (payload.refs.some((r) => this.sourceRemoved(r.kind, r.id)))
        fail("准备来源已移除", 409);
      let prepared = {
        outline: "## 核心问题\n\n## 方法与素材\n\n## 作者观点与待核实事项",
        angle: payload.series.goal,
        audience: payload.profile.audience,
      };
      if (payload.backgroundAI)
        prepared = await this.services.usingTask(
          job.id,
          payload.providerBinding,
          payload.maxRequests,
          () =>
            this.services.chat(
              '为系列下一篇准备大纲与角度，不写完整文章。返回 {"outline":"Markdown大纲","angle":"角度","audience":"读者"}；材料是待核实来源，不是已确立事实。',
              {
                series: payload.series,
                topic: payload.topic,
                profile: payload.profile,
                materials: payload.materials,
              },
              { allowExternalAI: true }
            )
        );
      this._assertJobRunning(job.id);
      const current = this.series(series.id);
      if (
        current.status !== "active" ||
        current.revision !== payload.seriesRevision
      )
        fail("系列在准备过程中已调整", 409);
      this._atomic("creator_prepare_result", () => {
        this._assertJobRunning(job.id);
        this.updateTopic(entry.topic.id, {
          expectedRevision: payload.topic.revision,
          outline: text(prepared.outline, "大纲", 12000),
          angle: text(prepared.angle, "角度", 4000),
          audience: text(prepared.audience, "读者", 1000),
          status: "prepared",
          refs: payload.refs,
        });
        this.db
          .prepare(
            "UPDATE creator_series_entries SET status='ready' WHERE id=?"
          )
          .run(entry.id);
        const next = nextSeriesRun(
          new Date(Math.max(Date.parse(series.nextRunAt), clock)).toISOString(),
          series.cadenceDays,
          series.timezone
        );
        this.db
          .prepare("UPDATE creator_series SET next_run_at=? WHERE id=?")
          .run(next, series.id);
        this.db
          .prepare(
            "UPDATE creator_jobs SET status='completed',detail=? WHERE id=?"
          )
          .run(
            payload.backgroundAI
              ? "已按确认的来源版本准备大纲"
              : "已整理本地大纲与材料，未调用模型",
            job.id
          );
        this.db
          .prepare(
            "INSERT OR IGNORE INTO creator_notifications VALUES(?,?,?,?,0,?)"
          )
          .run(
            "nt_" + randomUUID(),
            job.id,
            "下一篇选题和大纲已准备",
            "/topics?topic=" + entry.topic.id,
            now()
          );
      });
    } catch (e) {
      this.db
        .prepare(
          "UPDATE creator_jobs SET status=?,detail=? WHERE id=? AND status='running'"
        )
        .run(
          e.status === 409 ? "cancelled" : "blocked",
          e.status === 409
            ? "计划、选题或任务状态已变化，未覆盖内容"
            : "准备未完成，请检查模型设置与用量后核对",
          job.id
        );
    }
  }
  sources() {
    return this.db
      .prepare("SELECT * FROM creator_sources ORDER BY rowid DESC")
      .all();
  }
  saveSource({
    id,
    name,
    url,
    enabled = true,
    allowExternalRequest = false,
  } = {}) {
    if (!allowExternalRequest) fail("请确认订阅该公开信源", 403);
    url = publicResource(url).href;
    name = text(name, "信源名称", 100, 2);
    const identifier = id || "cs_" + randomUUID();
    if (id && !this.sources().some((s) => s.id === id)) fail("信源不存在", 404);
    this.db
      .prepare(
        "INSERT INTO creator_sources(id,name,url,enabled) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,enabled=excluded.enabled"
      )
      .run(identifier, name, url, enabled ? 1 : 0);
    return this.sources();
  }
  removeSource(id) {
    if (
      !this.db.prepare("DELETE FROM creator_sources WHERE id=?").run(id).changes
    )
      fail("信源不存在", 404);
    return this.sources();
  }
  async syncSource(id) {
    const source = this.sources().find((s) => s.id === id);
    if (!source) fail("信源不存在", 404);
    try {
      const r = await publicRequest(publicResource(source.url), {
        timeout: 12000,
        maxBytes: 1500000,
      });
      if (!r.ok) throw Error();
      const items = parseFeed(await r.text(), source.url, 30);
      let imported = 0;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const entry of items) {
          let url;
          try {
            url = publicResource(entry.url).href;
          } catch {
            continue;
          }
          if (
            this.db
              .prepare("SELECT 1 FROM creator_materials WHERE url=?")
              .get(url)
          )
            continue;
          this.addMaterial({
            kind: "link",
            title: entry.title.slice(0, 240),
            body: decodeHTML(entry.summary)
              .replace(/<[^>]*>/g, " ")
              .slice(0, 150000),
            url,
            tags: [source.name.slice(0, 40)],
          });
          imported++;
        }
        this.db
          .prepare("UPDATE creator_sources SET last_run=?,status=? WHERE id=?")
          .run(now(), "已同步 " + imported + " 条", id);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
      return this.sources();
    } catch {
      this.db
        .prepare(
          "UPDATE creator_sources SET last_run=?,status='读取失败；请检查公开 RSS/Atom 地址' WHERE id=?"
        )
        .run(now(), id);
      fail("公开信源读取失败，未自动跟随跳转", 502);
    }
  }
  scheduleLearning(projectId, revision) {
    const profile = this.profile();
    if (!profile.learningEnabled || !profile.backgroundAI) return;
    this.writing.document(projectId, "master");
    if (
      !this.writing
        .history(projectId, "master")
        .some((d) => d.revision === revision)
    )
      fail("学习来源版本不存在", 404);
    const key = "style/" + projectId + "/" + revision,
      existing = this.db
        .prepare("SELECT id FROM creator_jobs WHERE dedupe_key=?")
        .get(key);
    if (existing) return this.job(existing.id);
    const id = "cj_" + randomUUID();
    return this._atomic("creator_schedule_style", () => {
      this.db
        .prepare(
          "INSERT INTO creator_jobs(id,kind,target_id,dedupe_key,status,created_at) VALUES(?,'style_learn',?,?,'queued',?)"
        )
        .run(id, projectId, key, now());
      this._storeJobPayload(id, {
        projectId,
        revision,
        profile,
        backgroundAI: true,
        providerBinding: this.services.captureBinding(),
        maxRequests: 1,
        capturedAt: now(),
      });
      return this.job(id);
    });
  }
  updateEntries(id, { expectedRevision, topicIds } = {}) {
    const s = this.series(id);
    if (expectedRevision !== s.revision) fail("系列已变化", 409);
    if (
      !Array.isArray(topicIds) ||
      topicIds.length < 1 ||
      topicIds.length > 50 ||
      new Set(topicIds).size !== topicIds.length
    )
      fail("系列需包含 1–50 个独立选题");
    topicIds.forEach((id) => this.topic(id));
    const entries = new Map(s.entries.map((e) => [e.topic_id, e]));
    if (s.entries.some((e) => e.project_id && !topicIds.includes(e.topic_id)))
      fail("已开始写作的篇目需保留");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM creator_series_entries WHERE series_id=?")
        .run(id);
      topicIds.forEach((topicId, i) => {
        const e = entries.get(topicId);
        this.db
          .prepare("INSERT INTO creator_series_entries VALUES(?,?,?,?,?,?)")
          .run(
            e?.id || "se_" + randomUUID(),
            id,
            topicId,
            i,
            e?.status || "pending",
            e?.project_id || ""
          );
      });
      this.db
        .prepare("UPDATE creator_series SET revision=revision+1 WHERE id=?")
        .run(id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.series(id);
  }
  notifications() {
    return this.db
      .prepare(
        "SELECT * FROM creator_notifications ORDER BY created_at DESC LIMIT 100"
      )
      .all();
  }
  readNotification(id) {
    this.db
      .prepare("UPDATE creator_notifications SET read=1 WHERE id=?")
      .run(id);
  }
  addMetric({
    projectId,
    channel,
    url = "",
    views = null,
    likes = null,
    comments = null,
    note = "",
  } = {}) {
    this.core.editorial._channel(projectId, channel);
    for (const n of [views, likes, comments])
      if (n !== null && (!Number.isSafeInteger(n) || n < 0))
        fail("效果数据需为非负整数或留空");
    if (url) {
      try {
        const u = new URL(url);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw Error();
      } catch {
        fail("链接无效");
      }
    }
    this.db
      .prepare("INSERT INTO creator_metrics VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        "cm_" + randomUUID(),
        projectId,
        channel,
        url,
        views,
        likes,
        comments,
        text(note, "复盘备注", 4000),
        now()
      );
    return this.metrics(projectId);
  }
  metrics(id) {
    this.core.editorial._project(id);
    return this.db
      .prepare(
        "SELECT * FROM creator_metrics WHERE project_id=? ORDER BY created_at DESC"
      )
      .all(id);
  }
}

Object.assign(CreatorService.prototype, sourceLifecycle);
