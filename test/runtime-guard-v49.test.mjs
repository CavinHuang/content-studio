import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditLocalRuntime,assertLocalRuntime,startLocalRuntime} from '../scripts/runtime-guard.mjs';

function fixture(t){
 const path=mkdtempSync(join(tmpdir(),'studio-v49-config-'));
 t.after(()=>rmSync(path,{recursive:true,force:true}));
 return path;
}
const env={PORT:'4312',CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',CONTENT_STUDIO_DB_PATH:'data/db.sqlite'};
test('V49 local-only production guard permits new durable SQLite without displaying secrets',t=>{
 const cwd=fixture(t);
 const r=auditLocalRuntime({env,cwd,version:'22.16.0'});
 assert.equal(r.ready,true);
 assert.equal(r.databasePresent,false);
 assert.equal(r.port,4312);
 assert.equal(r.loopbackBind,'127.0.0.1');
 assert.ok(r.warnings.includes('database_missing_will_be_created_on_first_start'));
 assert.equal(r.productionReady,false);
 assert.equal(r.privateValuesDisplayed,false);
});
test('V49 production guard denies remote bypass, public key, demo seed and :memory:',t=>{
 const cwd=fixture(t);
 for(const overrides of [
  {CONTENT_STUDIO_ALLOW_REMOTE:'1'},
  {ENABLE_SCENARIO:'1'},
  {CONTENT_STUDIO_DB_PATH:':memory:'},
  {HOST:'0.0.0.0'},
  {NEXT_PUBLIC_CONTENT_IMAGE_API_KEY:'secret-for-browser'},
  {NEXT_PUBLIC_ACCESS_TOKEN:'token-for-browser'},
  {PORT:'0'},{PORT:'not-a-port'}
 ]){
  const s=auditLocalRuntime({env:{...env,...overrides},cwd,version:'22.16.0'});
  assert.equal(s.ready,false,JSON.stringify(overrides));
  assert.ok(s.problems.length);
  assert.throws(()=>assertLocalRuntime({env:{...env,...overrides},cwd,version:'22.16.0'}),/Unsafe local runtime configuration/);
  assert.ok(!JSON.stringify(s).includes('secret-for-browser'));
  assert.ok(!JSON.stringify(s).includes('token-for-browser'));
 }
});
test('V49 rejects old runtime and a SQLite symlink instead of trusting its path',t=>{
 const cwd=fixture(t);
 assert.ok(auditLocalRuntime({env,cwd,version:'22.13.0'}).problems.includes('requires_node_22_16_or_later_in_22_x'));
 symlinkSync(join(cwd,'invalid-source'),join(cwd,'link.sqlite'));
 const r=auditLocalRuntime({env:{...env,CONTENT_STUDIO_DB_PATH:'link.sqlite'},cwd,version:'22.16.0'});
 assert.equal(r.ready,false);
 assert.ok(r.problems.includes('database_must_be_regular_local_file'));
});
test('V49 runtime launcher forces loopback binding, strips legacy remote and demo opt-ins',async t=>{
 const cwd=fixture(t);
 let command,args,config;
 const exit=await startLocalRuntime({
  env:{...env,PORT:'45211'},cwd,
  spawnChild:(bin,argv,options)=>{
   command=bin;args=argv;config=options;
   const callbacks=new Map();
   return {killed:false,once:(event,fn)=>{callbacks.set(event,fn);if(event==='exit')queueMicrotask(()=>fn(0,null));},kill:()=>{}};
  }
 });
 assert.equal(exit,0);
 assert.equal(command,process.execPath);
 assert.deepEqual(args.slice(-4),['-H','127.0.0.1','-p','45211']);
 assert.equal(config.env.CONTENT_STUDIO_ALLOW_REMOTE,'0');
 assert.equal(config.env.ENABLE_SCENARIO,'0');
 assert.equal(config.cwd,cwd);
});

test('V49 actual CLI checks Next dotenv files before start and never emits secret values',t=>{
 const cwd=fixture(t),secret='STUDIO_V49_TEST_ONLY_PASSWORD_DO_NOT_LOG';
 writeFileSync(join(cwd,'.env.local'),[
  'CONTENT_STUDIO_ALLOW_REMOTE=1',
  'NEXT_PUBLIC_ACCESS_TOKEN='+secret,
  'ENABLE_SCENARIO=1'
 ].join('\n'));
 const script=resolve('scripts/runtime-guard.mjs');
 const result=spawnSync(process.execPath,[script,'preflight'],{
  cwd,encoding:'utf8',timeout:10000,
  env:{PATH:process.env.PATH||'',HOME:process.env.HOME||'',NODE_ENV:'production'}
 });
 assert.equal(result.status,78,result.stderr);
 assert.ok(result.stdout.trim(),'Preflight must emit JSON, stderr: '+result.stderr);
 const parsed=JSON.parse(result.stdout);
 assert.equal(parsed.ready,false);
 assert.ok(parsed.problems.includes('unauthenticated_remote_access_opt_in_forbidden'));
 assert.ok(parsed.problems.includes('fixture_seed_endpoint_must_be_disabled_for_production'));
 assert.ok(parsed.problems.includes('public_environment_contains_secret_like_names'));
 assert.equal((result.stdout+result.stderr).includes(secret),false);
});
