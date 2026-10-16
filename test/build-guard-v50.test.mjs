import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {auditClientBuildEnvironment,prepareBuildEnvironment,runSafeBuild} from '../scripts/build-guard.mjs';

test('V50 build preflight detects populated browser-visible secrets without revealing values',()=>{
 const text='PRODUCTION_PRIVATE_NEVER_ECHO';
 const report=auditClientBuildEnvironment({
  NEXT_PUBLIC_DOOCS_MD_URL:'http://127.0.0.1:8800/',
  NEXT_PUBLIC_CONTENT_IMAGE_API_KEY:text,
  NEXT_PUBLIC_ACCESS_TOKEN:'another-sensitive-value'
 });
 assert.equal(report.safe,false);
 assert.equal(report.secretValuesIncluded,false);
 assert.equal(report.externalCalls,0);
 assert.deepEqual(report.unsafeVariableNames,['NEXT_PUBLIC_ACCESS_TOKEN','NEXT_PUBLIC_CONTENT_IMAGE_API_KEY']);
 assert.ok(!JSON.stringify(report).includes(text));
 assert.equal(auditClientBuildEnvironment({NEXT_PUBLIC_DOOCS_MD_URL:'http://localhost:8800/'}).safe,true);
});
test('V50 guard loads environment files before the build decision',()=>{
 const env={};
 const status=prepareBuildEnvironment({env,load:()=>{env.NEXT_PUBLIC_AI_SECRET='hidden-value'}});
 assert.equal(status.safe,false);
 assert.ok(status.unsafeVariableNames.includes('NEXT_PUBLIC_AI_SECRET'));
});
test('V50 unsafe production build never starts Next.js',()=>{
 let attempts=0;
 const env={NEXT_PUBLIC_API_KEY:'secret-to-hide'};
 const result=runSafeBuild({env,load:()=>{},runner:()=>{attempts++;return {status:0}}});
 assert.equal(result.code,78);
 assert.equal(attempts,0);
});
test('V50 build wrapper invokes actual Next.js build command when configuration is clean',()=>{
 let executed=null;
 const output=runSafeBuild({env:{},cwd:process.cwd(),
  runner:(bin,args,options)=>{executed={bin,args,options};return {status:0}}});
 assert.equal(output.code,0);
 assert.equal(executed.bin,process.execPath);
 assert.ok(executed.args[0].endsWith('/node_modules/next/dist/bin/next'));
 assert.equal(executed.args[1],'build');
});
test('V50 preflight CLI detects unsafe .env.local before bundling without printing value',t=>{
 const cwd=mkdtempSync(join(tmpdir(),'v50-build-env-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const marker='THIS_IS_PRIVATE_AND_MUST_NOT_APPEAR';
 writeFileSync(join(cwd,'.env.local'),'NEXT_PUBLIC_API_KEY='+marker+'\n');
 const runner=spawnSync(process.execPath,[resolve('scripts/build-guard.mjs'),'preflight'],{
  cwd,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH||'',HOME:process.env.HOME||'',NODE_ENV:'production'}
 });
 assert.equal(runner.status,78,runner.stderr);
 const result=JSON.parse(runner.stdout);
 assert.ok(result.unsafeVariableNames.includes('NEXT_PUBLIC_API_KEY'));
 assert.ok(!(runner.stdout+runner.stderr).includes(marker));
});
