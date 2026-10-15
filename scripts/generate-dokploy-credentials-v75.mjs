/**
 * Run LOCALLY: read a strong passphrase from stdin; never accept CLI args,
 * do not log passwords, and print only scrypt verifier and random session key.
 */
import {newCredentials} from '../src/remote-auth-v75.mjs';
let secret='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 secret+=chunk;
 if(secret.length>300){console.error('Credential input too large');process.exit(1)}
});
process.stdin.on('end',()=>{
 try{
  const password=secret.replace(/[\r\n]+$/,'');
  const out=newCredentials(password);
  process.stdout.write('CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT='+out.passwordScrypt+'\n');
  process.stdout.write('CONTENT_STUDIO_AUTH_SESSION_KEY='+out.sessionKey+'\n');
 }catch{
  console.error('Password must be 16–256 characters; no credentials produced');
  process.exitCode=1;
 }finally{secret=''}
});
