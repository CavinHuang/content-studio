#!/usr/bin/env bash
# V74 actual Docker WAL backup to an isolated archive volume and fresh restore.
set -Eeuo pipefail
if [[ -z "$GITHUB_SHA" ]]; then echo "Exact CI SHA required" >&2; exit 1; fi
image="content-studio:v72-ci"
live="cs-v74-live-$$"; recovered="cs-v74-recovered-$$"
dbvol="cs-v74-db-$$"; backupvol="cs-v74-backups-$$"; newvol="cs-v74-new-$$"
port=4391; newport=4392
cleanup() {
 docker rm -f "$live" "$recovered" >/dev/null 2>&1 || true
 for v in "$dbvol" "$backupvol" "$newvol"; do docker volume rm "$v" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
docker image inspect "$image" >/dev/null
for v in "$dbvol" "$backupvol" "$newvol"; do docker volume create "$v" >/dev/null; done
start_app() {
 docker run -d --name "$1" --network host --read-only \
  --mount "type=volume,src=$2,dst=/app/data" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
  --tmpfs /app/.next/cache:rw,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700 \
  --tmpfs /app/.next/server/route-cache:rw,nosuid,nodev,size=67108864,uid=10001,gid=10001,mode=0700 \
  --security-opt no-new-privileges --cap-drop ALL \
  -e "PORT=$3" -e HOST=127.0.0.1 \
  -e CONTENT_STUDIO_DB_PATH=/app/data/content-studio.sqlite \
  -e CONTENT_STUDIO_ALLOW_REMOTE=0 -e ENABLE_SCENARIO=0 \
  "$image" >/dev/null
}
ready() {
 for i in $(seq 1 80); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$1/api/health" >/dev/null 2>&1; then return 0; fi
  sleep 1
 done
 docker logs "$2" --tail 60
 echo "V74 isolated Next failed to start" >&2; return 1
}
maintain() {
 local op="$1";shift
 docker run --rm --network none --read-only --entrypoint node \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
  --security-opt no-new-privileges --cap-drop ALL \
  --mount "type=volume,src=$dbvol,dst=/app/data,readonly" \
  --mount "type=volume,src=$backupvol,dst=/app/backups" \
  "$image" scripts/container-recovery-v74.mjs "$op" "$@"
}
restore() {
 docker run --rm --network none --read-only --entrypoint node \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
  --security-opt no-new-privileges --cap-drop ALL \
  --mount "type=volume,src=$backupvol,dst=/app/backups,readonly" \
  --mount "type=volume,src=$newvol,dst=/app/restore" \
  "$image" scripts/container-recovery-v74.mjs restore "--backup=$1"
}
start_app "$live" "$dbvol" "$port"
ready "$port" "$live"
docker exec "$live" node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/app/data/content-studio.sqlite");
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS ci_v74 (id INTEGER PRIMARY KEY, blob BLOB)");
db.prepare("INSERT INTO ci_v74(blob) VALUES(?)").run(Buffer.from([11,22,33,44]));
db.close();'
backup_json="$(maintain backup)"
backup="$(printf '%s' "$backup_json" | node -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{const x=JSON.parse(s);if(!x.walSafe||!x.backupManifestVerified)process.exit(1);process.stdout.write(x.archive)})')"
[[ "$backup" =~ ^content-studio-v74- ]]
maintain list >/dev/null
maintain prune --keep=2 --apply=no >/dev/null
restore "$backup" >/dev/null
if restore "$backup" >/dev/null 2>&1; then echo "V74 overwrote restored DB" >&2;exit 1; fi
start_app "$recovered" "$newvol" "$newport"
ready "$newport" "$recovered"
docker exec "$recovered" npm run release:runtime:v64 -- \
 --sha="$GITHUB_SHA" --url="http://127.0.0.1:$newport/" >/dev/null
docker exec "$recovered" node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/app/data/content-studio.sqlite",{readOnly:true});
const row=db.prepare("SELECT blob FROM ci_v74 ORDER BY id DESC LIMIT 1").get();
db.close();
if(!row||Buffer.compare(Buffer.from(row.blob),Buffer.from([11,22,33,44]))!==0)process.exit(1);'
docker exec "$live" node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/app/data/content-studio.sqlite",{readOnly:true});
const count=db.prepare("SELECT COUNT(*) AS n FROM ci_v74").get().n;
db.close();if(count!==1)process.exit(1);'
echo "V74 live WAL backup, independent restore volume and historical BLOB verified."
