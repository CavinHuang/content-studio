import { randomUUID, createHash } from "node:crypto";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { zipSync, strToU8 } from "fflate";
import { boundedResponseText } from "./bounded-response.mjs";
import { ValidationError } from "./verification.mjs";
import { markdownImageTokens } from "./image-roundtrip-reconciliation.mjs";
const fail = (message, status = 400) => {
  throw new ValidationError(message, status);
};
const now = () => new Date().toISOString();
const platforms = ["wechat", "zhihu", "xiaohongshu"];
const safeText = (s, max = 2000) => {
  if (typeof s !== "string" || s.length > max || s.includes("\0"))
    fail("字段格式无效");
  return s.trim();
};
const digest = (s) => createHash("sha256").update(s).digest("hex");
export function publishingHtml(markdown) {
  return sanitizeHtml(new Marked().parse(markdown), {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "br",
      "hr",
      "blockquote",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "del",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
    ],
    allowedAttributes: {
      p: ["style"],
      h2: ["style"],
      a: ["href", "title"],
      img: ["src", "alt", "title"],
    },
    allowedSchemes: ["https"],
    allowedSchemesByTag: { img: ["https", "asset"] },
    allowProtocolRelative: false,
    transformTags: {
      p: () => ({
        tagName: "p",
        attribs: {
          style: "font-size:16px;line-height:1.8;margin:18px 0;color:#29382f",
        },
      }),
      h2: () => ({
        tagName: "h2",
        attribs: { style: "font-size:22px;color:#285c45;margin:28px 0 16px" },
      }),
    },
  });
}
export class PublishingService {
  constructor(
    core,
    { fetchImpl = (...args) => globalThis.fetch(...args) } = {}
  ) {
    this.core = core;
    this.db = core.store.db;
    this.services = core.services;
    this.fetchImpl = fetchImpl;
    this.inflight = new Set();
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS publishing_accounts(id TEXT PRIMARY KEY,platform TEXT NOT NULL,name TEXT NOT NULL,credentials TEXT NOT NULL,capabilities TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS publishing_account_profiles(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS publishing_tokens(account_id TEXT PRIMARY KEY,encrypted TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS publishing_media(account_id TEXT NOT NULL,asset_id TEXT NOT NULL,purpose TEXT NOT NULL,value TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(account_id,asset_id,purpose));
 CREATE TABLE IF NOT EXISTS publishing_operations(id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,project_id TEXT NOT NULL,channel TEXT NOT NULL,account_id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,state TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS publishing_facts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,channel TEXT NOT NULL,account_id TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,evidence TEXT NOT NULL,value_json TEXT NOT NULL,created_at TEXT NOT NULL);
 `);
    this.db
      .prepare(
        "UPDATE publishing_operations SET state='outcome_unknown',detail='Process interrupted; reconcile before retrying' WHERE state='sending'"
      )
      .run();
  }
  capabilities() {
    return {
      wechat: {
        export: true,
        manualReport: true,
        draftAdapter: true,
        publication: false,
        liveVerified: false,
      },
      zhihu: {
        export: true,
        manualReport: true,
        draftAdapter: false,
        publication: false,
        liveVerified: false,
      },
      xiaohongshu: {
        export: true,
        manualReport: true,
        draftAdapter: false,
        publication: false,
        liveVerified: false,
      },
    };
  }
  accounts() {
    return this.db
      .prepare(
        "SELECT id,platform,name,capabilities,created_at AS createdAt FROM publishing_accounts ORDER BY created_at"
      )
      .all()
      .map((r) => ({
        ...r,
        capabilities: JSON.parse(r.capabilities),
        credentialConfigured: r.platform === "wechat",
        profile: this.accountProfile(r.id),
      }));
  }
  account(id) {
    const a = this.db
      .prepare("SELECT * FROM publishing_accounts WHERE id=?")
      .get(id);
    if (!a) fail("平台账号不存在", 404);
    return a;
  }
  accountProfile(id) {
    this.account(id);
    const row = this.db
      .prepare(
        "SELECT revision,data_json FROM publishing_account_profiles WHERE account_id=?"
      )
      .get(id);
    return {
      revision: row?.revision || 0,
      data: JSON.parse(row?.data_json || "{}"),
    };
  }
  saveAccountProfile(id, { expectedRevision, data } = {}) {
    this.account(id);
    const current = this.accountProfile(id);
    if (current.revision !== expectedRevision)
      fail("账号定位已变化，请重新载入", 409);
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).some(
        (k) =>
          ![
            "positioning",
            "audience",
            "tone",
            "structure",
            "avoid",
            "length",
            "visual",
          ].includes(k)
      )
    )
      fail("账号定位字段无效");
    const cleaned = Object.fromEntries(
      Object.entries(data)
        .map(([k, v]) => [k, safeText(v, k === "positioning" ? 4000 : 2000)])
        .filter(([, v]) => v)
    );
    this.db
      .prepare(
        "INSERT INTO publishing_account_profiles VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,data_json=excluded.data_json"
      )
      .run(id, current.revision + 1, JSON.stringify(cleaned));
    return this.accountProfile(id);
  }
  saveAccount({ id, platform, name, appId, appSecret } = {}) {
    if (!platforms.includes(platform)) fail("平台不支持");
    name = safeText(name, 100);
    if (name.length < 2) fail("请填写账号名称");
    const previous = id ? this.account(id) : null;
    if (previous && previous.platform !== platform)
      fail("不能更改账号所属平台");
    let credentials = previous?.credentials || this.services.seal({});
    if (
      platform === "wechat" &&
      (appId !== undefined || appSecret !== undefined || !previous)
    ) {
      if (
        !/^wx[a-f0-9]{16}$/i.test(appId || "") ||
        typeof appSecret !== "string" ||
        appSecret.length < 16 ||
        appSecret.length > 256
      )
        fail("请填写公众号 AppID 和 AppSecret");
      credentials = this.services.seal({ appId, appSecret });
    }
    const identifier = id || "pa_" + randomUUID();
    this.db
      .prepare(
        "INSERT INTO publishing_accounts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,credentials=excluded.credentials,capabilities=excluded.capabilities"
      )
      .run(
        identifier,
        platform,
        name,
        credentials,
        JSON.stringify({ export: true, draftRead: false, checkedAt: null }),
        previous?.created_at || now()
      );
    this.db
      .prepare("DELETE FROM publishing_tokens WHERE account_id=?")
      .run(identifier);
    this.db
      .prepare("DELETE FROM publishing_media WHERE account_id=?")
      .run(identifier);
    return this.accounts().find((a) => a.id === identifier);
  }
  removeAccount(id) {
    this.account(id);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM publishing_operations WHERE account_id=? AND state IN ('sending','outcome_unknown')"
        )
        .get(id)
    )
      fail("请先核对该账号未确定的发送结果", 409);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const t of ["publishing_tokens", "publishing_media"])
        this.db.prepare(`DELETE FROM ${t} WHERE account_id=?`).run(id);
      this.db.prepare("DELETE FROM publishing_accounts WHERE id=?").run(id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { ok: true };
  }
  async _call(path, { token, body, form, method = "POST" } = {}) {
    const u = new URL("https://api.weixin.qq.com" + path);
    if (token) u.searchParams.set("access_token", token);
    const r = await this.fetchImpl(u, {
      method,
      headers: form ? {} : { "content-type": "application/json" },
      body: method === "GET" ? undefined : form || JSON.stringify(body || {}),
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok)
      throw Object.assign(new Error("微信服务 HTTP " + r.status), {
        uncertain: r.status >= 500,
      });
    const raw = await boundedResponseText(r, 1_000_000);
    if (raw.length > 1000000)
      throw Object.assign(new Error("微信响应过大"), { uncertain: true });
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error("微信响应无法识别"), { uncertain: true });
    }
    if (data.errcode)
      throw Object.assign(
        new Error("微信接口拒绝请求，错误码 " + Number(data.errcode)),
        { providerRejected: true }
      );
    return data;
  }
  async _token(id) {
    const account = this.account(id);
    if (account.platform !== "wechat") fail("请选择公众号账号");
    const old = this.db
      .prepare("SELECT * FROM publishing_tokens WHERE account_id=?")
      .get(id);
    if (old && old.expires > Date.now() + 120000)
      return this.services.open(old.encrypted).token;
    const c = this.services.open(account.credentials),
      r = await this._call("/cgi-bin/stable_token", {
        body: {
          grant_type: "client_credential",
          appid: c.appId,
          secret: c.appSecret,
          force_refresh: false,
        },
      });
    if (!r.access_token || !Number.isFinite(r.expires_in))
      fail("微信未返回有效凭据", 502);
    this.db
      .prepare(
        "INSERT INTO publishing_tokens VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET encrypted=excluded.encrypted,expires=excluded.expires"
      )
      .run(
        id,
        this.services.seal({ token: r.access_token }),
        Date.now() + Math.min(r.expires_in, 7200) * 1000
      );
    return r.access_token;
  }
  async probe(id, { allowExternalCall = false } = {}) {
    if (!allowExternalCall) fail("请确认读取该账号的官方接口能力", 403);
    try {
      const token = await this._token(id);
      await this._call("/cgi-bin/draft/count", { token, method: "GET" });
      this.db
        .prepare("UPDATE publishing_accounts SET capabilities=? WHERE id=?")
        .run(
          JSON.stringify({
            export: true,
            draftRead: true,
            checkedAt: now(),
            draftWriteVerified: false,
          }),
          id
        );
      return this.accounts().find((a) => a.id === id);
    } catch (e) {
      fail(
        e.providerRejected
          ? e.message
          : "公众号能力检查失败，请检查凭据、IP 白名单和授权范围",
        502
      );
    }
  }
  _ready(projectId, channel, revision) {
    if (!platforms.includes(channel)) fail("请选择发布平台");
    const d = this.core.writing.document(projectId, channel);
    if (d.revision !== revision) fail("稿件已有新版本，请重新审阅", 409);
    const { problems } = this.core.editorial._canExport(projectId, channel);
    if (problems.length) fail(problems.join("；"), 409);
    return d;
  }
  _fact(projectId, channel, accountId, revision, kind, evidence, value) {
    this.db
      .prepare("INSERT INTO publishing_facts VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        "pf_" + randomUUID(),
        projectId,
        channel,
        accountId || "",
        revision,
        kind,
        evidence,
        JSON.stringify(value),
        now()
      );
  }
  history(projectId) {
    this.core.editorial._project(projectId);
    return {
      operations: this.db
        .prepare(
          "SELECT id,project_id AS projectId,channel,account_id AS accountId,revision,state,detail,created_at AS createdAt FROM publishing_operations WHERE project_id=? ORDER BY created_at DESC"
        )
        .all(projectId),
      facts: this.db
        .prepare(
          "SELECT id,channel,account_id AS accountId,revision,kind,evidence,value_json AS value,created_at AS createdAt FROM publishing_facts WHERE project_id=? ORDER BY created_at DESC"
        )
        .all(projectId)
        .map((r) => ({ ...r, value: JSON.parse(r.value) })),
    };
  }
  bundle(projectId, channel, { expectedRevision, accountId = "" } = {}) {
    const d = this._ready(projectId, channel, expectedRevision);
    if (accountId && this.account(accountId).platform !== channel)
      fail("账号与平台不一致");
    let markdown = d.markdown;
    const files = {},
      assets = [];
    for (const token of markdownImageTokens(d.markdown)) {
      if (!token.url.startsWith("asset://")) continue;
      const id = token.url.slice(8),
        a = this.core.assets.get(id),
        file =
          "images/" +
          a.id +
          "." +
          (a.mime === "image/jpeg" ? "jpg" : a.mime.split("/")[1]);
      files[file] = new Uint8Array(this.core.assets.preview(id).body);
      assets.push({ id, sha256: a.sha256, file });
      markdown = markdown.replaceAll(token.url, file);
    }
    files["article.md"] = strToU8(markdown);
    let html = publishingHtml(d.markdown);
    for (const a of assets) html = html.replaceAll("asset://" + a.id, a.file);
    files["article.html"] = strToU8(
      '<!doctype html><meta charset="utf-8"><article>' + html + "</article>"
    );
    const manifest = {
      projectId,
      channel,
      revision: d.revision,
      assets,
      publicationVerified: false,
    };
    files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    this._recordExport(d, html);
    this._fact(
      projectId,
      channel,
      accountId,
      d.revision,
      "exported",
      "local_export",
      manifest
    );
    return zipSync(files);
  }
  _recordExport(d, html = "") {
    const ref = this.core.editorial._channel(d.projectId, d.channel);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO editorial_exports VALUES(?,?,?,?,?,?)")
        .run("ex_" + randomUUID(), ref.id, d.revision, d.markdown, html, now());
      this.db
        .prepare(
          "UPDATE editorial_channel_refs SET status='exported',exported_revision=?,reported_url='',updated_at=? WHERE id=?"
        )
        .run(d.revision, now(), ref.id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  report(projectId, channel, { expectedRevision, accountId = "", url } = {}) {
    this._ready(projectId, channel, expectedRevision);
    if (accountId && this.account(accountId).platform !== channel)
      fail("账号与平台不一致");
    const u = new URL(safeText(url, 2000));
    if (u.protocol !== "https:" || u.username || u.password)
      fail("请填写不含凭据的 HTTPS 发布链接");
    const ref = this.core.editorial._channel(projectId, channel);
    if (
      ref.exported_revision === expectedRevision &&
      ["exported", "reported_published"].includes(ref.status)
    )
      this.core.editorial.reported(projectId, channel, {
        expectedRevision,
        url: u.href,
      });
    else {
      const draft = this.db
        .prepare(
          "SELECT 1 FROM publishing_facts WHERE project_id=? AND channel=? AND revision=? AND kind='draft_saved' AND (?='' OR account_id=?)"
        )
        .get(projectId, channel, expectedRevision, accountId, accountId);
      if (!draft)
        fail("请先导出当前版本或保存官方草稿，再记录实际发布链接", 409);
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO editorial_publication_reports VALUES(?,?,?,?,?)"
          )
          .run("pr_" + randomUUID(), ref.id, expectedRevision, u.href, now());
        this.db
          .prepare(
            "UPDATE editorial_channel_refs SET status='reported_published',reported_url=?,updated_at=? WHERE id=?"
          )
          .run(u.href, now(), ref.id);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    this._fact(
      projectId,
      channel,
      accountId,
      expectedRevision,
      "published",
      "author_report",
      { url: u.href, platformVerified: false }
    );
    this.db
      .prepare(
        "UPDATE creator_series_entries SET status='published' WHERE project_id=?"
      )
      .run(projectId);
    this.core.creator.scheduleLearning(
      projectId,
      this.core.writing.document(projectId, "master").revision
    );
    return this.history(projectId);
  }
  async _media(accountId, assetId, purpose, token) {
    const old = this.db
      .prepare(
        "SELECT value FROM publishing_media WHERE account_id=? AND asset_id=? AND purpose=?"
      )
      .get(accountId, assetId, purpose);
    if (old) return old.value;
    const a = this.core.assets.get(assetId),
      preview = this.core.assets.preview(assetId);
    if (!["image/png", "image/jpeg"].includes(a.mime))
      fail("公众号媒体目前支持 PNG/JPEG，请先转换其他图片", 422);
    const form = new FormData();
    form.append(
      "media",
      new Blob([preview.body], { type: a.mime }),
      a.filename
    );
    const r = await this._call(
      purpose === "cover"
        ? "/cgi-bin/material/add_material?type=image"
        : "/cgi-bin/media/uploadimg",
      { token, form }
    );
    const value = purpose === "cover" ? r.media_id : r.url;
    if (typeof value !== "string" || !value)
      throw Object.assign(new Error("微信媒体响应不完整"), { uncertain: true });
    this.db
      .prepare("INSERT OR REPLACE INTO publishing_media VALUES(?,?,?,?,?)")
      .run(accountId, assetId, purpose, value, now());
    return value;
  }
  async sendDraft(
    projectId,
    {
      expectedRevision,
      accountId,
      coverAssetId,
      idempotencyKey,
      allowExternalCall = false,
    } = {}
  ) {
    if (!allowExternalCall)
      fail("请确认把当前公众号稿及图片发送到微信草稿箱", 403);
    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 160
    )
      fail("发送请求缺少幂等标识");
    const d = this._ready(projectId, "wechat", expectedRevision),
      a = this.account(accountId);
    if (a.platform !== "wechat" || !JSON.parse(a.capabilities).draftRead)
      fail("请先检查公众号草稿接口能力", 409);
    this.core.assets.get(coverAssetId);
    const snapshot = {
        title: d.title,
        markdown: d.markdown,
        masterRevision: this.core.writing.document(projectId, "master")
          .revision,
        coverAssetId,
      },
      signature = digest(
        JSON.stringify({ projectId, accountId, expectedRevision, snapshot })
      );
    const old = this.db
      .prepare("SELECT * FROM publishing_operations WHERE idempotency_key=?")
      .get(idempotencyKey);
    if (old) {
      if (
        digest(
          JSON.stringify({
            projectId: old.project_id,
            accountId: old.account_id,
            expectedRevision: old.revision,
            snapshot: JSON.parse(old.snapshot_json),
          })
        ) !== signature
      )
        fail("同一个发送标识不能用于其他稿件", 409);
      return this.history(projectId);
    }
    const duplicate = this.db
      .prepare(
        "SELECT 1 FROM publishing_operations WHERE project_id=? AND account_id=? AND revision=? AND state IN ('sending','succeeded','outcome_unknown')"
      )
      .get(projectId, accountId, expectedRevision);
    if (duplicate) fail("该版本已发送或结果待核实，请查看发布记录", 409);
    // Reject all unsupported external images before any paid or irreversible request.
    const images = markdownImageTokens(d.markdown);
    for (const image of images) {
      if (!/^asset:\/\/as_[a-f0-9]{32}$/.test(image.url))
        fail("请先把正文图片导入本地素材库，避免发送未经审阅的外链图片", 422);
      this.core.assets.get(image.url.slice(8));
    }
    const id = "po_" + randomUUID();
    this.db
      .prepare(
        "INSERT INTO publishing_operations VALUES(?,?,?,?,?,?,?,'sending','Preparing media',?,?)"
      )
      .run(
        id,
        idempotencyKey,
        projectId,
        "wechat",
        accountId,
        expectedRevision,
        JSON.stringify(snapshot),
        now(),
        now()
      );
    let submitted = false;
    try {
      const token = await this._token(accountId),
        thumb = await this._media(accountId, coverAssetId, "cover", token);
      let markdown = d.markdown;
      for (const image of images)
        markdown = markdown.replaceAll(
          image.url,
          await this._media(accountId, image.url.slice(8), "body", token)
        );
      this._ready(projectId, "wechat", expectedRevision);
      if (
        this.core.writing.document(projectId, "master").revision !==
        snapshot.masterRevision
      )
        fail("主稿在准备过程中已变化", 409);
      submitted = true;
      const r = await this._call("/cgi-bin/draft/add", {
        token,
        body: {
          articles: [
            {
              title: d.title,
              content: publishingHtml(markdown),
              thumb_media_id: thumb,
              need_open_comment: 0,
              only_fans_can_comment: 0,
            },
          ],
        },
      });
      if (typeof r.media_id !== "string")
        throw Object.assign(new Error("微信未返回草稿标识"), {
          uncertain: true,
        });
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(
            "UPDATE publishing_operations SET state='succeeded',detail='Draft saved; not published',updated_at=? WHERE id=?"
          )
          .run(now(), id);
        this._fact(
          projectId,
          "wechat",
          accountId,
          d.revision,
          "draft_saved",
          "provider_response",
          { mediaId: r.media_id }
        );
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      const state =
        submitted && !e.providerRejected ? "outcome_unknown" : "failed";
      this.db
        .prepare(
          "UPDATE publishing_operations SET state=?,detail=?,updated_at=? WHERE id=?"
        )
        .run(
          state,
          e.providerRejected
            ? e.message
            : state === "outcome_unknown"
            ? "微信发送结果待核实，不会自动重试"
            : "准备失败，未发送正文草稿；请检查账号和素材",
          now(),
          id
        );
    }
    return this.history(projectId);
  }
  reconcile(projectId, id, { outcome, note, mediaId } = {}) {
    this.core.editorial._project(projectId);
    const r = this.db
      .prepare(
        "SELECT * FROM publishing_operations WHERE id=? AND project_id=? AND state='outcome_unknown'"
      )
      .get(id, projectId);
    if (!r) fail("待核实发送记录不存在", 404);
    if (
      !["saved", "not_saved"].includes(outcome) ||
      safeText(note, 2000).length < 8
    )
      fail("请填写在平台核对的结果与依据（至少 8 字）");
    if (outcome === "saved" && !safeText(mediaId || "", 300))
      fail("请填写平台草稿标识");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE publishing_operations SET state=?,detail=?,updated_at=? WHERE id=?"
        )
        .run(
          outcome === "saved" ? "succeeded" : "failed",
          "作者核对：" + note,
          now(),
          id
        );
      if (outcome === "saved")
        this._fact(
          projectId,
          r.channel,
          r.account_id,
          r.revision,
          "draft_saved",
          "author_report",
          { mediaId, note, platformVerified: false }
        );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.history(projectId);
  }
}
