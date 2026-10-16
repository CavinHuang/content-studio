import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
test('V72 image keeps Git/Next receipts and never starts unguarded or root',()=>{
 const d=read('Dockerfile');
 for(const key of ['node:22.16.0-bookworm-slim','AS build','AS production-deps',
  'AS runtime','npm ci --no-audit --no-fund','npm ci --omit=dev',
  'checkout-integrity-v63.mjs','npm run build','git clone --quiet --depth 1',
  'remote remove origin','/app/.next','verifyBuildReceipt',
  'USER 10001:10001','runtime-guard.mjs","start','HEALTHCHECK'])
  assert.ok(d.includes(key),'Missing Docker invariant '+key);
 assert.ok(!d.includes('next","start'));
});
test('V72 Docker context excludes secrets, databases, Git credentials and receipts',()=>{
 const d=read('.dockerignore');
 for(const s of ['node_modules','.next','.env.*','*.sqlite',
  '*.release-evidence.json','*.v71-receipt.json','.git/config','.git/hooks','.git/logs','.npmrc'])
  assert.ok(d.includes(s),'Missing Docker ignore '+s);
});
test('V72 Linux compose uses localhost host network, a persistent volume and a nonroot user',()=>{
 const d=read('compose.local.yml');
 for(const s of ['network_mode: host','10001:10001','studio-data:/app/data',
  'HOST: "127.0.0.1"','no-new-privileges:true'])assert.ok(d.includes(s));
 assert.ok(!/^\s+ports:/m.test(d));
});
test('V72 workflow actually builds, runs and restarts Docker image',()=>{
 const d=read('smoke/docker-local-v72.sh'),ci=read('.github/workflows/ci.yml');
 for(const s of ['docker build --pull','docker run -d','docker restart',
  'npm run release:runtime:v64','ci_v72_marker','trap cleanup EXIT'])assert.ok(d.includes(s));
 assert.ok(ci.includes('bash smoke/docker-local-v72.sh'));
});
