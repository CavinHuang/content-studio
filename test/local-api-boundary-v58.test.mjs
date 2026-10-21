import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalApiRequest} from '../src/local-api-boundary.mjs';

const BASE='http://127.0.0.1:4312/api/editor/projects';
function check(url=BASE,{method='GET',headers={},body}={}){
  return validateLocalApiRequest(new Request(url,{method,headers,body}));
}
const json={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
function denied(url,options,code){
  assert.throws(()=>check(url,options),e=>e.status===code);
}

test('V58 allows trusted no-body commands, loopback reads and JSON writes',()=>{
  assert.equal(check().checked,true);
  assert.equal(check(BASE,{method:'POST'}).checked,true);
  assert.equal(check(BASE,json).localOnly,true);
  check('http://localhost:4312/api/editor/projects',{...json,headers:{...json.headers,host:'127.0.0.1:4312',origin:'http://localhost:4312', 'sec-fetch-site':'same-site'}});
  check(BASE,{...json,headers:{...json.headers,host:'[::1]:4312',origin:'http://localhost:4312'}});
  check('http://[::1]:4312/api/editor/projects',{...json,headers:{...json.headers,host:'localhost:4312',origin:'http://127.0.0.1:4312'}});
  check(BASE,{...json,headers:{...json.headers,'Content-Type':'application/json; charset=UTF-8'}});
});

test('V58 rejects remote, rebinding and forged Host authorities',()=>{
  for(const host of ['evil.example:4312','localhost:9999','localhost:4312,evil.example','localhost:4312@evil.example','localhost:4312/path', '172.17.0.1:4312'])
    denied(BASE,{headers:{host}},403);
  denied('http://evil.example:4312/api/health',{},403);
  denied('file:///api/health',{},403);
});

test('V58 prevents cross-site reads and mutations even when Origin is missing',()=>{
  denied(BASE,{headers:{'sec-fetch-site':'cross-site'}},403);
  denied(BASE,{...json,headers:{...json.headers,'sec-fetch-site':'cross-site'}},403);
  denied(BASE,{...json,headers:{...json.headers,'sec-fetch-site':'same-site'}},403);
  denied(BASE,{...json,headers:{...json.headers,'sec-fetch-mode':'navigate'}},403);
});

test('V58 accepts same-port loopback aliases but not other origins or ports',()=>{
  for(const origin of ['https://127.0.0.1:4312','http://127.0.0.1:4313','http://evil.test:4312',
    'null','not-an-origin','http://127.0.0.1:4312/path','http://127.0.0.1:4312@evil.test'])
    denied(BASE,{...json,headers:{...json.headers,origin}},403);
});

test('V58 disallows simple-form payloads and untyped browser writes',()=>{
  for(const contentType of ['text/plain','application/x-www-form-urlencoded','multipart/form-data; boundary=abc',
    'application/jsonp','application/json; charset=iso-8859-1'])
    denied(BASE,{method:'POST',headers:{'Content-Type':contentType},body:'{}'},400);
  denied(BASE,{method:'POST',headers:{'content-type':'application/json; charset=UTF-8','sec-fetch-site':'cross-site'},body:'{}'},403);
  denied(BASE,{method:'POST',headers:{'content-type':'text/plain'},body:'{'},400);
});

// V58 judges "has a body" by wire framing headers, not the request.body
// object: the proxy runtime exposes a non-null body stream even for
// bodyless requests, which used to reject every bodyless local write.
const shaped=(method,headers)=>({
  url:BASE, method, headers:new Headers(headers), body:new ReadableStream({start(){}}),
});
const framed=(method,headers)=>validateLocalApiRequest({
  url:BASE, method, headers:new Headers(headers), body:null,
});
test('V58 keeps bodyless writes valid even when the runtime exposes a body stream',()=>{
  assert.equal(check(BASE,{method:'DELETE'}).checked,true);
  assert.equal(validateLocalApiRequest(shaped('DELETE',{})).checked,true);
  assert.equal(framed('DELETE',{'content-length':'0'}).checked,true);
});
test('V58 still requires JSON content-type for writes that actually carry a body',()=>{
  assert.throws(()=>framed('DELETE',{'content-length':'5'}),e=>e.status===400);
  assert.throws(()=>framed('DELETE',{'transfer-encoding':'chunked'}),e=>e.status===400);
  assert.throws(()=>framed('POST',{'content-length':'2','content-type':'text/plain'}),e=>e.status===400);
  assert.throws(()=>validateLocalApiRequest(shaped('POST',{'content-length':'2','content-type':'text/plain'})),e=>e.status===400);
});
