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
docker run -d --name "$container" --network host \
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
test "$(docker exec "$container" id -u)" = "10001"
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
