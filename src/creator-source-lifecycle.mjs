import { createHash } from "node:crypto";
import { ValidationError } from "./verification.mjs";
const fail = (s, status = 400) => {
  throw new ValidationError(s, status);
};
const styleFields = ["tone", "structure", "avoid", "length"];
const parse = JSON.parse;
export const sourceLifecycle = {
  sourceRemoved(kind, id) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM creator_source_removals WHERE kind=? AND source_id=?"
      )
      .get(kind, id);
  },
  learningExcluded(id) {
    return !!this.db
      .prepare("SELECT 1 FROM creator_learning_exclusions WHERE project_id=?")
      .get(id);
  },
  assertLearningAllowed(id) {
    this.core.editorial._project(id);
    if (this.learningExcluded(id) || this.sourceRemoved("article", id))
      fail("这篇文章涉及已移除来源，已停止作为画像学习依据", 409);
  },
  _ensureProfileFieldSources() {
    return this._atomic("creator_profile_provenance", () => {
      let previous = {},
        previousSources = {};
      for (const row of this.db
        .prepare("SELECT * FROM creator_profile_versions ORDER BY revision")
        .all()) {
        const values = parse(row.data_json),
          sources = parse(row.source_json),
          saved = this.db
            .prepare(
              "SELECT field,sources_json FROM creator_profile_field_sources WHERE revision=?"
            )
            .all(row.revision);
        if (saved.length === Object.keys(values).length)
          previousSources = Object.fromEntries(
            saved.map((r) => [r.field, parse(r.sources_json)])
          );
        else {
          const next = {},
            existing = Object.fromEntries(
              saved.map((r) => [r.field, parse(r.sources_json)])
            );
          for (const [field, value] of Object.entries(values)) {
            next[field] =
              existing[field] ??
              (sources.length && styleFields.includes(field)
                ? sources
                : previous[field] === value
                ? previousSources[field] || []
                : []);
            this.db
              .prepare(
                "INSERT OR IGNORE INTO creator_profile_field_sources VALUES(?,?,?)"
              )
              .run(row.revision, field, JSON.stringify(next[field]));
          }
          previousSources = next;
        }
        previous = values;
      }
    });
  },
  _storeProfileFieldSources(oldRevision, newRevision, data, sources) {
    const old = this.db
        .prepare(
          "SELECT data_json FROM creator_profile_versions WHERE revision=?"
        )
        .get(oldRevision),
      values = parse(old.data_json),
      prior = this.fieldSources(oldRevision),
      next = parse(
        this.db
          .prepare(
            "SELECT data_json FROM creator_profile_versions WHERE revision=?"
          )
          .get(newRevision).data_json
      );
    for (const field of Object.keys(next)) {
      const explicit = Object.hasOwn(data, field);
      const refs =
        explicit && sources.length
          ? sources
          : explicit && data[field] !== values[field]
          ? []
          : prior[field] || [];
      this.db
        .prepare("INSERT INTO creator_profile_field_sources VALUES(?,?,?)")
        .run(newRevision, field, JSON.stringify(refs));
    }
  },
  fieldSources(revision) {
    return Object.fromEntries(
      this.db
        .prepare(
          "SELECT field,sources_json FROM creator_profile_field_sources WHERE revision=?"
        )
        .all(revision)
        .map((r) => [r.field, parse(r.sources_json)])
    );
  },
  invalidProfileFields(revision) {
    return Object.entries(this.fieldSources(revision))
      .filter(([, sources]) =>
        sources.some((s) => s.projectId && this.learningExcluded(s.projectId))
      )
      .map(([field]) => field);
  },
  restoreProfile({ expectedRevision, restoreRevision }) {
    if (!Number.isInteger(restoreRevision) || restoreRevision < 1)
      fail("画像版本无效");
    const row = this.db
      .prepare(
        "SELECT data_json FROM creator_profile_versions WHERE revision=?"
      )
      .get(restoreRevision);
    if (!row) fail("画像版本不存在", 404);
    if (this.invalidProfileFields(restoreRevision).length)
      fail("该画像版本包含已撤销的来源推断，不能整体恢复", 409);
    return this._atomic("creator_profile_restore", () => {
      const result = this.saveProfile({
        expectedRevision,
        data: parse(row.data_json),
      });
      for (const [field, sources] of Object.entries(
        this.fieldSources(restoreRevision)
      ))
        this.db
          .prepare(
            "UPDATE creator_profile_field_sources SET sources_json=? WHERE revision=? AND field=?"
          )
          .run(JSON.stringify(sources), result.revision, field);
      return result;
    });
  },
  sourceRemovalPreview({ kind, id }) {
    if (typeof id !== "string" || id.length > 200) fail("来源 ID 无效");
    if (!["article", "material"].includes(kind))
      fail("只支持文章学习来源或参考素材");
    if (kind === "article") this.core.editorial._project(id);
    else this.material(id);
    if (this.sourceRemoved(kind, id)) fail("来源已移除", 410);
    const affected = new Set(kind === "article" ? [id] : []),
      uses = this.db
        .prepare("SELECT project_id,kind,asset_id FROM creator_asset_usage")
        .all();
    for (const row of this.db
      .prepare("SELECT project_id,refs_json FROM creator_project_context")
      .all())
      for (const ref of parse(row.refs_json))
        if (ref.kind === kind && ref.id === id) affected.add(row.project_id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const use of uses)
        if (
          (use.kind === kind && use.asset_id === id) ||
          (use.kind === "article" && affected.has(use.asset_id))
        ) {
          if (!affected.has(use.project_id)) {
            affected.add(use.project_id);
            changed = true;
          }
        }
    }
    const suggestionIds = this.db
      .prepare("SELECT id,evidence_json FROM creator_style_suggestions")
      .all()
      .filter((s) =>
        parse(s.evidence_json).some((e) => affected.has(e.projectId))
      )
      .map((s) => s.id);
    const current = this.profile(),
      fields = Object.entries(this.fieldSources(current.revision))
        .filter(([, sources]) => sources.some((s) => affected.has(s.projectId)))
        .map(([field]) => field);
    return {
      kind,
      id,
      projectIds: [...affected],
      suggestionIds,
      profileFields: fields,
      expectedProfileRevision: current.revision,
      reviewToken: createHash("sha256")
        .update(
          JSON.stringify({
            kind,
            id,
            profileRevision: current.revision,
            projects: [...affected].sort(),
            suggestions: [...suggestionIds].sort(),
            fields: [...fields].sort(),
          })
        )
        .digest("hex"),
      retention:
        "当前素材内容会移除；文章正文、不可变历史及已有备份保留，不构成安全擦除。",
    };
  },
  removeSource({
    kind,
    id,
    expectedProfileRevision,
    reviewToken,
    confirmRemove = false,
  }) {
    if (confirmRemove !== true) fail("请确认移除范围及历史保留说明", 403);
    const preview = this.sourceRemovalPreview({ kind, id });
    if (expectedProfileRevision !== preview.expectedProfileRevision)
      fail("画像在确认期间已变化，请重新查看影响范围", 409);
    if (reviewToken !== preview.reviewToken)
      fail("依赖范围已变化，请重新预览并确认", 409);
    const abortIds = [];
    const result = this._atomic("creator_remove_source", () => {
      const at = new Date().toISOString(),
        affected = new Set(preview.projectIds);
      this.db
        .prepare("INSERT INTO creator_source_removals VALUES(?,?,?)")
        .run(kind, id, at);
      if (kind === "material")
        this.db
          .prepare(
            "UPDATE creator_materials SET title='已移除素材',body='',url='',tags_json='[]',archived=1 WHERE id=?"
          )
          .run(id);
      for (const projectId of affected) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO creator_learning_exclusions VALUES(?,?,?,?)"
          )
          .run(projectId, kind, id, at);
        const revision = this.context(projectId).revision;
        this.db
          .prepare(
            "INSERT INTO creator_context_state VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision"
          )
          .run(projectId, revision + 1);
      }
      for (const suggestionId of preview.suggestionIds)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO creator_style_revocations VALUES(?,?,?)"
          )
          .run(suggestionId, kind + "/" + id, at);
      for (const row of this.db
        .prepare(
          "SELECT suggestion_id,context_json FROM writing_suggestion_context"
        )
        .all()) {
        const c = parse(row.context_json);
        if (
          (c.sources || c.refs || []).some(
            (r) =>
              (r.kind === kind && r.id === id) ||
              (r.kind === "article" && affected.has(r.id))
          )
        )
          this.db
            .prepare(
              "INSERT OR IGNORE INTO writing_suggestion_revocations VALUES(?,?)"
            )
            .run(row.suggestion_id, at);
      }
      for (const row of this.db
        .prepare(
          "SELECT id,input_json,reference_id FROM writing_generations WHERE status IN ('running','completed','interrupted','failed')"
        )
        .all()) {
        const g = parse(row.input_json),
          project = this.db
            .prepare("SELECT project_id FROM editorial_channel_refs WHERE id=?")
            .get(row.reference_id)?.project_id;
        if (
          g.sourceIds?.some((s) => s === id || affected.has(s)) ||
          affected.has(project)
        ) {
          this.db
            .prepare(
              "UPDATE writing_generations SET status='revoked',partial_text='',updated_at=? WHERE id=?"
            )
            .run(at, row.id);
          abortIds.push(row.id);
        }
      }
      for (const row of this.db
        .prepare(
          "SELECT j.id,j.kind,j.target_id,p.data_json FROM creator_jobs j JOIN creator_job_payloads p ON p.job_id=j.id WHERE j.status IN ('queued','running')"
        )
        .all()) {
        const p = parse(row.data_json);
        if (
          (row.kind === "style_learn" && affected.has(row.target_id)) ||
          (p.refs || []).some(
            (r) =>
              (r.kind === kind && r.id === id) ||
              (r.kind === "article" && affected.has(r.id))
          )
        )
          this.db
            .prepare(
              "UPDATE creator_jobs SET status='cancelled',detail='来源已移除，已停止执行' WHERE id=?"
            )
            .run(row.id);
      }
      const latest = this.profile(),
        reset = {};
      for (const field of preview.profileFields) {
        const safe = this.db
          .prepare(
            "SELECT revision,data_json FROM creator_profile_versions ORDER BY revision DESC"
          )
          .all()
          .find(
            (r) =>
              !(this.fieldSources(r.revision)[field] || []).some(
                (s) => s.projectId && this.learningExcluded(s.projectId)
              )
          );
        reset[field] = safe ? parse(safe.data_json)[field] : "";
      }
      if (preview.profileFields.length) {
        const next = this.saveProfile({
          expectedRevision: latest.revision,
          data: reset,
        });
        for (const field of preview.profileFields)
          this.db
            .prepare(
              "UPDATE creator_profile_field_sources SET sources_json='[]' WHERE revision=? AND field=?"
            )
            .run(next.revision, field);
      }
      this.db.prepare("DELETE FROM creator_search").run();
      return {
        ...preview,
        removedAt: at,
        profileRevision: this.profile().revision,
      };
    });
    for (const generationId of abortIds)
      this.writing.generationControllers?.get(generationId)?.abort();
    return result;
  },
};
