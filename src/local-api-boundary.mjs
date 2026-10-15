/**
 * V58: local, unauthenticated API boundary.
 *
 * This is defense in depth for a single-user localhost editor, NOT user
 * authentication. Reject hostile browser requests before opening SQLite,
 * spending provider budget, or updating editorial state.
 */
import {validateRemoteConfig,validateRemoteTransport,validateRemoteWrite,
 hasSession} from './remote-auth-v75.mjs';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const deny = (message, status=403) => {
  throw Object.assign(new Error(message), {status});
};
const isLoopback = url => LOOPBACK.has(url.hostname.toLowerCase());
const effectivePort = url => url.port || (url.protocol === 'https:' ? '443' : '80');

function parseAuthority(host, protocol){
  // A Host header is an authority, not a URL, list, or proxy-forwarded chain.
  if(!host || host.length > 255 || /[\s,\\/@?#]/.test(host)) deny('Invalid Host header');
  let parsed;
  try { parsed = new URL(protocol + '//' + host); }
  catch { deny('Invalid Host header'); }
  if(parsed.username || parsed.password || parsed.pathname !== '/' || !isLoopback(parsed))
    deny('Local-only Host required');
  return parsed;
}

function validateOrigin(value, target){
  let source;
  try { source = new URL(value); }
  catch { deny('Origin not permitted'); }
  // `null`, multiple origins, credentials and origin-like URL paths are denied.
  if(value !== source.origin || !isLoopback(source) || source.protocol !== target.protocol ||
      effectivePort(source) !== effectivePort(target)) deny('Origin not permitted');
}

export function validateLocalApiRequest(request){
  let target;
  try { target = new URL(request.url); }
  catch { deny('Invalid request URL'); }
  if(!['http:', 'https:'].includes(target.protocol) || !isLoopback(target))
    deny('Local-only application: remote exposure disabled');

  const host = request.headers.get('host');
  if(host){
    const authority = parseAuthority(host, target.protocol);
    if(effectivePort(authority) !== effectivePort(target)) deny('Request Host port mismatch');
  }
  // No proxy/CDN trust. A supplied Host must be loopback on the same port;
  // localhost and 127.0.0.1 are interchangeable for dev/browser handoff.
  const site = request.headers.get('sec-fetch-site');
  if(site && !['none','same-origin','same-site'].includes(site))
    deny('Cross-site browser request not permitted');

  const method = request.method.toUpperCase();
  const origin = request.headers.get('origin');
  if(origin) validateOrigin(origin, target);
  if(WRITES.has(method)){
    // A cross-site form can submit text/plain or form-urlencoded without CORS
    // preflight; JSON is non-simple and cannot be sent by such a form.
    const contentType = request.headers.get('content-type');
    const hasBody = request.body !== null;
    if(contentType && !/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?\s*)?$/i.test(contentType))
      deny('JSON Content-Type required for local API writes',400);
    if(hasBody && !contentType) deny('JSON Content-Type required for local API writes',400);
    if(site === 'same-site' && !origin) deny('Cross-port browser write requires trusted Origin');
    if(request.headers.get('sec-fetch-mode') === 'navigate')
      deny('Browser navigation may not mutate local content');
  }
  return {localOnly:true, checked:true};
}

/** Authenticated Dokploy domain path. This is checked INSIDE dispatchApi,
 * even when a request skips Next.js proxy.js. */
export function validateRemoteApiRequest(request,env=process.env){
 validateRemoteConfig(env);
 const pathname=new URL(request.url).pathname;
 const health=pathname==='/api/health'&&request.method==='GET';
 const transport=validateRemoteTransport(request,env,{allowHealthLoopback:health});
 if(!health&&!hasSession(request.headers,env))
  throw Object.assign(new Error('Authentication required'),{status:401});
 if(['POST','PUT','PATCH','DELETE'].includes(request.method.toUpperCase()))
  validateRemoteWrite(request,env);
 return {remoteAuthenticated:!health,health,internalHealth:transport.internalHealth};
}
export function validateStudioApiRequest(request,env=process.env){
 if(env.CONTENT_STUDIO_DEPLOY_MODE==='dokploy')return validateRemoteApiRequest(request,env);
 if(env.CONTENT_STUDIO_DEPLOY_MODE)
  throw Object.assign(new Error('Unknown deployment mode'),{status:403});
 return validateLocalApiRequest(request);
}
