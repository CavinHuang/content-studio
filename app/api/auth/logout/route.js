import {validateRemoteConfig,validateRemoteWrite,hasSession,
 setCookie} from '../../../../src/remote-auth-v75.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request){
 try{
  validateRemoteConfig();validateRemoteWrite(request);
  if(!hasSession(request.headers))return Response.json({error:'Authentication required'},{
   status:401,headers:{'Cache-Control':'no-store'}});
  return Response.json({ok:true},{headers:{
   'Cache-Control':'no-store','Set-Cookie':setCookie('',{clear:true})}});
 }catch{return Response.json({error:'Forbidden'},{status:403,
  headers:{'Cache-Control':'no-store'}})}
}
