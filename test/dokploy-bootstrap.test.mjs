import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateStudioApiRequest} from '../src/local-api-boundary.mjs';
import {dispatchApi} from '../lib/api.mjs';

const env={CONTENT_STUDIO_DEPLOY_MODE:'dokploy-bootstrap'};
const req=(path,method='GET')=>new Request('http://127.0.0.1:4312'+path,{
 method,headers:{host:'public.example.com',origin:'https://public.example.com',
  'content-type':'application/json'},
 ...(method==='POST'?{body:'{}'}:{})
});

test('bootstrap bypass is explicit and does not bypass secure or local API modes',()=>{
 const open=validateStudioApiRequest(req('/api/status'),env);
 assert.equal(open.unauthenticatedBootstrap,true);
 assert.equal(open.checked,false);
 assert.equal(validateStudioApiRequest(req('/api/status','POST'),env).unauthenticatedBootstrap,true);
 assert.throws(()=>validateStudioApiRequest(req('/api/status'),{}));
 assert.throws(()=>validateStudioApiRequest(req('/api/status'),{
  CONTENT_STUDIO_DEPLOY_MODE:'dokploy'
 }));
});

test('bootstrap bypasses the Next proxy only in explicitly selected mode',()=>{
 const source=readFileSync(new URL('../proxy.js',import.meta.url),'utf8');
 assert.ok(source.includes("if(runtimeEnv.CONTENT_STUDIO_DEPLOY_MODE!=='dokploy')return NextResponse.next()"));
});

test('bootstrap anonymous health is 200 and carries no build or database proof',async()=>{
 const old=process.env.CONTENT_STUDIO_DEPLOY_MODE;
 process.env.CONTENT_STUDIO_DEPLOY_MODE='dokploy-bootstrap';
 try{
  const response=await dispatchApi(req('/api/health'),{});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.ok,true);
  assert.equal(data.mode,'unauthenticated-bootstrap');
  assert.equal(data.runtimeBuild,null);
  assert.equal(data.serverTime,undefined);
 }finally{
  if(old===undefined)delete process.env.CONTENT_STUDIO_DEPLOY_MODE;
  else process.env.CONTENT_STUDIO_DEPLOY_MODE=old;
 }
});

test('bootstrap Dockerfile and compose are deliberately isolated from normal production',()=>{
 const d=readFileSync(new URL('../Dockerfile.dokploy.bootstrap',import.meta.url),'utf8');
 const y=readFileSync(new URL('../compose.dokploy.bootstrap.yml',import.meta.url),'utf8');
 const normal=readFileSync(new URL('../compose.dokploy.yml',import.meta.url),'utf8');
 for(const part of ['node_modules/next/dist/bin/next','start','USER 10001:10001',
  'HEALTHCHECK','unauthenticated-bootstrap'])assert.ok(d.includes(part),part);
 assert.ok(!d.includes('runtime-guard.mjs'));
 assert.ok(!d.includes('checkout-integrity-v63.mjs'));
 assert.ok(!d.includes('verifyBuildReceipt'));
 assert.ok(y.includes('dockerfile: Dockerfile.dokploy.bootstrap'));
 assert.ok(y.includes('CONTENT_STUDIO_DEPLOY_MODE: dokploy-bootstrap'));
 assert.ok(y.includes('studio-bootstrap-data:/app/data'));
 assert.ok(!y.includes('- studio-data:/app/data'));
 assert.ok(normal.includes('studio-data:/app/data'));
 assert.ok(!normal.includes('studio-bootstrap-data:/app/data'));
 assert.ok(y.includes('dokploy-network'));
 assert.ok(!/^\s*ports:/m.test(y));
 assert.ok(!y.includes('CONTENT_STUDIO_AUTH_SESSION_KEY'));
 assert.ok(!y.includes('CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT'));
 assert.ok(!y.includes('CONTENT_STUDIO_PUBLIC_ORIGIN'));
 assert.ok(normal.includes('CONTENT_STUDIO_DEPLOY_MODE: dokploy'));
 assert.ok(normal.includes('CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT:'));
});
