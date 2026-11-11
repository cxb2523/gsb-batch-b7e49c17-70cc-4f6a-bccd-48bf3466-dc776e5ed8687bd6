import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {mkdtemp, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {downloadMedia} from '../src/main/resumable-download';

const data=Buffer.from('abcdefghijklmnopqrstuvwxyz'.repeat(1024));
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t:any, handler:(req:IncomingMessage,res:ServerResponse)=>void){
 const dir=await mkdtemp(path.join(tmpdir(),'manju-resume-'));
 const server=createServer(handler);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address==='object');
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true})});
 return {url:`http://127.0.0.1:${address.port}/video?private-token=secret`,path:path.join(dir,'input'),metadataPath:path.join(dir,'input.json'),size:data.length,fingerprint:'opaque-resource-hash',signal:new AbortController().signal};
}
async function seed(f:Awaited<ReturnType<typeof fixture>>, bytes:number, extra:Record<string,unknown>={}){
 await writeFile(f.path,data.subarray(0,bytes));
 await writeFile(f.metadataPath,JSON.stringify({version:1,size:f.size,fingerprint:f.fingerprint,etag:'"v1"',bytes,...extra}));
}
function serve(req:IncomingMessage,res:ServerResponse, etag='"v1"'){
 const start=Number(req.headers.range?.match(/^bytes=(\d+)-$/)?.[1]??0);
 res.writeHead(start?206:200,{'ETag':etag,'Content-Length':data.length-start,...(start?{'Content-Range':`bytes ${start}-${data.length-1}/${data.length}`}:{})});res.end(data.subarray(start));
}

test('cancel then reopen resumes the committed prefix with If-Range and ordered callback bytes',async t=>{
 const requests:{range?:string;ifRange?:string}[]=[];
 const f=await fixture(t,(req,res)=>{
  requests.push({range:req.headers.range,ifRange:req.headers['if-range'] as string|undefined});
  if(requests.length>1){serve(req,res);return}
  res.writeHead(200,{'ETag':'"v1"','Content-Length':data.length});res.write(data.subarray(0,4096));
 });
 const controller=new AbortController();
 await assert.rejects(downloadMedia({...f,signal:controller.signal,onProgress:bytes=>{if(bytes>=4096)controller.abort()}}),{code:'CANCELLED'});
 assert.equal((await stat(f.path)).size,4096);
 const chunks:Buffer[]=[];let position=0;
 await downloadMedia({...f,onChunk:(chunk,offset)=>{assert.equal(offset,position);position+=chunk.length;chunks.push(Buffer.from(chunk))}});
 assert.deepEqual(requests[1],{range:'bytes=4096-',ifRange:'"v1"'});
 assert.deepEqual(Buffer.concat(chunks),data);assert.deepEqual(await readFile(f.path),data);
 const metadata=await readFile(f.metadataPath,'utf8');assert.ok(!metadata.includes('secret'));assert.ok(!metadata.includes('http'));
 assert.deepEqual(Object.keys(JSON.parse(metadata)).sort(),['bytes','etag','fingerprint','size','version']);
});

test('a server ignoring Range truncates the input and restarts safely',async t=>{
 let requestCount=0;const f=await fixture(t,(_req,res)=>{requestCount++;res.writeHead(200,{'ETag':'"v1"','Content-Length':data.length});res.end(data)});
 await seed(f,500);await downloadMedia(f);assert.deepEqual(await readFile(f.path),data);assert.equal(requestCount,1);
});

test('a changed validator restarts instead of joining different representations',async t=>{
 const requests:string[]=[];const f=await fixture(t,(req,res)=>{requests.push(req.headers.range??'full');serve(req,res,'"v2"')});
 await seed(f,500);await downloadMedia(f);assert.deepEqual(requests,['bytes=500-','full']);assert.deepEqual(await readFile(f.path),data);
});

test('reset after replay explicitly rejects so a streaming consumer cannot receive duplicates',async t=>{
 const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'ETag':'"v2"'});res.end(data)});await seed(f,500);
 const chunks:Buffer[]=[];
 await assert.rejects(downloadMedia({...f,onChunk:chunk=>{chunks.push(Buffer.from(chunk))}}),{code:'DOWNLOAD_RESTART_REQUIRED'});
 assert.deepEqual(Buffer.concat(chunks),data.subarray(0,500));assert.equal((await stat(f.path)).size,0);
 await downloadMedia(f);assert.deepEqual(await readFile(f.path),data);
});

test('malformed Content-Range is rejected and a valid existing prefix is preserved',async t=>{
 const f=await fixture(t,(_req,res)=>{res.writeHead(206,{'ETag':'"v1"','Content-Range':`bytes 499-${data.length-1}/${data.length}`});res.end(data.subarray(500))});await seed(f,500);
 await assert.rejects(downloadMedia(f),{code:'INCOMPLETE_RESOURCE'});assert.equal((await stat(f.path)).size,500);
});

test('fingerprint mismatch and missing strong validators restart before replay',async t=>{
 for(const extra of [{fingerprint:'different'}, {etag:'W/"v1"'}, {etag:undefined,lastModified:'Wed, 21 Oct 2015 07:28:00 GMT'}]){
  const ranges:(string|undefined)[]=[];const f=await fixture(t,(req,res)=>{ranges.push(req.headers.range);serve(req,res)});await seed(f,500,extra);
  const chunks:Buffer[]=[];await downloadMedia({...f,onChunk:chunk=>{chunks.push(Buffer.from(chunk))}});
  assert.deepEqual(ranges,[undefined]);assert.deepEqual(Buffer.concat(chunks),data);
 }
});

