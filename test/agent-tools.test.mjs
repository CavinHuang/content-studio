import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_TOOLS} from '../src/agent-tools.mjs';
import {DEFAULT_AGENT_TOOLS} from '../src/agent-runtime.mjs';

test('tool registry matches runtime allowlist and declares safe schemas',()=>{
 assert.deepEqual(Object.keys(AGENT_TOOLS).sort(),[...DEFAULT_AGENT_TOOLS].sort());
 for(const tool of Object.values(AGENT_TOOLS)){
  assert.equal(typeof tool.execute,'function',tool.name);
  assert.equal(typeof tool.description,'string',tool.name);
  assert.equal(tool.parameters.additionalProperties,false,tool.name+' closed schema');
 }
 const forbidden=['publish','send_draft','export','upload_platform'];
 for(const f of forbidden)assert.equal(AGENT_TOOLS[f],undefined,f+' must not exist');
 assert.equal(AGENT_TOOLS.write_revision.mode,'revisions');
 assert.equal(AGENT_TOOLS.generate_image.writes,true);
});

test('search_assets enforces its limit and read_context counts real exclusions',async()=>{
 let seen;const core={creator:{library(args){seen=args;return [{id:'a'},{id:'b'},{id:'c'}]},context(){return {revision:1,profileRevision:1,profile:{},sources:[],excluded:[{id:'x'}]}}}};
 const ctx={projectId:'ep_x',channel:'master',runId:'ar_t',skillTitle:'t',expectedRevision:()=>1,onWritten(){}};
 const limited=await AGENT_TOOLS.search_assets.execute(core,ctx,{q:'x',limit:2});
 assert.equal(limited.length,2);assert.deepEqual(seen,{q:'x',kind:undefined,tag:undefined});
 const ctxOut=await AGENT_TOOLS.read_context.execute(core,ctx,{});
 assert.equal(ctxOut.excludedCount,1);
});
