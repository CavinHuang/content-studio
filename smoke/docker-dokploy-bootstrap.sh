#!/usr/bin/env bash
# Safe CI only: synthetic data, loopback-only published port, fresh volume.
set -Eeuo pipefail
image="content-studio:dokploy-bootstrap-ci"
container="content-studio-bootstrap-ci-$$"
volume="content-studio-bootstrap-ci-$$"
port=4396
cleanup(){
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose -f compose.dokploy.bootstrap.yml config --quiet
docker build -f Dockerfile.dokploy.bootstrap -t "$image" .
docker volume create "$volume" >/dev/null
docker run -d --name "$container" -p "127.0.0.1:$port:4312" --read-only \
  --user 10001:10001 \
  --mount "type=volume,source=$volume,target=/app/data" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
  --tmpfs /app/.next/cache:rw,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700 \
  --tmpfs /app/.next/server/route-cache:rw,nosuid,nodev,size=67108864,uid=10001,gid=10001,mode=0700 \
  -e CONTENT_STUDIO_DEPLOY_MODE=dokploy-bootstrap \
  -e CONTENT_STUDIO_DB_PATH=/app/data/content-studio.sqlite \
  -e NODE_ENV=production -e PORT=4312 \
  "$image" >/dev/null
ready=0
for i in $(seq 1 90); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health" 2>/dev/null |
     node -e 'let v="";process.stdin.on("data",c=>v+=c);process.stdin.on("end",()=>{try{const x=JSON.parse(v);if(x.ok!==true||x.mode!=="unauthenticated-bootstrap"||x.runtimeBuild!==null)process.exit(1)}catch{process.exit(1)}})' 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  docker logs "$container" --tail 70
  echo "Bootstrap container never became healthy" >&2
  exit 1
fi
for p in / /api/status; do
  status=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$p")
  if [[ "$status" != 200 ]]; then
    echo "Bootstrap request $p returned $status (expected 200)" >&2
    docker logs "$container" --tail 40
    exit 1
  fi
done
echo "Unauthenticated bootstrap container started, health and UI/API responded 200."
