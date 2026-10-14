/** Optional V50 operator command. Only sends GET / to configured loopback. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectDoocsService} from '../src/doocs-local-preflight.mjs';

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2){console.error('Usage: npm run doocs:preflight');process.exitCode=2}
 else inspectDoocsService().then(result=>{
  console.log(JSON.stringify(result,null,2));
  if(result.status!=='reachable')process.exitCode=1;
 }).catch(()=>{console.error('doocs loopback preflight could not complete');process.exitCode=1});
}