test('crash tail beyond committed metadata bytes is discarded before resuming',async t=>{
 let range:string|undefined;const f=await fixture(t,(req,res)=>{range=req.headers.range;serve(req,res)});await seed(f,500);await writeFile(f.path,Buffer.concat([data.subarray(0,500),Buffer.from('uncommitted')]));
 await downloadMedia(f);assert.equal(range,'bytes=500-');assert.deepEqual(await readFile(f.path),data);
});

test('read inactivity times out and retries are bounded',async t=>{
 let requests=0;const f=await fixture(t,(_req,res)=>{requests++;res.writeHead(200,{'ETag':'"v1"'});res.flushHeaders()});
 await assert.rejects(downloadMedia({...f,idleTimeoutMs:60}),{code:'NETWORK'});assert.equal(requests,3);
});

test('header inactivity times out and cancellation interrupts retry backoff',async t=>{
 let requests=0;const f=await fixture(t,()=>{requests++});const controller=new AbortController();
 const started=Date.now();setTimeout(()=>controller.abort(),150);
 await assert.rejects(downloadMedia({...f,signal:controller.signal,idleTimeoutMs:60}),{code:'CANCELLED'});
 assert.ok(Date.now()-started<600);assert.equal(requests,1);
});

test('an actively progressing transfer may exceed the inactivity timeout',async t=>{
 const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'ETag':'"v1"','Content-Length':data.length});void(async()=>{for(let offset=0;offset<data.length;offset+=4096){res.write(data.subarray(offset,offset+4096));await pause(35)}res.end()})()});
 const started=Date.now();await downloadMedia({...f,idleTimeoutMs:120});assert.ok(Date.now()-started>120);assert.deepEqual(await readFile(f.path),data);
});

test('short and oversized responses fail without accepting an invalid completed input',async t=>{
 for(const body of [data.subarray(0,100),Buffer.concat([data,Buffer.from('extra')])]){
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'ETag':'"v1"'});res.end(body)});
  await assert.rejects(downloadMedia(f),{code:'INCOMPLETE_RESOURCE'});
  assert.ok((await stat(f.path)).size<=data.length);
 }
});

test('slow caller work does not count as network inactivity',async t=>{
 const f=await fixture(t,serve);await downloadMedia({...f,idleTimeoutMs:80,throttle:async()=>{await pause(130)}});assert.deepEqual(await readFile(f.path),data);
});

test('a full prefix without confirmed EOF is restarted on reopen',async t=>{
 let requests=0;const f=await fixture(t,(req,res)=>{requests++;if(requests>1){serve(req,res);return}res.writeHead(200,{'ETag':'"v1"'});res.write(data)});
 const controller=new AbortController();
 await assert.rejects(downloadMedia({...f,signal:controller.signal,onProgress:bytes=>{if(bytes===data.length)controller.abort()}}),{code:'CANCELLED'});
 await downloadMedia(f);assert.equal(requests,2);assert.deepEqual(await readFile(f.path),data);
});

test('caller exceptions are sanitized and never retried as network failures',async t=>{
 let requests=0;const f=await fixture(t,(req,res)=>{requests++;serve(req,res)});
 await assert.rejects(downloadMedia({...f,onProgress:bytes=>{if(bytes)throw new TypeError(`${f.url} private-key`)}}),error=>{
  assert.equal((error as any).code,'MEDIA_STREAM');assert.ok(!String(error).includes('secret'));assert.ok(!String(error).includes('private-key'));return true;
 });assert.equal(requests,1);
});

test('a dropped connection retries from the checkpoint without replaying callback data twice',async t=>{
 const ranges:(string|undefined)[]=[];const f=await fixture(t,(req,res)=>{
  ranges.push(req.headers.range);if(ranges.length>1){serve(req,res);return}
  res.writeHead(200,{'ETag':'"v1"','Content-Length':data.length});res.write(data.subarray(0,4096));setTimeout(()=>res.destroy(),40);
 });
 const chunks:Buffer[]=[];let offset=0;
 await downloadMedia({...f,onChunk:(chunk,start)=>{assert.equal(start,offset);offset+=chunk.length;chunks.push(Buffer.from(chunk))}});
 assert.deepEqual(ranges,[undefined,'bytes=4096-']);assert.deepEqual(Buffer.concat(chunks),data);
});

test('a transport failure after the final byte cannot retry using an empty range',async t=>{
 const ranges:(string|undefined)[]=[];const f=await fixture(t,(req,res)=>{
  ranges.push(req.headers.range);if(ranges.length>1){serve(req,res);return}
  res.writeHead(200,{'ETag':'"v1"'});res.write(data);setTimeout(()=>res.destroy(),40);
 });
 await downloadMedia(f);assert.deepEqual(ranges,[undefined,undefined]);assert.deepEqual(await readFile(f.path),data);
});

test('successful confirmed EOF leaves the fetch signal un-aborted and detaches the caller signal',async t=>{
 const f=await fixture(t,serve),controller=new AbortController();
 const nativeFetch=globalThis.fetch;let fetchSignal:AbortSignal|null|undefined,aborts=0;
 t.mock.method(globalThis,'fetch',(...args:Parameters<typeof fetch>)=>{
  fetchSignal=args[1]?.signal;fetchSignal?.addEventListener('abort',()=>aborts++);
  return nativeFetch(...args);
 });
 await downloadMedia({...f,signal:controller.signal});
 assert.ok(fetchSignal);assert.equal(fetchSignal.aborted,false);assert.equal(aborts,0);
 controller.abort();assert.equal(fetchSignal.aborted,false);assert.equal(aborts,0);
 assert.deepEqual(await readFile(f.path),data);
});
