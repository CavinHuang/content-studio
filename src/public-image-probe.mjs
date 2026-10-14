/**
 * V53: deliberate, bounded read-only public image probe.
 * SSRF protection is enforced at the connection boundary, not only by
 * checking the user-supplied hostname before Node resolves it.
 *
 * This is evidence of an HTTPS server answering with image-looking bytes,
 * NOT a complete image download, target-platform render or publication.
 */
import {lookup as systemLookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';

const MAX_PROBES=3;
const MAX_BYTES=32768;
const TIMEOUT_MS=4000;
const IPV4_DENY=[
 [0,0,0,0,8],[10,0,0,0,8],[100,64,0,0,10],[127,0,0,0,8],
 [169,254,0,0,16],[172,16,0,0,12],[192,0,0,0,24],
 [192,0,2,0,24],[192,168,0,0,16],[198,18,0,0,15],
 [198,51,100,0,24],[203,0,113,0,24],[224,0,0,0,4],
 [240,0,0,0,4]
];
const toInt=bytes=>bytes.reduce((n,b)=>(n<<8)|b,0)>>>0;
const network=(n,mask)=>mask===0?0:(n>>>(32-mask))>>>0;
function ipv4Public(input){
 const parts=input.split('.').map(Number);
 if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const address=toInt(parts);
 return !IPV4_DENY.some(([a,b,c,d,bits])=>network(address,bits)===network(toInt([a,b,c,d]),bits));
}
export function publicNetworkAddress(ip){
 const address=String(ip||'').toLowerCase().replace(/^\[|\]$/g,'').split('%')[0];
 if(isIP(address)===4)return ipv4Public(address);
 if(isIP(address)!==6)return false;
 const mapped=address.match(/^(?:0:){0,5}ffff:(\d+\.\d+\.\d+\.\d+)$/i);
 if(mapped)return ipv4Public(mapped[1]);
 // Any IPv4-mapped IPv6 is resolved to its embedded IPv4 policy.
 const tail=address.match(/(?:::|:)ffff:(\d+\.\d+\.\d+\.\d+)$/i);
 if(tail)return ipv4Public(tail[1]);
 // Restrict to global unicast and exclude IANA special-purpose documentation
 // and transition prefixes. This is intentionally more restrictive than DNS.
 if(!/^[23][0-9a-f]{3}:/.test(address))return false;
 if(/^2001:db8:/i.test(address)||/^2001:0:/i.test(address)||/^2001:10:/i.test(address)||
    /^2001:20:/i.test(address)||/^2002:/i.test(address))return false;
 return true;
}
export function validateImageProbeURL(input){
 let url;
 try{url=new URL(input)}catch{return {valid:false,reason:'invalid_url'}}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||
    url.hash||url.search||url.hostname.length>253||
    !url.hostname.includes('.')||url.hostname.endsWith('.local')||
    url.hostname.endsWith('.localhost')||url.hostname.endsWith('.internal')||
    url.hostname==='localhost'||isIP(url.hostname.replace(/^\[|\]$/g,''))!==0||
    url.hostname.endsWith('.invalid')){
  return {valid:false,reason:'requires_public_dns_https_url_without_query'};
 }
 return {valid:true,url,host:url.hostname};
}
function sniffImage(buf,type){
 if(buf.length>=24&&buf.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
  return type.includes('image/png')?'image/png':null;
 if(buf.length>=20&&buf.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))
  return type.includes('image/jpeg')?'image/jpeg':null;
 if(buf.length>=20&&(['GIF87a','GIF89a'].includes(buf.toString('ascii',0,6))))
  return type.includes('image/gif')?'image/gif':null;
 if(buf.length>=20&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')
  return type.includes('image/webp')?'image/webp':null;
 return null;
}
export async function probePublicImage(input,{lookup=systemLookup,transport=httpsRequest,timeoutMs=TIMEOUT_MS}={}){
 const base={status:'blocked',networkCalls:0,dnsLookups:0,bytesRead:0,
  fullImageDownloaded:false,imageResponseObserved:false,cdnReachabilityVerified:false,
  browserRenderVerified:false,platformVerified:false,published:false};
 const candidate=validateImageProbeURL(input);
 if(!candidate.valid)return {...base,reason:candidate.reason};
 let addresses,lookupDeadline;
 try{
  addresses=await Promise.race([
   lookup(candidate.host,{all:true,verbatim:true}),
   new Promise((_,reject)=>{
    lookupDeadline=setTimeout(()=>reject(Error('bounded-dns-deadline')),2000);
   })
  ]);
 }catch{return {...base,dnsLookups:1,reason:'dns_unavailable'}}
 finally{clearTimeout(lookupDeadline)}
 if(!Array.isArray(addresses)||!addresses.length||
    addresses.length>32||addresses.some(x=>![4,6].includes(x.family)||!publicNetworkAddress(x.address)))
  return {...base,dnsLookups:1,reason:'dns_contains_nonpublic_address'};
 // TLS verification is retained with the *original domain* and SNI.
 // Custom lookup returns a prevalidated address so reconnect cannot re-resolve
 // to an internal IP (DNS rebinding / hosts file changes).
 const address=addresses[0],ms=Math.max(300,Math.min(6000,Number(timeoutMs)||TIMEOUT_MS));
 return new Promise(resolve=>{
  let done=false,req;
  const finish=(result)=>{
   if(done)return;
   done=true;
   resolve({...base,dnsLookups:1,networkCalls:1,...result});
  };
  try{
   req=transport(candidate.url,{
    method:'GET',timeout:ms,rejectUnauthorized:true,maxRedirects:0,
    lookup:(_hostname,_opts,callback)=>callback(null,address.address,address.family),
    headers:{Accept:'image/png,image/jpeg,image/webp,image/gif',
     Range:'bytes=0-'+(MAX_BYTES-1),'User-Agent':'ContentStudio-ImageProbe/1.0'},
   },response=>{
    const statusCode=response.statusCode||0;
    if(statusCode>=300&&statusCode<400){
     response.destroy();finish({status:'blocked',reason:'redirect_not_followed',httpStatus:statusCode});return;
    }
    if(![200,206].includes(statusCode)){
     response.destroy();finish({status:'unavailable',reason:'image_http_error',httpStatus:statusCode});return;
    }
    const contentType=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(!['image/png','image/jpeg','image/gif','image/webp'].includes(contentType)){
     response.destroy();finish({status:'unavailable',reason:'unexpected_content_type',httpStatus:statusCode});return;
    }
    let length=0,chunks=[];
    response.on('data',chunk=>{
     length+=chunk.length;
     if(length>MAX_BYTES){
      response.destroy();finish({status:'unavailable',reason:'response_exceeded_probe_limit',
       httpStatus:statusCode,bytesRead:MAX_BYTES});return;
     }
     chunks.push(chunk);
    });
    response.once('end',()=>{
     if(done)return;
     const bytes=Buffer.concat(chunks);
     const format=sniffImage(bytes,contentType);
     finish(format
      ?{status:'image_response_observed',reason:'partial_or_complete_image_header',
        httpStatus:statusCode,bytesRead:bytes.length,mime:format,imageResponseObserved:true}
      :{status:'unavailable',reason:'image_signature_mismatch',httpStatus:statusCode,bytesRead:bytes.length});
    });
    response.once('error',()=>finish({status:'unavailable',reason:'network_response_error'}));
   });
   req.once('error',()=>finish({status:'unavailable',reason:'network_request_failed'}));
   req.setTimeout(ms,()=>{req.destroy();finish({status:'unavailable',reason:'network_timeout'})});
   req.end();
  }catch{finish({status:'unavailable',reason:'network_request_failed'})}
 });
}
export async function inspectMappedChannelImages({
 audit,acknowledgeExternalRequests=false,expectedLayoutRevision,layoutRevision,
 probe=probePublicImage
}={}){
 if(acknowledgeExternalRequests!==true)throw Object.assign(new Error('Explicit consent required for external image HEAD/GET probes'),{status:403});
 if(expectedLayoutRevision!==layoutRevision)throw Object.assign(new Error('Layout changed; reload before network check'),{status:409});
 const eligible=[...new Set((audit?.references||[]).filter(x=>x.status==='current_mapping').map(x=>x.url))];
 if(eligible.length>MAX_PROBES)throw Object.assign(new Error('At most three channel images can be checked at once'),{status:400});
 const results=[];
 for(const url of eligible) {
  const check=await probe(url);
  results.push({url,status:check.status,reason:check.reason||null,httpStatus:check.httpStatus??null,
   bytesRead:check.bytesRead||0,mime:check.mime||null,imageResponseObserved:check.imageResponseObserved===true,
   networkCalls:check.networkCalls||0,dnsLookups:check.dnsLookups||0,
   cdnReachabilityVerified:false,
   platformVerified:false,browserRenderVerified:false});
 }
 return {kind:'content-studio-v53-author-initiated-image-check',
  source:'saved_current_channel_mappings_only',layoutRevision,
  requested:eligible.length,networkCalls:results.reduce((n,r)=>n+r.networkCalls,0),
  dnsLookups:results.reduce((n,r)=>n+r.dnsLookups,0),
  checkedAt:new Date().toISOString(),results,
  browserRenderVerified:false,platformVerified:false,published:false,
  warning:'HTTPS server image header only. This does not prove complete download, future access, image rights, or WeChat/Zhihu rendering.'};
}
