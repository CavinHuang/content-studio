import { buildCreatorHome } from "../src/creator-home.mjs";
import { buildInsightsView } from "../src/insights-view.mjs";
const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function creatorApi(request, core, readBody) {
  const u = new URL(request.url),
    p = u.pathname,
    m = request.method,
    c = core.creator,
    s = core.services;
  if (!p.startsWith("/api/creator/")) return null;
  const publishing = core.publishing,
    xhs = core.xhs;
  if (p === "/api/creator/agent-skills" && m === "GET") return json({ skills: core.agent.skills() });
  if (p === "/api/creator/agent") {
    if (m === "GET") return json({ profile: core.agent.profile() });
    if (m === "PUT") return json({ profile: core.agent.saveProfile(await readBody(request)) });
  }
  const agentRunRoute = p.match(/^\/api\/creator\/projects\/(ep_[a-f0-9-]+)\/agent-runs(?:\/(ar_[a-f0-9-]+)(?:\/(cancel|events))?)?$/);
  if (agentRunRoute) {
    const [, projectId, runId, action] = agentRunRoute;
    if (!runId && m === "POST") {
      const b = await readBody(request);
      return json({ run: await core.agent.startRun(projectId, b?.channel || "master", b) }, 201);
    }
    if (!runId && m === "GET") return json({ runs: core.agent.runs(projectId) });
    if (runId && !action && m === "GET") return json({ run: core.agent.run(projectId, runId) });
    if (runId && action === "cancel" && m === "POST")
      return json({ run: core.agent.cancelRun(projectId, runId) });
    if (runId && action === "events" && m === "GET") {
      const encoder = new TextEncoder(), deadline = Date.now() + 600000;
      let stopped = false;
      const stop = () => { stopped = true; };
      request.signal?.addEventListener("abort", stop, { once: true });
      if (request.signal?.aborted) stop();
      const stream = new ReadableStream({
        async start(controller) {
          let seq = 0;
          const emit = (value) => {
            if (!stopped)
              try { controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); }
              catch { stopped = true; }
          };
          try {
            while (Date.now() < deadline && !stopped) {
              const run = core.agent.runSince(projectId, runId, seq);
              for (const step of run.steps) {
                if (stopped) break;
                emit(step);
                seq = step.seq;
              }
              if (stopped) break;
              if (run.status !== "running") {
                emit({ kind: "run_done", status: run.status, stopReason: run.stopReason });
                break;
              }
              await new Promise(r => setTimeout(r, 800));
            }
          } catch (e) {
            emit({ kind: "error", message: String(e.message || e).slice(0, 200) });
          }
          request.signal?.removeEventListener("abort", stop);
          if (!stopped)
            try { controller.close(); } catch { stopped = true; }
        },
        cancel() { stopped = true; },
      });
      return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
  }
  if (p === "/api/creator/platforms" && m === "GET")
    return json({
      capabilities: publishing.capabilities(),
      accounts: publishing.accounts(),
    });
  if (p === "/api/creator/platforms/accounts" && m === "POST")
    return json(publishing.saveAccount(await readBody(request)), 201);
  const accountProfileRoute=p.match(/^\/api\/creator\/platforms\/accounts\/(pa_[a-f0-9-]+)\/profile$/);
  if(accountProfileRoute){if(m==='GET')return json(publishing.accountProfile(accountProfileRoute[1]));if(m==='PUT')return json(publishing.saveAccountProfile(accountProfileRoute[1],await readBody(request)));}
  let publishingRoute = p.match(
    /^\/api\/creator\/platforms\/accounts\/(pa_[a-f0-9-]+)(?:\/(probe))?$/
  );
  if (publishingRoute) {
    if (m === "POST" && publishingRoute[2])
      return json(
        await publishing.probe(publishingRoute[1], await readBody(request))
      );
    if (m === "PUT" && !publishingRoute[2])
      return json(
        publishing.saveAccount({
          ...(await readBody(request)),
          id: publishingRoute[1],
        })
      );
    if (m === "DELETE" && !publishingRoute[2])
      return json(publishing.removeAccount(publishingRoute[1]));
  }
  publishingRoute = p.match(
    /^\/api\/creator\/projects\/(ep_[a-f0-9-]+)\/publishing(?:\/(bundle|report|draft|reconcile))?$/
  );
  if (publishingRoute) {
    const [, id, action] = publishingRoute;
    if (!action && m === "GET") return json(publishing.history(id));
    if (m === "POST") {
      const b = await readBody(request);
      if (action === "bundle")
        return new Response(publishing.bundle(id, b.channel, b), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="article-package.zip"',
            "Cache-Control": "no-store",
          },
        });
      if (action === "report") return json(publishing.report(id, b.channel, b));
      if (action === "draft") return json(await publishing.sendDraft(id, b));
      if (action === "reconcile")
        return json(publishing.reconcile(id, b.operationId, b));
    }
  }
  const xhsRoute = p.match(
    /^\/api\/creator\/projects\/(ep_[a-f0-9-]+)\/xiaohongshu(?:\/(xh_[a-f0-9-]+)(?:\/(approve|render|edit|restyle|restore|reorder|review|history|export))?)?$/
  );
  if (xhsRoute) {
    const [, id, planId, action] = xhsRoute;
    if (m === "GET" && action === "history")
      return json({ history: xhs.history(id, planId) });
    if (m === "GET" && !action) return json({ plan: xhs.get(id, planId) });
    if (m === "POST") {
      const b = await readBody(request);
      if (!planId) return json(await xhs.plan(id, b), 201);
      if (action === "approve") return json(xhs.approveText(id, planId, b));
      if (action === "render") return json(await xhs.render(id, planId, b));
      if (action === "edit") return json(await xhs.edit(id, planId, b));
      if (action === "review") return json(xhs.review(id, planId, b));
      if (action === "restyle") return json(await xhs.restyle(id, planId, b));
      if (action === "restore") return json(xhs.restore(id, planId, b));
      if (action === "reorder") return json(xhs.reorder(id, planId, b));
      if (action === "export") {
        const bytes = xhs.export(id, planId, b),
          plan = xhs.get(id, planId);
        publishing._fact(
          id,
          "xiaohongshu",
          "",
          plan.channelRevision,
          "exported",
          "local_export",
          {
            planId,
            planRevision: plan.revision,
            images: plan.pages.map((page) => ({
              id: page.asset.id,
              sha256: page.asset.sha256,
            })),
          }
        );
        return new Response(bytes, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition":
              'attachment; filename="xiaohongshu-images.zip"',
            "Cache-Control": "no-store",
          },
        });
      }
    }
  }
  if (p === "/api/creator/source-items" && m === "GET")
    return json({
      items: c.sourceItems({
        source: u.searchParams.get("source") || "",
        limit: u.searchParams.get("limit") || 60,
      }),
    });
  if (p === "/api/creator/source-items/convert" && m === "POST")
    return json(c.convertSourceItems((await readBody(request)).ids));
  if (p === "/api/creator/source-items/topic" && m === "POST")
    return json(c.saveSourceItemTopic(await readBody(request)), 201);
  if (p === "/api/creator/sources") {
    if (m === "GET") return json({ sources: c.sources() });
    if (m === "POST")
      return json({ sources: c.saveSource(await readBody(request)) }, 201);
  }
  const sourceRoute = p.match(
    /^\/api\/creator\/sources\/(cs_[a-z0-9_-]+)(?:\/(sync))?$/
  );
  if (sourceRoute) {
    if (m === "POST" && sourceRoute[2])
      return json({ sources: await c.syncSource(sourceRoute[1]) });
    if (m === "DELETE")
      return json({ sources: c.deleteSource(sourceRoute[1]) });
    if (m === "PUT")
      return json({
        sources: c.saveSource({
          ...(await readBody(request)),
          id: sourceRoute[1],
        }),
      });
  }
  if (p === "/api/creator/overview" && m === "GET") {
    const projects = core.editorial.list(),
      topics = c.topics(),
      notifications = c.notifications(),
      jobs = c.jobs();
    return json({
      profile: c.profile(),
      projects,
      topics,
      series: c.allSeries(),
      notifications,
      jobs,
      services: s.availability(),
      usage: s.usage(),
      // V2 home aggregation (pending decisions + featured clues); pure
      // derivation from the rows above, see src/creator-home.mjs.
      home: buildCreatorHome({ projects, topics, notifications, jobs }),
    });
  }
  if (p === "/api/creator/insights" && m === "GET") {
    // V2 效果复盘 read-only aggregation (v2-audit.md §1 /insights row):
    // author-entered metrics joined with project titles, real style
    // suggestions and the profile revision the accept decision needs.
    // Pure display derivation lives in src/insights-view.mjs; nothing
    // here claims verified platform data — none exists.
    const projects = core.editorial.list();
    const metrics = c.allMetrics().map((row) => ({
      ...row,
      projectTitle: projects.find((pr) => pr.id === row.project_id)?.title || "",
    }));
    const profile = c.profile();
    const styleSuggestions = c.styleSuggestions();
    return json({
      profile,
      projects,
      metrics,
      styleSuggestions,
      insights: buildInsightsView({ projects, metrics, suggestions: styleSuggestions, profile }),
    });
  }
  if (p === "/api/creator/profile") {
    if (m === "GET") return json(c.profile());
    if (m === "PUT") {const input=await readBody(request);return json(input.restoreRevision!==undefined?c.restoreProfile(input):c.saveProfile(input));}
  }
  if (p === "/api/creator/profile/history" && m === "GET")
    return json({ history: c.profileHistory() });
  if (p === "/api/creator/style-suggestions") {
    if (m === "GET") return json({ suggestions: c.styleSuggestions() });
    if (m === "POST")
      return json(await c.inferStyle(await readBody(request)), 201);
  }
  let route = p.match(/^\/api\/creator\/style-suggestions\/(st_[a-f0-9-]+)$/);
  if (route && m === "POST")
    return json(c.decideStyle(route[1], await readBody(request)));
  if (p === "/api/creator/services") {
    if (m === "GET")
      return json({
        connections: s.connections(),
        availability: s.availability(),
      });
    if (m === "POST") return json(s.save(await readBody(request)), 201);
  }
  if (p === "/api/creator/services/models" && m === "POST")
    return json(await s.listRemoteModels(await readBody(request)));
  route = p.match(/^\/api\/creator\/services\/(sc_[a-f0-9-]+)$/);
  if (route) {
    if (m === "DELETE") {
      s.remove(route[1]);
      return json({ ok: true });
    }
    if (m === "PUT")
      return json(s.save({ ...(await readBody(request)), id: route[1] }));
  }
  if (p === "/api/creator/usage") {
    if (m === "GET") return json(s.usage());
    if (m === "PUT") return json(s.setLimits(await readBody(request)));
  }
  route = p.match(/^\/api\/creator\/usage\/(su_[a-f0-9-]+)$/);
  if (route && m === "POST")
    return json(s.settle(route[1], await readBody(request)));
  if (p === "/api/creator/materials" && m === "POST")
    return json(c.addMaterial(await readBody(request)), 201);
  if(p==='/api/creator/library/removal-preview'&&m==='GET')return json(c.sourceRemovalPreview({kind:u.searchParams.get('kind'),id:u.searchParams.get('id')}));
  if(p==='/api/creator/library/remove-source'&&m==='POST')return json(c.removeSource(await readBody(request)));
  if (p === "/api/creator/materials/import-url" && m === "POST")
    return json(await c.importURL(await readBody(request)), 201);
  route = p.match(/^\/api\/creator\/materials\/(mt_[a-f0-9-]+)$/);
  if (route && m === "GET") return json(c.material(route[1]));
  if (p === "/api/creator/library/visual-series" && m === "GET")
    return json(c.visualSeriesOverview());
  if (p === "/api/creator/library" && m === "GET")
    return json({
      assets: c.library({
        q: u.searchParams.get("q") || "",
        kind: u.searchParams.get("kind") || "",
        tag: u.searchParams.get("tag") || "",
        archived: u.searchParams.get("archived") === "1",
        seriesId: u.searchParams.get("series") || "",
        platform: u.searchParams.get("platform") || "",
        from: u.searchParams.get("from") || "",
        to: u.searchParams.get("to") || "",
      }),
    });
  if (p === "/api/creator/library/meta" && m === "PUT")
    return json(c.assetMeta(await readBody(request)));
  if (p === "/api/creator/topics") {
    if (m === "GET") return json({ topics: c.topics() });
    if (m === "POST") return json(c.createTopic(await readBody(request)), 201);
  }
  if (p === "/api/creator/topics/recommend" && m === "POST")
    return json(await c.recommend(await readBody(request)));
  route = p.match(
    /^\/api\/creator\/topics\/(tp_[a-f0-9-]+)(?:\/(messages|start|history))?$/
  );
  if (route) {
    const [, id, action] = route;
    if (!action) {
      if (m === "GET") return json(c.topic(id));
      if (m === "PUT") return json(c.updateTopic(id, await readBody(request)));
    }
    if (action === "history" && m === "GET")
      return json({ history: c.topicHistory(id) });
    if (action === "messages") {
      if (m === "GET") return json({ messages: c.messages(id) });
      if (m === "POST")
        return json({
          messages: await c.discussTopic(id, await readBody(request)),
        });
    }
    if (action === "start" && m === "POST") return json(c.startTopic(id), 201);
  }
  const acceptMessage = p.match(
    /^\/api\/creator\/topics\/(tp_[a-f0-9-]+)\/messages\/(tm_[a-f0-9-]+)\/accept$/
  );
  if (acceptMessage && m === "POST")
    return json(
      c.acceptTopicMessage(
        acceptMessage[1],
        acceptMessage[2],
        await readBody(request)
      )
    );
  if (p === "/api/creator/series") {
    if (m === "GET") return json({ series: c.allSeries() });
    if (m === "POST") return json(c.createSeries(await readBody(request)), 201);
  }
  route = p.match(
    /^\/api\/creator\/series\/(sr_[a-f0-9-]+)(?:\/(prepare|entries))?$/
  );
  if (route) {
    const [, id, action] = route;
    if (action === "entries" && m === "PUT")
      return json(c.updateEntries(id, await readBody(request)));
    if (action === "prepare" && m === "POST")
      return json(c.enqueueSeries(id), 202);
    if (!action) {
      if (m === "GET") return json(c.series(id));
      if (m === "PUT") return json(c.updateSeries(id, await readBody(request)));
    }
  }
  if (p === "/api/creator/jobs" && m === "GET") return json({ jobs: c.jobs() });
  const jobReview = p.match(/^\/api\/creator\/jobs\/(cj_[a-f0-9-]+)\/review$/);
  if (jobReview && m === "POST")
    return json(c.reviewJob(jobReview[1], await readBody(request)));

  route = p.match(/^\/api\/creator\/notifications\/(nt_[a-f0-9-]+)$/);
  if (route && m === "POST") {
    c.readNotification(route[1]);
    return json({ ok: true });
  }
  route = p.match(
    /^\/api\/creator\/projects\/(ep_[a-f0-9-]+)\/(context|metrics|channels)$/
  );
  if (route) {
    const [, id, action] = route;
    if (action === "context") {
      if (m === "GET")
        return json(c.context(id, u.searchParams.get("channel") || "master"));
      if (m === "PUT") {
        const input = await readBody(request);
        if (
          !Number.isInteger(input.expectedRevision) ||
          input.expectedRevision < 0
        )
          return json({ error: "请携带当前创作上下文修订" }, 400);
        return json(
          c.setContext(id, input, u.searchParams.get("channel") || "master")
        );
      }
    }
    if (action === "metrics") {
      if (m === "GET") return json({ metrics: c.metrics(id) });
      if (m === "POST")
        return json(
          {
            metrics: c.addMetric({
              ...(await readBody(request)),
              projectId: id,
            }),
          },
          201
        );
    }
    if (action === "channels" && m === "POST") {
      const b = await readBody(request);
      core.editorial.ensureChannel(id, b.channel);
      return json(core.writing.document(id, b.channel), 201);
    }
  }
  return json({ error: "创作接口或请求方式不存在" }, 404);
}
