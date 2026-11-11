import test from 'node:test';import assert from 'node:assert/strict';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {PassThrough} from 'node:stream';import {EventEmitter} from 'node:events';import {mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {MediaCache} from '../src/main/media';import {CacheManager} from '../src/main/cache-manager';
import fsPromises from 'node:fs/promises';
const ids=['7695386527160863769','7695386527160863770'];
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const box=(kind:string)=>{const bytes=Buffer.alloc(8);bytes.writeUInt32BE(8);bytes.write(kind,4);return bytes};
async function fixture(t:any,streaming=false){
 const dir=await mkdtemp(path.join(tmpdir(),'manju-lifecycle-'));let stream!:ReadableStreamDefaultController<Uint8Array>,outputReady=false;
 t.mock.method(childProcess,'spawn',(_exe:string,args:string[])=>{const stdin=new PassThrough();stdin.resume();let closed=false;const child=Object.assign(new EventEmitter(),{stdin,stdout:new PassThrough(),stderr:new PassThrough(),kill(){if(!closed){closed=true;queueMicrotask(()=>child.emit('close',null))}return true}});const finish=()=>{if(closed)return;closed=true;child.stdout.write('out_time_us=1000000\n');child.emit('close',0)};
  if(streaming)stdin.on('finish',finish);
  queueMicrotask(async()=>{await writeFile(args.at(-1)!,streaming?Buffer.concat([Buffer.from('moofmdat'),Buffer.alloc(2000)]):Buffer.alloc(14));outputReady=true;streaming?child.stdout.write('out_time_us=500000\n'):finish()});return child;
 });syncBuiltinESMExports();
 t.mock.method(globalThis,'fetch',async(_url:string,options:RequestInit)=>streaming?new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;controller.enqueue(Buffer.concat([box('ftyp'),box('moov'),Buffer.alloc(1984)]));options.signal?.addEventListener('abort',()=>controller.error(Error('aborted')),{once:true})}}),{headers:{etag:'"stable"'}}):new Response('source'));
 const media=new MediaCache(dir,'fake',async id=>({episodeId:id,url:'https://example.com/'+id,size:streaming?4000:6,definition:'720p',duration:1,codec:'h264',encrypted:false}),{concurrency:2,progressive:streaming,freeBytes:async()=>10*1024**3});await media.init();
 t.after(async()=>{await media.close();t.mock.restoreAll();syncBuiltinESMExports();await rm(dir,{recursive:true,force:true})});
 return {media,dir,get outputReady(){return outputReady},finishDownload(){stream.enqueue(Buffer.alloc(2000));stream.close()}};
}
test('后台渐进片段已经可播放时，选中同集立即采用，不等待下载结束',async t=>{
 const f=await fixture(t,true);f.media.setBackgroundGroups([{id:ids[1],ids:[ids[0]],paused:false}]);
 for(let n=0;n<100&&!f.outputReady;n++)await wait(10);assert.equal(f.outputReady,true);await wait(200);
 const pending=f.media.prepare(ids[0]);const result=await Promise.race([pending,wait(150).then(()=>null)]);assert.ok(result,'a ready background stream must be adopted before EOF');assert.equal(result.progressive,true);assert.equal(f.media.stateFor([ids[0]]).ready,0);
 f.finishDownload();for(let n=0;n<100&&!f.media.stateFor([ids[0]]).ready;n++)await wait(10);assert.equal(f.media.stateFor([ids[0]]).ready,1);
});
test('转码最终文件大于额度时不得提交，也不保留成功下载的临时输入',async t=>{
 const f=await fixture(t);f.media.setLimits({maxBytes:12,bytesPerSecond:0});await assert.rejects(f.media.prepare(ids[0]),{code:'CACHE_BUDGET'});assert.equal(f.media.stateFor([ids[0]]).ready,0);assert.equal(f.media.usedBytes,0);assert.equal((await readdir(f.dir)).filter(name=>name.endsWith('.mp4')).length,0);
});
test('并发最终输出按实际大小预留，不能分别通过额度检查后合计超额',async t=>{
 const f=await fixture(t);f.media.setLimits({maxBytes:20,bytesPerSecond:0});const results=await Promise.allSettled(ids.map(id=>f.media.prepare(id)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason?.code==='CACHE_BUDGET').length,1);assert.equal(f.media.usedBytes,14);
});
test('切换画质替换旧文件按最终保留量检查额度，不重复计算旧文件和本集输入',async t=>{
 const f=await fixture(t);f.media.setLimits({maxBytes:14,bytesPerSecond:0});await f.media.prepare(ids[0]);f.media.setQuality('720p');await f.media.prepare(ids[0]);assert.equal(f.media.usedBytes,14);assert.equal(f.media.stateFor([ids[0]]).ready,1);
});

