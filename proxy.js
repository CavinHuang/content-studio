/**
 * V75: Next 16 proxy blocks unauthenticated pages before rendering. API
 * dispatch independently enforces authentication; this is defense in depth.
 */
import {NextResponse} from 'next/server';
import {env as runtimeEnv} from 'node:process';
import {hasSession,validateRemoteTransport,validateRemoteConfig} from './src/remote-auth-v75.mjs';

export function proxy(request){
 if(runtimeEnv.CONTENT_STUDIO_DEPLOY_MODE!=='dokploy')return NextResponse.next();
 let origin;
 try{origin=validateRemoteConfig().publicOrigin}
 catch{return new Response('Remote authentication unavailable',{
  status:503,headers:{'Cache-Control':'no-store'}})}
 try{
  const health=request.nextUrl.pathname==='/api/health'&&request.method==='GET';
  if(!health)validateRemoteTransport(request,runtimeEnv);
 }catch{
  return new Response('Untrusted proxy transport',{status:403,
   headers:{'Cache-Control':'no-store'}});
 }
 const p=request.nextUrl.pathname;
 const allowed=p==='/login'||p==='/api/auth/login'||p==='/api/health';
 const loggedIn=hasSession(request.headers);
 if(allowed){
  if(p==='/login'&&loggedIn)return NextResponse.redirect(new URL('/',origin));
  return NextResponse.next();
 }
 if(!loggedIn){
  if(p.startsWith('/api/'))return Response.json({error:'Authentication required'},{
   status:401,headers:{'Cache-Control':'no-store'}
  });
  return NextResponse.redirect(new URL('/login',origin),{status:303});
 }
 const response=NextResponse.next();
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('X-Frame-Options','DENY');
 response.headers.set('Strict-Transport-Security','max-age=31536000');
 return response;
}
// Health is intentionally anonymous and metadata-minimal in remote mode.
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|api/health).*)']};
