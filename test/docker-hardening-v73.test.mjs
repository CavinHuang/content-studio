import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
test('V73 Compose read-only rootfs with strictly scoped tmpfs and persistent DB',()=>{
 const y=read('compose.local.yml');
 for(const text of ['read_only: true','network_mode: host','no-new-privileges:true',
  'cap_drop:','- ALL','pids_limit: 256','studio-data:/app/data',
  '/tmp:rw,nosuid,nodev,noexec','/app/.next/cache:rw,nosuid,nodev',
  '/app/.next/server/route-cache:rw,nosuid,nodev',
  'uid=10001,gid=10001','size=134217728','size=67108864'])
  assert.ok(y.includes(text),text);
 assert.ok(!/^\s*ports:/m.test(y));
});
test('V73 runtime image pins npm cache into tmpfs and uses guarded entry',()=>{
 const d=read('Dockerfile');
 assert.ok(d.includes('NPM_CONFIG_CACHE=/tmp/npm-cache'));
 assert.ok(d.includes('runtime-guard.mjs","start'));
 assert.ok(d.includes('USER 10001:10001'));
 assert.ok(!/^\s*EXPOSE\b/m.test(d));
});
test('V73 real Docker CI must use read-only root, actually reject immutable writes and exercise writable caches',()=>{
 const sh=read('smoke/docker-local-v72.sh');
 for(const part of ['--read-only','--tmpfs /tmp','--tmpfs /app/.next/cache',
  '--tmpfs /app/.next/server/route-cache',
  '{{.HostConfig.ReadonlyRootfs}}',
  '"/app/package.json"','"/app/.git/HEAD"','"/app/.next/BUILD_ID"',
  'e?.code!=="EROFS"','SYNTHETIC-EPHEMERAL-ONLY',
  'curl -fsS --max-time 5','docker restart','ci_v72_marker'])
  assert.ok(sh.includes(part),part);
});
test('V73 container new security gates execute in full CI not as ignored script',()=>{
 const ci=read('.github/workflows/ci.yml');
 const pkg=JSON.parse(read('package.json'));
 assert.ok(ci.includes('npm run test:docker:hardening:v73 && bash smoke/docker-local-v72.sh'));
 assert.equal(pkg.scripts['test:docker:hardening:v73'],
  'node --test test/docker-hardening-v73.test.mjs');
});