test('取消前台渐进准备后，真实断点字节有只读清理入口并可删除',async t=>{
 const f=await fixture(t,true),manager=new CacheManager(f.dir,f.media);await manager.init();await manager.remember({id:ids[1],title:'partial only',cover:'',description:'',total:1,episodes:[{id:ids[0],order:1}]});void f.media.prepare(ids[0]).catch(()=>{});for(let n=0;n<100&&!f.media.usedBytes;n++)await wait(10);f.media.setBufferWindow([]);const snapshot=await manager.snapshot();assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.tasks[0].registered,false);await manager.action(ids[1],'delete');assert.equal(f.media.usedBytes,0);assert.equal((await manager.snapshot()).tasks.length,0);
});

test('成功输入无法删除时不提交可能超额的输出，保留断点字节供清理',async t=>{
 const f=await fixture(t),unlink=fsPromises.unlink;t.mock.method(fsPromises,'unlink',async(file:any)=>{if(String(file).endsWith('.partial.mp4'))throw Object.assign(Error('locked'),{code:'EPERM'});return unlink(file)});syncBuiltinESMExports();f.media.setLimits({maxBytes:14,bytesPerSecond:0});await assert.rejects(f.media.prepare(ids[0]),{code:'MEDIA_CACHE'});assert.equal(f.media.stateFor([ids[0]]).ready,0);assert.equal(f.media.usedBytes,6);assert.equal(f.media.stateFor([ids[0]]).cachedBytes,6);
});

async function failedExposedStream(t:any){
 const dir=await mkdtemp(path.join(tmpdir(),'manju-stream-retry-'));let stream!:ReadableStreamDefaultController<Uint8Array>,lookups=0,fetches=0,resumeFallback!:(resource:any)=>void;
 const resource={episodeId:ids[0],url:'https://example.com/video',size:4000,definition:'720p',duration:1,codec:'h264',encrypted:false};
 const heldFallback=new Promise<any>(resolve=>{resumeFallback=resolve});
 t.mock.method(childProcess,'spawn',(_exe:string,args:string[])=>{const progressive=args[args.indexOf('-i')+1]==='pipe:0',stdin=new PassThrough();stdin.resume();let closed=false;const child=Object.assign(new EventEmitter(),{stdin,stdout:new PassThrough(),stderr:new PassThrough(),kill(){if(!closed){closed=true;queueMicrotask(()=>child.emit('close',null))}return true}});
  if(progressive)stdin.on('finish',()=>{if(!closed){closed=true;child.emit('close',1)}});
  queueMicrotask(async()=>{await writeFile(args.at(-1)!,progressive?Buffer.concat([Buffer.from('moofmdat'),Buffer.alloc(2000)]):Buffer.alloc(20));child.stdout.write(progressive?'out_time_us=500000\n':'out_time_us=1000000\n');if(!progressive&&!closed){closed=true;child.emit('close',0)}});return child;
 });syncBuiltinESMExports();
 t.mock.method(globalThis,'fetch',async(_url:string,options:RequestInit)=>{fetches++;return fetches===1?new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;controller.enqueue(Buffer.concat([box('ftyp'),box('moov'),Buffer.alloc(1984)]));options.signal?.addEventListener('abort',()=>controller.error(Error('aborted')),{once:true})}}),{headers:{etag:'"stable"'}}):new Response(Buffer.alloc(4000),{headers:{etag:'"stable"'}})});
 const media=new MediaCache(dir,'fake',async()=>{lookups++;return lookups===2?heldFallback:resource},{concurrency:2,freeBytes:async()=>10*1024**3});await media.init();
 t.after(async()=>{await media.close();t.mock.restoreAll();syncBuiltinESMExports();await rm(dir,{recursive:true,force:true})});
 const initial=await media.prepare(ids[0]);assert.equal(initial.progressive,true);stream.enqueue(Buffer.alloc(2000));stream.close();for(let n=0;n<100&&lookups<2;n++)await wait(10);assert.equal(lookups,2,'must reach the non-progressive fallback');
 return {media,initial,resumeFallback:()=>resumeFallback(resource),get lookups(){return lookups},get fetches(){return fetches}};
}
test('已暴露渐进流失败后，普通接管等待完整补救结果，不返回失效地址',async t=>{
 const f=await failedExposedStream(t),adopted=f.media.prepare(ids[0]);assert.equal(await Promise.race([adopted,wait(50).then(()=>null)]),null);f.resumeFallback();const result=await adopted;assert.notEqual(result.url,f.initial.url);assert.equal(result.progressive,undefined);assert.equal((await f.media.response(result.url,null)).status,200);assert.equal(f.fetches,2);
});
test('已暴露渐进流失败后，强制重试取消补救任务并拒绝其等待者，准备新地址',async t=>{
 const f=await failedExposedStream(t),adopted=f.media.prepare(ids[0]),cancelled=assert.rejects(adopted,{code:'CANCELLED'}),retried=f.media.prepare(ids[0],true);const result=await retried;await cancelled;assert.notEqual(result.url,f.initial.url);assert.equal(result.progressive,undefined);assert.equal(f.lookups,3);assert.equal(f.fetches,2);f.resumeFallback();assert.equal((await f.media.response(result.url,null)).status,200);
});
