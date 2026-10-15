#!/usr/bin/env bash
# V72 - real Docker image and synthetic SQLite persistence, Linux CI only.
set -Eeuo pipefail
if [[ -z "$GITHUB_SHA" ]]; then echo "Expected GitHub Actions SHA" >&2; exit 1; fi
image="content-studio:v72-ci"
container="content-studio-v72-ci"
volume="content-studio-v72-ci-data"
port="4389"
cleanup() {
 docker rm -f "$container" >/dev/null 2>&1 || true
 docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker build --pull --tag "$image" .
docker volume create "$volume" >/dev/null
docker run -d --name "$container" --network host --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
  --tmpfs /app/.next/cache:rw,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700 \
  --tmpfs /app/.next/server/route-cache:rw,nosuid,nodev,size=67108864,uid=10001,gid=10001,mode=0700 \
  --pids-limit 256 \
  --mount "type=volume,source=$volume,target=/app/data" \
  --security-opt no-new-privileges --cap-drop ALL \
  -e "PORT=$port" -e "HOST=127.0.0.1" \
  -e "CONTENT_STUDIO_DB_PATH=/app/data/content-studio.sqlite" \
  -e "CONTENT_STUDIO_ALLOW_REMOTE=0" -e "ENABLE_SCENARIO=0" "$image" >/dev/null
for i in $(seq 1 90); do
 if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" |
    node -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(j.ok!==true||j.mode!=="local-only"||!j.runtimeBuild?.databaseIdentity)process.exit(1)}catch{process.exit(1)}})' 2>/dev/null; then break; fi
 if [[ "$i" == "90" ]]; then docker logs --tail 60 "$container"; echo "V72 startup failed" >&2; exit 1; fi
 sleep 2
done
# The container's actual configured filesystem must be read-only.
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = "true"
test "$(docker exec "$container" id -u)" = "10001"
# The application source, tracked Git data and sealed build must NOT be writable.
docker exec "$container" node --input-type=module -e '
import {writeFileSync} from "node:fs";
for (const path of ["/app/package.json","/app/.git/HEAD","/app/.next/BUILD_ID"]) {
  try { writeFileSync(path,"V73-MUST-NOT-BE-WRITABLE"); process.exit(17); }
  catch(e) { if(e?.code!=="EROFS" && e?.code!=="EACCES") process.exit(18); }
}
'
# Only strictly scoped Next runtime caches and /tmp are ephemeral writable.
docker exec "$container" node --input-type=module -e '
import {writeFileSync,readFileSync,unlinkSync} from "node:fs";
for(const dir of ["/tmp","/app/.next/cache","/app/.next/server/route-cache"]) {
 const p=dir+"/v73-synthetic-check";
 writeFileSync(p,"SYNTHETIC-EPHEMERAL-ONLY");
 if(readFileSync(p,"utf8")!=="SYNTHETIC-EPHEMERAL-ONLY")process.exit(1);
 unlinkSync(p);
}
'

test "$(docker exec "$container" git rev-list --count HEAD)" = "1"
test -z "$(docker exec "$container" git remote)"
test "$(docker exec "$container" git rev-parse HEAD)" = "$GITHUB_SHA"
docker exec "$container" npm run release:runtime:v64 -- \
 --sha="$GITHUB_SHA" --url="http://127.0.0.1:$port/"
docker exec "$container" node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/app/data/content-studio.sqlite");
db.exec("CREATE TABLE IF NOT EXISTS ci_v72_marker (value TEXT NOT NULL)");
db.prepare("INSERT INTO ci_v72_marker(value) VALUES (?)").run("SYNTHETIC-PERSISTENCE-ONLY");
db.close();'
# A real read-only check before the restart: Next must still serve pages.
curl -fsS --max-time 5 "http://127.0.0.1:$port/" >/dev/null
curl -fsS --max-time 5 "http://127.0.0.1:$port/api/status" >/dev/null
docker restart "$container" >/dev/null
for i in $(seq 1 90); do
 if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then break; fi
 if [[ "$i" == "90" ]]; then docker logs --tail 60 "$container"; echo "V72 restart failed" >&2; exit 1; fi
 sleep 2
done
docker exec "$container" npm run release:runtime:v64 -- \
 --sha="$GITHUB_SHA" --url="http://127.0.0.1:$port/"
docker exec "$container" node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/app/data/content-studio.sqlite");
const row=db.prepare("SELECT count(*) AS n FROM ci_v72_marker WHERE value = ?")
 .get("SYNTHETIC-PERSISTENCE-ONLY");
db.close();
if(row?.n!==1)process.exit(1);'
echo "V72 Docker runtime and synthetic persistent volume verified."
