#!/usr/bin/env bash
# V75 synthetic Docker authentication exercise; no actual Dokploy or public TLS.
set -Eeuo pipefail
test -n "$GITHUB_SHA"
image="content-studio:v72-ci"; container="cs-v75-$$"; volume="cs-v75-vol-$$"; port=4395
dir="$(mktemp -d)"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true;docker volume rm "$volume" >/dev/null 2>&1 || true;rm -rf -- "$dir"; }
trap cleanup EXIT
password='synthetic-v75-ci-only-passphrase-long'
creds="$(printf '%s' "$password" | node scripts/generate-dokploy-credentials-v75.mjs)"
hash="$(printf '%s\n' "$creds" | sed -n 's/^CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT=//p')"
key="$(printf '%s\n' "$creds" | sed -n 's/^CONTENT_STUDIO_AUTH_SESSION_KEY=//p')"
test -n "$hash";test -n "$key"
CONTENT_STUDIO_PUBLIC_ORIGIN=https://studio.example.com CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT="$hash" CONTENT_STUDIO_AUTH_SESSION_KEY="$key" docker compose -f compose.dokploy.yml config --quiet
docker image inspect "$image" >/dev/null
docker volume create "$volume" >/dev/null
# Host networking below is synthetic CI only; not the Dokploy Compose network.
docker run -d --name "$container" --network host --read-only \
 --mount "type=volume,source=$volume,target=/app/data" \
 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777 \
 --tmpfs /app/.next/cache:rw,nosuid,nodev,size=134217728,uid=10001,gid=10001,mode=0700 \
 --tmpfs /app/.next/server/route-cache:rw,nosuid,nodev,size=67108864,uid=10001,gid=10001,mode=0700 \
 --security-opt no-new-privileges --cap-drop ALL \
 -e NODE_ENV=production -e PORT="$port" -e HOST=0.0.0.0 \
 -e CONTENT_STUDIO_DEPLOY_MODE=dokploy -e CONTENT_STUDIO_PUBLIC_ORIGIN=https://studio.example.com \
 -e CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT="$hash" -e CONTENT_STUDIO_AUTH_SESSION_KEY="$key" \
 -e CONTENT_STUDIO_DB_PATH=/app/data/content-studio.sqlite \
 -e CONTENT_STUDIO_ALLOW_REMOTE=0 -e ENABLE_SCENARIO=0 "$image" >/dev/null
for i in $(seq 1 95); do
 if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" |
   node -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{try{const x=JSON.parse(s);if(x.mode!=="authenticated-remote"||x.runtimeBuild!==null)process.exit(1)}catch{process.exit(1)}})' 2>/dev/null; then break;fi
 if [[ "$i" == 95 ]]; then docker logs "$container" --tail 30;echo "V75 container startup failed" >&2;exit 1;fi
 sleep 1
done
get_code(){
 local suffix="$1";shift
 curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
 -H 'Host: studio.example.com' -H 'X-Forwarded-Proto: https' \
 -H 'X-Forwarded-Host: studio.example.com' "$@" \
 "http://127.0.0.1:$port/$suffix"
}
if [[ "$(get_code api/status)" != 401 ]]; then echo "V75 anonymous API not blocked" >&2;exit 1;fi
if [[ "$(get_code api/auth/login -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{"password":"wrong"}')" != 403 ]]; then echo "V75 cross-site login not denied" >&2;exit 1;fi
if [[ "$(get_code api/auth/login -H 'Origin: https://studio.example.com' -H 'Content-Type: application/json' -d '{"password":"synthetic-wrong-password"}')" != 401 ]]; then echo "V75 incorrect password not denied" >&2;exit 1;fi
json="$(node -e 'process.stdout.write(JSON.stringify({password:process.argv[1]}))' "$password")"
code="$(curl -sS -D "$dir/headers" -o /dev/null -w '%{http_code}' --max-time 5 \
 -H 'Host: studio.example.com' -H 'X-Forwarded-Proto: https' \
 -H 'X-Forwarded-Host: studio.example.com' \
 -H 'Origin: https://studio.example.com' -H 'Content-Type: application/json' \
 --data "$json" "http://127.0.0.1:$port/api/auth/login")"
if [[ "$code" != 200 ]]; then echo "V75 real Docker login rejected" >&2;exit 1;fi
cookie="$(sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' "$dir/headers" | tr -d '\r')"
if [[ "$cookie" != __Host-content_studio_session=* ]]; then echo "V75 secure session cookie absent" >&2;exit 1;fi
if [[ "$(get_code api/status -H "Cookie: $cookie")" != 200 ]]; then echo "V75 signed session not accepted" >&2;exit 1;fi
if [[ "$(get_code api/status -H "Cookie: $cookie" -H 'X-Forwarded-Proto: http')" != 403 ]]; then echo "V75 insecure proxy protocol accepted" >&2;exit 1;fi
docker restart "$container" >/dev/null
for i in $(seq 1 90); do
 if [[ "$(get_code api/status -H "Cookie: $cookie" 2>/dev/null || true)" == 200 ]];then break;fi
 if [[ "$i" == 90 ]]; then echo "V75 secure session not stable across restart" >&2;exit 1;fi
 sleep 1
done
test "$(docker exec "$container" id -u)" = 10001
test "$(docker exec "$container" git rev-parse HEAD)" = "$GITHUB_SHA"
echo "V75 synthetic Docker login, HTTPS origin, cookie and restart verified."
