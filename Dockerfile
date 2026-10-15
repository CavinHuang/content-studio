# syntax=docker/dockerfile:1
# V72 — localhost-only Node/SQLite image. Not approved for public ingress.
# Build context MUST be a complete, clean Git checkout; source archives fail closed.
ARG NODE_IMAGE=node:22.16.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# V63 validates the actual HEAD, tracked worktree and index before installing.
RUN node scripts/checkout-integrity-v63.mjs --sha="$(git rev-parse HEAD)"
RUN npm ci --no-audit --no-fund \
  && npm run release:lock:v65 \
  && npm run build
# Do not copy the incoming .git into the runtime image: it may have historical
# commits, remote URLs, reflogs, custom hooks or credential-bearing settings.
# A shallow, detached checkout retains only the build's current Git tree.
RUN git clone --quiet --depth 1 --no-checkout "file:///app" /tmp/reviewed-checkout \
  && git -C /tmp/reviewed-checkout checkout --quiet --detach "$(git -C /app rev-parse HEAD)" \
  && git -C /tmp/reviewed-checkout remote remove origin \
  && test -z "$(git -C /tmp/reviewed-checkout status --porcelain --untracked-files=all)" \
  && test "$(git -C /tmp/reviewed-checkout rev-parse HEAD)" = "$(git -C /app rev-parse HEAD)"

FROM ${NODE_IMAGE} AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git tini \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10001 --create-home --home-dir /home/studio --shell /usr/sbin/nologin studio
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4312 \
    HOST=127.0.0.1 \
    CONTENT_STUDIO_ALLOW_REMOTE=0 \
    ENABLE_SCENARIO=0 \
    CONTENT_STUDIO_DB_PATH=/app/data/content-studio.sqlite
COPY --from=build --chown=10001:10001 /tmp/reviewed-checkout/ ./
COPY --from=production-deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/.next ./.next
RUN mkdir -p /app/data && chown 10001:10001 /app/data && chmod 0700 /app/data
USER 10001:10001
# This MUST pass at image-build time. No bypass of V63/V64 is permitted.
RUN npm run release:checkout:v63 -- --sha="$(git rev-parse HEAD)" \
  && npm run release:lock:v65 \
  && node --input-type=module -e "import {verifyBuildReceipt,getHeadSha} from './scripts/build-provenance-v64.mjs'; verifyBuildReceipt({cwd:process.cwd(),expectedSha:getHeadSha()})"
# Loopback inside container only. Use host networking on Linux for the
# unauthenticated single-user application; never map a public-facing port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
 CMD ["node","-e","fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(3000)}).then(async r=>{const j=await r.json();if(!r.ok||j.ok!==true||j.mode!=='local-only'||!j.runtimeBuild?.databaseIdentity)process.exit(1)}).catch(()=>process.exit(1))"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","scripts/runtime-guard.mjs","start"]
