import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await Promise.race([done, pause(5000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await done;
  }
}
test(
  "guarded author workspace survives process restart with sessions, image BLOBs, encrypted connections and nonduplicated jobs",
  { timeout: 120000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "creator-production-")),
      p = await port(),
      origin = "http://127.0.0.1:" + p;
    const model = createHttpServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: { content: '{"replacement":"重启后仍可查看的中断片段' },
                finish_reason: null,
              },
            ],
          }) +
          "\n\n"
      );
    });
    await new Promise((resolve, reject) =>
      model.once("error", reject).listen(0, "127.0.0.1", resolve)
    );
    const modelPort = model.address().port;
    let child;
    const start = async () => {
      child = spawn(process.execPath, ["scripts/runtime-guard.mjs", "start"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          HOSTNAME: "",
          PORT: String(p),
          NODE_ENV: "production",
          NODE_OPTIONS: "",
          CONTENT_STUDIO_MULTIUSER: "1",
          CONTENT_STUDIO_ACCOUNTS_PATH: root,
          CONTENT_STUDIO_DB_PATH: join(root, "unused.sqlite"),
          CONTENT_STUDIO_DEPLOY_MODE: "",
          CONTENT_STUDIO_ALLOW_REMOTE: "0",
          ENABLE_SCENARIO: "0",
          CONTENT_AI_API_KEY: "synthetic-restart-model-key",
          CONTENT_AI_MODEL: "synthetic-restart-model",
          CONTENT_AI_BASE_URL: "http://127.0.0.1:" + modelPort + "/v1/",
          CONTENT_IMAGE_API_KEY: "",
          CONTENT_IMAGE_OPENAI_API_KEY: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      child.stdout.on("data", (s) => {
        log = (log + s).slice(-2000);
      });
      child.stderr.on("data", (s) => {
        log = (log + s).slice(-2000);
      });
      for (let i = 0; i < 160; i++) {
        if (child.exitCode !== null)
          throw Error("Guarded process exited " + log);
        try {
          if ((await fetch(origin + "/api/health")).ok) return;
        } catch {}
        await pause(200);
      }
      throw Error("Server readiness timed out");
    };
    let cookie = "";
    async function api(path, method = "GET", body) {
      const r = await fetch(origin + path, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(r.ok, true, path + " HTTP " + r.status);
      const j = await r.json();
      return { r, j };
    }
    try {
      await start();
      await api("/api/accounts/register", "POST", {
        name: "重启测试作者",
        email: "restart@example.test",
        password: "restart-test-password",
      });
      const login = await api("/api/accounts/login", "POST", {
        email: "restart@example.test",
        password: "restart-test-password",
      });
      cookie = login.r.headers.get("set-cookie").split(";")[0];
      const topic = (
        await api("/api/creator/topics", "POST", {
          title: "重启之后继续写作的文章",
        })
      ).j;
      const doc = (
        await api("/api/creator/topics/" + topic.id + "/start", "POST", {})
      ).j;
      let saved = (
        await api("/api/writing/projects/" + doc.projectId + "/master", "PUT", {
          expectedRevision: doc.revision,
          markdown: "# 持续创作\n\n重启之后，文章与素材仍完整保留。",
        })
      ).j;
      const writingBase = "/api/writing/projects/" + doc.projectId;
      const platform = (await api(writingBase + "/wechat")).j;
      await api(writingBase + "/wechat", "PUT", {
        expectedRevision: platform.revision,
        markdown: saved.markdown,
        sourceMasterRevision: saved.revision,
      });
      saved = (
        await api(writingBase + "/master", "PUT", {
          expectedRevision: saved.revision,
          markdown: saved.markdown + "\n\n主稿在审阅前补充的新观察。",
        })
      ).j;
      const comparison = (await api(writingBase + "/wechat/master-sync")).j;
      const synced = (
        await api(writingBase + "/wechat/master-sync", "POST", {
          expectedRevision: comparison.revision,
          expectedMasterRevision: comparison.masterRevision,
          expectedSourceRevision: comparison.sourceRevision,
          reviewToken: comparison.reviewToken,
          decisions: comparison.changes.map((c) => ({
            id: c.id,
            action: "apply",
          })),
        })
      ).j;
      const syncHistory = (await api(writingBase + "/wechat/history")).j
        .history[0].masterReview;
      assert.equal(syncHistory.masterRevision, saved.revision);
      const generating = await fetch(
        origin + writingBase + "/master/generations",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: saved.revision,
            instruction: "记录一次可恢复的中断生成",
            allowExternalAI: true,
          }),
        }
      );
      assert.equal(generating.ok, true);
      const generationEvents = (await generating.text())
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(generationEvents.at(-1).type, "failed");
      const generationId = generationEvents[0].id;
      const profileAccount = (
        await api("/api/creator/platforms/accounts", "POST", {
          platform: "zhihu",
          name: "持久定位账号",
        })
      ).j;
      await api(
        "/api/creator/platforms/accounts/" + profileAccount.id + "/profile",
        "PUT",
        {
          expectedRevision: 0,
          data: { positioning: "面向独立作者的实践说明", tone: "自然克制" },
        }
      );
      await api(
        "/api/creator/projects/" + doc.projectId + "/context?channel=zhihu",
        "PUT",
        { expectedRevision: 0, accountId: profileAccount.id }
      );
      const removable = (
        await api("/api/creator/materials", "POST", {
          title: "重启前移除的素材",
          body: "不应作为当前素材继续返回的合成文本",
        })
      ).j;
      const removal = (
        await api(
          "/api/creator/library/removal-preview?kind=material&id=" +
            removable.id
        )
      ).j;
      await api("/api/creator/library/remove-source", "POST", {
        kind: "material",
        id: removable.id,
        expectedProfileRevision: removal.expectedProfileRevision,
        reviewToken: removal.reviewToken,
        confirmRemove: true,
      });
      const asset = (
        await api("/api/assets", "POST", {
          name: "synthetic.png",
          base64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=",
        })
      ).j;
      await api("/api/creator/services", "POST", {
        kind: "text",
        name: "加密连接测试",
        model: "synthetic",
        apiKey: "persisted-synthetic-secret",
        baseUrl: "https://model.example/v1/",
      });
      const series = (
        await api("/api/creator/series", "POST", {
          name: "重启系列",
          goal: "持续准备大纲并保留任务记录",
        })
      ).j;
      let ready = false;
      for (let i = 0; i < 70; i++) {
        const s = (await api("/api/creator/series/" + series.id)).j;
        if (s.entries[0].status === "ready") {
          ready = true;
          break;
        }
        await pause(150);
      }
      assert.equal(ready, true);
      const jobs = (await api("/api/creator/jobs")).j.jobs;
      await stop(child);
      await start();
      assert.equal(
        (await api("/api/accounts/me")).j.author.name,
        "重启测试作者"
      );
      assert.equal(
        (await api("/api/writing/projects/" + doc.projectId + "/master")).j
          .markdown,
        saved.markdown
      );
      assert.equal(
        (await api(writingBase + "/wechat")).j.markdown,
        synced.markdown
      );
      assert.deepEqual(
        (await api(writingBase + "/wechat/history")).j.history[0].masterReview,
        syncHistory
      );
      const restoredGeneration = (
        await api(writingBase + "/master/generations/" + generationId)
      ).j;
      assert.equal(restoredGeneration.status, "failed");
      assert.match(restoredGeneration.partial, /重启后仍可查看/);
      const restoredProfile = (
        await api(
          "/api/creator/platforms/accounts/" + profileAccount.id + "/profile"
        )
      ).j;
      assert.equal(restoredProfile.revision, 1);
      assert.equal(restoredProfile.data.tone, "自然克制");
      assert.equal(
        (
          await api(
            "/api/creator/projects/" + doc.projectId + "/context?channel=zhihu"
          )
        ).j.account.id,
        profileAccount.id
      );
      assert.equal(
        (await api("/api/creator/materials/" + removable.id)).j.body,
        ""
      );
      assert.equal(
        (
          await fetch(
            origin +
              "/api/creator/library/removal-preview?kind=material&id=" +
              removable.id,
            { headers: { cookie } }
          )
        ).status,
        410
      );
      const image = await fetch(origin + asset.previewUrl, {
        headers: { cookie },
      });
      assert.equal(
        Buffer.from(await image.arrayBuffer()).toString("base64"),
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII="
      );
      const services = (await api("/api/creator/services")).j;
      assert.equal(services.connections.length, 1);
      assert.equal(
        JSON.stringify(services).includes("persisted-synthetic-secret"),
        false
      );
      assert.equal((await api("/api/creator/jobs")).j.jobs.length, jobs.length);
      await api("/api/accounts/logout", "POST", {});
      assert.equal(
        (await fetch(origin + "/api/creator/library", { headers: { cookie } }))
          .status,
        401
      );
    } finally {
      await stop(child);
      model.closeAllConnections();
      await new Promise((resolve) => model.close(resolve));
      rmSync(root, { recursive: true, force: true });
    }
  }
);
