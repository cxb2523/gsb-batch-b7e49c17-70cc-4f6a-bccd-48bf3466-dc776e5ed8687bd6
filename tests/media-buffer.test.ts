import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile,open,readdir,readFile,rename,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const ids=Array.from({length:12},(_,i)=>String(7695386527160863700n+BigInt(i)));
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await tick()}assert.fail('timed out waiting for buffer');}

async function fixture(t:any,options:{hold?:string;large?:boolean;fail?:string;holdEncode?:number;holdFirstTwo?:boolean;freeBytes?:()=>Promise<number>;concurrency?:number;failRemux?:boolean;networkDelay?:number;encodeDelay?:number}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'manju-buffer-'));
 const fetched:string[]=[],aborted:string[]=[],encoded:string[]=[],killed:string[]=[];
 const modes:string[]=[];
 let failure=options.fail,holdReleased=false;
 let active=0,maxActive=0,processing=0,maxProcessing=0,release:(()=>void)|undefined;
 const spawnMock=t.mock.method(childProcess,'spawn',(_exe:string,args:readonly string[])=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{killed.push(id);queueMicrotask(()=>child.emit('close',null));return true}});
  const id=path.basename(args[args.indexOf('-i')+1]);encoded.push(id);
  modes.push(args[args.indexOf('-c:v')+1]);
  processing++;maxProcessing=Math.max(processing,maxProcessing);child.once('close',()=>processing--);
  if(options.failRemux&&modes.at(-1)==='copy'){queueMicrotask(()=>child.emit('close',1));return child}
  if(options.holdEncode===encoded.length)return child;
  if(options.holdFirstTwo&&encoded.length<=2)return child;
  queueMicrotask(async()=>{
   if(options.encodeDelay)await new Promise(resolve=>setTimeout(resolve,options.encodeDelay));
   const file=args.at(-1)!;
   if(options.large){const handle=await open(file,'w');await handle.truncate(140*1024*1024);await handle.close()}
   else await writeFile(file,'prepared-video');
   child.stdout.write('out_time_us=1000000\n');child.emit('close',0);
  });return child;
 });
 const fetchMock=t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
  const id=new URL(url).pathname.slice(1);fetched.push(id);active++;maxActive=Math.max(active,maxActive);
  try{
   if(options.networkDelay)await new Promise(resolve=>setTimeout(resolve,options.networkDelay));
   if(id===options.hold&&!holdReleased)await new Promise<void>((resolve,reject)=>{
    release=resolve;init?.signal?.addEventListener('abort',()=>{aborted.push(id);reject(init.signal?.reason)},{once:true});
   });
   if(id===failure)throw Error('offline');
   return new Response(Buffer.from('source'));
  }finally{active--}
 });syncBuiltinESMExports();
 const {MediaCache}=await import('../src/main/media');
 const media=new MediaCache(dir,'fake-ffmpeg',async id=>({episodeId:id,duration:1,definition:'540p',codec:'h264',encrypted:false,url:`https://example.com/${id}`,size:6}),{freeBytes:options.freeBytes,concurrency:options.concurrency});await media.init();
 t.after(async()=>{await media.close();spawnMock.mock.restore();fetchMock.mock.restore();syncBuiltinESMExports();await rm(dir,{recursive:true,force:true})});
 return {media,dir,fetched,aborted,encoded,killed,modes,get maxActive(){return maxActive},get maxProcessing(){return maxProcessing},release:()=>{holdReleased=true;release?.()},recover:()=>{failure=undefined}};
}

test('缓存预算阻止新任务且不会悄悄删除受保护文件，增加额度可恢复',async t=>{
 const f=await fixture(t);f.media.setLimits({maxBytes:5,bytesPerSecond:0});await assert.rejects(f.media.prepare(ids[0]),{code:'CACHE_BUDGET'});
 f.media.setLimits({maxBytes:1024*1024,bytesPerSecond:0});await f.media.prepare(ids[0]);assert.equal(f.media.stateFor([ids[0]]).ready,1);
 f.media.setLimits({maxBytes:1,bytesPerSecond:0});await assert.rejects(f.media.prepare(ids[1]),{code:'CACHE_BUDGET'});assert.equal(f.media.stateFor([ids[0]]).ready,1);
});
test('优先队列增加高优先作品份额，同时低优先作品仍获得通道',async t=>{
 const f=await fixture(t,{networkDelay:5});f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,8),paused:false,priority:'high'},{id:ids[11],ids:ids.slice(8,10),paused:false,priority:'low'}]);
 await until(()=>f.media.stateFor(ids.slice(0,10)).ready===10);const low=f.fetched.findIndex(id=>id===ids[8]);assert.ok(low>0&&low<8);assert.ok(f.fetched.slice(0,6).filter(id=>ids.slice(0,8).includes(id)).length>=4);
});
test('改变画质后不复用旧策略缓存，同一设置不重复下载',async t=>{
 const f=await fixture(t);const a=await f.media.prepare(ids[0]);f.media.setQuality('720p');const b=await f.media.prepare(ids[0]);assert.notEqual(b.url,a.url);const count=f.fetched.length;f.media.setQuality('720p');await f.media.prepare(ids[0]);assert.equal(f.fetched.length,count);
});

test('四路准备提高下载并发，但同时处理视频不超过两路，动态设置有边界',async t=>{
 const f=await fixture(t,{concurrency:4,networkDelay:30,encodeDelay:30});
 f.media.setBackgroundGroups([{id:ids[11],ids:ids.slice(0,8),paused:false}]);
 await until(()=>f.media.stateFor(ids.slice(0,8)).ready===8);
 assert.equal(f.maxActive,4);assert.equal(f.maxProcessing,2);
 assert.equal(f.media.downloadConcurrency,4);f.media.setConcurrency(6);assert.equal(f.media.downloadConcurrency,6);
 for(const invalid of [0,3,8,NaN])assert.throws(()=>f.media.setConcurrency(invalid),{code:'INVALID_INPUT'});
});

test('四路任务未满但两个后台处理槽都忙时，当前播放仍抢占后台处理',async t=>{
 const f=await fixture(t,{concurrency:4,holdFirstTwo:true});f.media.setBackgroundGroups([{id:ids[11],ids:ids.slice(0,2),paused:false}]);
 await until(()=>f.encoded.length===2);const playback=await f.media.prepare(ids[9]);
 assert.equal(playback.episodeId,ids[9]);assert.equal(f.killed.length,1);assert.ok(f.maxProcessing<=2);
});

test('采用已经下载完但等待处理的后台分集时也抢占处理槽，且不重新下载',async t=>{
 const f=await fixture(t,{concurrency:4,holdFirstTwo:true});f.media.setBackgroundGroups([{id:ids[11],ids:ids.slice(0,4),paused:false}]);
 await until(()=>f.media.stateFor(ids.slice(0,4)).activities?.filter(a=>a.activity?.stage==='waiting').length===2);
 const waiting=f.media.stateFor(ids.slice(0,4)).activities!.find(a=>a.activity?.stage==='waiting')!.episodeId;
 let done=false;void f.media.prepare(waiting).then(()=>{done=true}).catch(()=>{});await until(()=>done);
 assert.equal(f.killed.length,1);assert.equal(f.fetched.filter(id=>id===waiting).length,1);assert.ok(f.maxProcessing<=2);
});

test('删除指定作品缓存释放文件和索引，保留其他作品与用户文件，重开不会复活',async t=>{
 const f=await fixture(t);const one=await f.media.prepare(ids[0]),two=await f.media.prepare(ids[1]);
 await writeFile(path.join(f.dir,'my-note.txt'),'keep');const before=f.media.usedBytes;
 const result=await f.media.deleteEpisodes([ids[0]]);assert.ok(result.freedBytes>0);assert.ok(f.media.usedBytes<before);
 assert.equal((await f.media.response(one.url,null)).status,404);assert.equal((await f.media.response(two.url,null)).status,200);
 assert.equal(await readFile(path.join(f.dir,'my-note.txt'),'utf8'),'keep');
 const files=await readdir(f.dir);assert.equal(files.filter(n=>n.endsWith('.json')).length,1);assert.equal(files.filter(n=>n.endsWith('.mp4')).length,1);
 await f.media.close();const {MediaCache}=await import('../src/main/media');const reopened=new MediaCache(f.dir,'fake',async()=>{throw Error('no lookup')});
 try{await reopened.init();assert.equal(reopened.stateFor([ids[0]]).ready,0);assert.equal(reopened.stateFor([ids[1]]).ready,1)}finally{await reopened.close()}
});

test('删除正在打开的作品被拒绝；后台删除会取消目标下载且不破坏其他作品',async t=>{
 const f=await fixture(t,{hold:ids[0],concurrency:2});
 f.media.setBufferWindow([ids[1]]);await f.media.prepare(ids[1]);
 await assert.rejects(f.media.deleteEpisodes([ids[1]]),{code:'CACHE_IN_USE'});
 f.media.setBufferWindow([]);f.media.setBackgroundGroups([{id:ids[10],ids:[ids[0]],paused:false},{id:ids[11],ids:[ids[2]],paused:false}]);
 await until(()=>f.fetched.includes(ids[0]));f.media.setBackgroundGroups([{id:ids[10],ids:[ids[0]],paused:true},{id:ids[11],ids:[ids[2]],paused:false}]);
 await f.media.deleteEpisodes([ids[0]]);await until(()=>f.media.stateFor([ids[2]]).ready===1);
 assert.ok(f.aborted.includes(ids[0]));assert.equal(f.media.stateFor([ids[1]]).ready,1);assert.equal(f.media.stateFor([ids[0]]).ready,0);
});

test('媒体或索引删除失败不误报成功，再次删除能清理残留索引',async t=>{
 const f=await fixture(t),playback=await f.media.prepare(ids[0]),key=new URL(playback.url).pathname.slice(1),metadata=path.join(f.dir,key+'.json');
 await rename(metadata,metadata+'.held');await mkdir(metadata);
 await assert.rejects(f.media.deleteEpisodes([ids[0]]),{code:'CACHE_DELETE'});assert.equal(f.media.stateFor([ids[0]]).ready,0);
 await assert.rejects(f.media.deleteEpisodes([ids[0]]),{code:'CACHE_DELETE'});
 await rm(metadata,{recursive:true});await rename(metadata+'.held',metadata);await f.media.deleteEpisodes([ids[0]]);assert.ok(!(await readdir(f.dir)).includes(key+'.json'));
});

test('当前集完成后顺序缓冲至第五集，第二集复用缓存并补第六集',async t=>{
 const f=await fixture(t);f.media.setBufferWindow(ids.slice(0,5));
 assert.equal(f.fetched.length,0,'buffer must not delay the initial episode');
 const first=await f.media.prepare(ids[0]);await until(()=>f.encoded.length===5);await f.media.prepare(ids[4]);
 await until(()=>f.fetched.length===5);await tick();
 assert.deepEqual(f.fetched,ids.slice(0,5));assert.equal(f.maxActive,1);
 f.media.setBufferWindow(ids.slice(1,6));const next=await f.media.prepare(ids[1]);
 assert.equal(next.episodeId,ids[1]);await until(()=>f.encoded.length===6);await tick();
 assert.deepEqual(f.fetched,ids.slice(0,6));assert.equal((await f.media.response(first.url,null)).status,200);
});

test('多作品最多两条任务并行，一部卡住时其他作品继续，离开详情页不取消后台队列',async t=>{
 const f=await fixture(t,{hold:ids[0],concurrency:2});
 f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:false},{id:ids[11],ids:ids.slice(3,6),paused:false}]);
 await until(()=>f.media.stateFor(ids.slice(3,6)).ready===3);
 assert.deepEqual(new Set(f.fetched.slice(0,2)),new Set([ids[0],ids[3]]));assert.equal(f.maxActive,2);
 f.media.setBufferWindow([]);assert.equal(f.aborted.length,0);
 f.release();await until(()=>f.media.stateFor(ids.slice(0,3)).ready===3);assert.equal(f.fetched.length,6);
});

test('暂停后台作品取消其未完成任务，已完成缓存保留，继续后补齐',async t=>{
 const f=await fixture(t,{hold:ids[1],concurrency:2});
 f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:false}]);
 // The assertion below is about retaining a completed episode, not one whose
 // HTTP request merely started before the pause.
 await until(()=>f.fetched.includes(ids[1])&&f.media.stateFor([ids[0]]).ready===1);
 f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:true}]);await tick();
 assert.ok(f.aborted.includes(ids[1]));assert.equal(f.media.stateFor(ids.slice(0,3)).activeId,undefined);
 const count=f.fetched.length;await tick();assert.equal(f.fetched.length,count);
 f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:false}]);await until(()=>f.fetched.length>count);f.release();
 await until(()=>f.media.stateFor(ids.slice(0,3)).ready===3);
 assert.equal(f.fetched.filter(id=>id===ids[0]).length,1);
});

test('离页保留后台失败状态，只有手动重试才再次请求失败集',async t=>{
 const f=await fixture(t,{fail:ids[0],concurrency:2});
 f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:false}]);
 await until(()=>f.media.stateFor(ids.slice(0,3)).failed===1&&f.media.stateFor(ids.slice(0,3)).ready===2);
 f.media.setBufferWindow([]);await tick();await tick();
 assert.equal(f.fetched.filter(id=>id===ids[0]).length,3);assert.equal(f.media.stateFor(ids.slice(0,3)).failed,1);
 f.recover();f.media.retryBuffer(ids.slice(0,3));await until(()=>f.media.stateFor(ids.slice(0,3)).ready===3);
 assert.equal(f.fetched.filter(id=>id===ids[0]).length,4);
});

test('当前剧提前缓存与后台队列轮转，新播放抢占通道且不重复已有任务',async t=>{
 const f=await fixture(t,{hold:ids[1],concurrency:2});
 f.media.setBufferWindow(ids.slice(0,6));await f.media.prepare(ids[0]);
 f.media.setBackgroundGroups([{id:ids[11],ids:ids.slice(7,10),paused:false}]);
 await until(()=>f.media.stateFor(ids.slice(7,10)).ready===3);
 assert.ok(!f.fetched.includes(ids[5])||f.fetched.indexOf(ids[7])<f.fetched.indexOf(ids[5]),'queued work must run before all temporary advance episodes finish');
 await f.media.prepare(ids[10]);assert.equal(f.fetched.filter(id=>id===ids[10]).length,1);
 f.release();await until(()=>f.media.stateFor(ids.slice(0,6)).ready===6);
 assert.ok(f.maxActive<=2);
});

test('两条后台通道均忙时当前播放抢占一条，另一部任务不被取消',async t=>{
 const f=await fixture(t,{hold:ids[3],holdEncode:1,concurrency:2});
 f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:false},{id:ids[11],ids:ids.slice(3,6),paused:false}]);
 await until(()=>f.encoded.length===1&&f.fetched.includes(ids[3]));
 const playback=await f.media.prepare(ids[9]);assert.equal(playback.episodeId,ids[9]);assert.equal(f.killed.length,1);assert.ok(!f.aborted.includes(ids[3]));
 assert.equal(f.fetched.filter(id=>id===ids[9]).length,1);assert.ok(f.maxActive<=2);
 f.release();await until(()=>f.media.stateFor(ids.slice(0,6)).ready===6);
});

test('当前集准备中加入后台队列，离页后原任务继续完成而非重新下载',async t=>{
 const f=await fixture(t,{hold:ids[0],concurrency:2});f.media.setBufferWindow([ids[0]]);const playback=f.media.prepare(ids[0]);
 await until(()=>f.fetched.includes(ids[0]));f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:false}]);
 f.media.setBufferWindow([]);await tick();assert.deepEqual(f.aborted,[]);
 f.release();await playback;await until(()=>f.media.stateFor(ids.slice(0,3)).ready===3);
 assert.equal(f.fetched.filter(id=>id===ids[0]).length,1);
});

test('抢占通道尚未释放就离页，未启动的前台任务仍可由后台队列补齐',async t=>{
 const f=await fixture(t,{hold:ids[3],holdEncode:1,concurrency:2});
 f.media.setBackgroundGroups([{id:ids[10],ids:ids.slice(0,3),paused:false},{id:ids[11],ids:ids.slice(3,6),paused:false}]);
 await until(()=>f.encoded.length===1&&f.fetched.includes(ids[3]));
 f.media.setBufferWindow([ids[1]]);void f.media.prepare(ids[1]).catch(()=>{});f.media.setBufferWindow([]);
 f.release();await until(()=>f.media.stateFor(ids.slice(0,6)).ready===6);
 assert.equal(f.fetched.filter(id=>id===ids[1]).length,1);
});

test('播放正在缓冲的同一集时接管任务，不重复下载',async t=>{
 const f=await fixture(t,{hold:ids[1]});f.media.setBufferWindow(ids.slice(0,5));await f.media.prepare(ids[0]);await until(()=>f.fetched.includes(ids[1]));
 f.media.setBufferWindow(ids.slice(1,6));const next=f.media.prepare(ids[1]);f.release();await next;
 assert.equal(f.fetched.filter(id=>id===ids[1]).length,1);assert.equal(f.aborted.length,0);
});

test('跳集取消过时缓冲，当前集优先，退出详情页停止后台下载',async t=>{
 const f=await fixture(t,{hold:ids[1]});f.media.setBufferWindow(ids.slice(0,5));await f.media.prepare(ids[0]);await until(()=>f.fetched.includes(ids[1]));
 f.media.setBufferWindow(ids.slice(7,12));await f.media.prepare(ids[7]);
 assert.deepEqual(f.aborted,[ids[1]]);assert.deepEqual(f.fetched.slice(0,3),[ids[0],ids[1],ids[7]]);
 f.media.setBufferWindow([]);await tick();const count=f.fetched.length;await tick();assert.equal(f.fetched.length,count);assert.equal(f.maxActive,1);
});

test('缓冲失败有限重试且不阻塞后续集，当前集可以手动重试',async t=>{
 const f=await fixture(t,{fail:ids[1]});f.media.setBufferWindow(ids.slice(0,5));await f.media.prepare(ids[0]);await until(()=>f.encoded.length===4);await tick();
 assert.equal(f.fetched.filter(id=>id===ids[1]).length,3);assert.ok(f.fetched.includes(ids[4]));
 await assert.rejects(f.media.prepare(ids[1]));assert.equal(f.fetched.filter(id=>id===ids[1]).length,6);
});

test('五集窗口不被磁盘淘汰，旧缓存清理使完整缓存不超过 1 GiB',async t=>{
 const f=await fixture(t,{large:true});f.media.setBufferWindow(ids.slice(0,5));const first=await f.media.prepare(ids[0]);await until(()=>f.encoded.length===5);await f.media.prepare(ids[4]);
 assert.equal((await f.media.response(first.url,'bytes=0-0')).status,206);
 for(const id of ids.slice(5,9))await f.media.prepare(id);
 const metadata=(await readdir(f.dir)).filter(name=>name.endsWith('.json'));
 assert.ok(metadata.length<=7,'140 MiB entries must fit within 1 GiB');
 const retained=await Promise.all(metadata.map(async name=>JSON.parse(await readFile(path.join(f.dir,name),'utf8')).episodeId));
 for(const id of ids.slice(0,5))assert.ok(retained.includes(id),`window episode ${id} must be retained`);
});

test('只接受有界的有效且不重复的剧集编号列表',async t=>{
 const f=await fixture(t);
 const tooMany=Array.from({length:5001},(_,i)=>String(7695386527160863700n+BigInt(i)));
 for(const value of [tooMany,['bad'],[ids[0],ids[0]],null])assert.throws(()=>f.media.setBufferWindow(value as any),{code:'INVALID_INPUT'});
});

test('缓存进度来自真实下载字节及处理时间，处理完成前不能计为已缓存',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'manju-progress-'));
 let resourceReady!:(value:any)=>void,stream!:ReadableStreamDefaultController<Uint8Array>;
 const resource=new Promise<any>(resolve=>{resourceReady=resolve});
 const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{queueMicrotask(()=>child.emit('close',null));return true}});
 let output='';
 t.mock.method(childProcess,'spawn',(_exe:string,args:readonly string[])=>{output=args.at(-1)!;return child});
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller}})));
 syncBuiltinESMExports();const {MediaCache}=await import('../src/main/media');
 const media=new MediaCache(dir,'fake-ffmpeg',()=>resource);
 t.after(async()=>{await media.close();t.mock.restoreAll();syncBuiltinESMExports();await rm(dir,{recursive:true,force:true})});
 await media.init();media.setBufferWindow([ids[0]]);const preparing=media.prepare(ids[0]);
 assert.deepEqual(media.bufferState().active,{stage:'resolving'});
 resourceReady({episodeId:ids[0],duration:1,definition:'1080p',codec:'h264',encrypted:false,url:'https://example.com/video',size:6});
 await until(()=>!!stream);stream.enqueue(Buffer.from('sou'));
 await until(()=>media.bufferState().active?.transferred===3);
 assert.deepEqual(media.bufferState().active,{stage:'downloading',transferred:3,total:6,percent:50});assert.equal(media.bufferState().ready,0);
 stream.enqueue(Buffer.from('rce'));stream.close();await until(()=>!!output);
 child.stdout.write('out_time_us=50');assert.equal(media.bufferState().active?.percent,0);
 child.stdout.write('0000\n');assert.deepEqual(media.bufferState().active,{stage:'processing',percent:50});
 child.stdout.write('out_time_us=1000000\n');assert.equal(media.bufferState().active?.percent,99);assert.equal(media.bufferState().ready,0);
 await writeFile(output,'prepared-video');child.emit('close',0);await preparing;
 assert.equal(media.bufferState().ready,1);assert.equal(media.bufferState().status,'complete');assert.equal(media.bufferState().active,undefined);
 media.setBufferWindow([]);assert.equal(media.bufferState().active,undefined);
});

test('打开首集后后台准备整部剧，超过五集也不中止，状态只有完整缓存才计数',async t=>{
 const f=await fixture(t,{hold:ids[8]});f.media.setBufferWindow(ids);
 assert.equal(f.media.bufferState().ready,0);await f.media.prepare(ids[0]);await until(()=>f.fetched.includes(ids[8]));
 assert.equal(f.media.bufferState().ready,8);assert.equal(f.media.bufferState().total,12);assert.equal(f.media.bufferState().activeId,ids[8]);
 f.release();await until(()=>f.encoded.length===12);await f.media.prepare(ids[11]);
 assert.deepEqual(f.fetched,ids);assert.equal(f.media.bufferState().status,'complete');assert.equal(f.media.bufferState().ready,12);assert.equal(f.maxActive,1);
});

test('从中间集打开时优先向后缓存，再补齐前面的集数，切换到已缓存集不重复下载',async t=>{
 const f=await fixture(t);const order=[...ids.slice(7),...ids.slice(0,7)];f.media.setBufferWindow(order);await f.media.prepare(ids[7]);
 await until(()=>f.encoded.length===12);await f.media.prepare(ids[6]);
 assert.deepEqual(f.fetched,order);f.media.setBufferWindow(ids);await f.media.prepare(ids[0]);await tick();assert.equal(f.fetched.length,12);
});

test('整剧缓存超过 1 GiB 仍全部保留，离页及重开不删除已完成的整剧',async t=>{
 const f=await fixture(t,{large:true});const full=ids.slice(0,9);f.media.setBufferWindow(full);const first=await f.media.prepare(ids[0]);
 await until(()=>f.encoded.length===9);await f.media.prepare(ids[8]);f.media.setBufferWindow([]);await f.media.close();
 assert.equal((await f.media.response(first.url,'bytes=0-0')).status,206);
 const {MediaCache}=await import('../src/main/media');
 const reopened=new MediaCache(f.dir,'fake-ffmpeg',async()=>{throw Error('must reuse full-series cache')});
 try{await reopened.init();reopened.setBufferWindow(full);assert.equal(reopened.bufferState().ready,9);for(const id of full)await reopened.prepare(id)}finally{await reopened.close()}
 assert.equal(f.fetched.length,9);
});

test('空间不足暂停后台而非逐集失败重试，现有缓存可播放，清理空间后手动恢复',async t=>{
 let free=3*1024**3;const f=await fixture(t,{freeBytes:async()=>free});
 // The current file completes; the next background task must see low space.
 f.media.setBufferWindow(ids);await f.media.prepare(ids[0]);free=0;
 await until(()=>f.media.bufferState().status==='paused');const count=f.fetched.length;await tick();assert.equal(f.fetched.length,count);
 assert.ok(f.media.bufferState().message.includes('空间'));await f.media.prepare(ids[0]);
 await assert.rejects(f.media.prepare(ids[10]),{code:'DISK_SPACE'});
 free=3*1024**3;f.media.retryBuffer();await until(()=>f.encoded.length===12);await f.media.prepare(ids[11]);assert.equal(f.media.bufferState().status,'complete');
});

test('缓存失败不误报全剧完成，点击重试后继续只准备失败集',async t=>{
 const f=await fixture(t,{fail:ids[5]});f.media.setBufferWindow(ids);await f.media.prepare(ids[0]);await until(()=>f.media.bufferState().status==='partial');
 assert.equal(f.media.bufferState().status,'partial');assert.equal(f.media.bufferState().failed,1);assert.equal(f.media.bufferState().ready,11);
 const count=f.fetched.length;f.recover();f.media.retryBuffer();await until(()=>f.media.bufferState().status==='complete');
 assert.equal(f.fetched.length,count+1);assert.equal(f.fetched.at(-1),ids[5]);
});

test('整剧准备期间跳到未缓存的当前集，抢占后台任务后继续补齐全剧',async t=>{
 const f=await fixture(t,{hold:ids[1]});f.media.setBufferWindow(ids);await f.media.prepare(ids[0]);await until(()=>f.fetched.includes(ids[1]));
 f.media.setBufferWindow([...ids.slice(7),...ids.slice(0,7)]);await f.media.prepare(ids[7]);
 assert.deepEqual(f.aborted,[ids[1]]);assert.deepEqual(f.fetched.slice(0,3),[ids[0],ids[1],ids[7]]);
 f.media.setBufferWindow([]);await tick();assert.equal(f.media.bufferState().status,'idle');
});

test('关闭应用取消后台任务且不重试、不启动后续集',async t=>{
 const f=await fixture(t,{hold:ids[1]});f.media.setBufferWindow(ids.slice(0,5));await f.media.prepare(ids[0]);await until(()=>f.fetched.includes(ids[1]));await f.media.close();
 assert.deepEqual(f.fetched,ids.slice(0,2));assert.deepEqual(f.aborted,[ids[1]]);assert.equal(f.encoded.length,1);
});

test('跳集终止正在后台转码的进程，取消的集不重试且清理临时文件',async t=>{
 const f=await fixture(t,{holdEncode:2});f.media.setBufferWindow(ids.slice(0,5));await f.media.prepare(ids[0]);await until(()=>f.encoded.length===2);
 f.media.setBufferWindow([ids[8]]);await f.media.prepare(ids[8]);
 assert.equal(f.killed.length,1);assert.deepEqual(f.fetched,[ids[0],ids[1],ids[8]]);
 assert.ok(!(await readdir(f.dir)).some(name=>/\.(input|working)\.mp4$/.test(name)));
});

test('重开后复用已完成的五集缓存，不重新请求视频资源',async t=>{
 const f=await fixture(t);f.media.setBufferWindow(ids.slice(0,5));await f.media.prepare(ids[0]);await until(()=>f.encoded.length===5);await f.media.prepare(ids[4]);await f.media.close();
 const {MediaCache}=await import('../src/main/media');
 const reopened=new MediaCache(f.dir,'fake-ffmpeg',async()=>{throw Error('unexpected resource lookup')});
 try{
  await reopened.init();reopened.setBufferWindow(ids.slice(0,5));
  for(const id of ids.slice(0,5))assert.equal((await reopened.prepare(id)).episodeId,id);
  assert.equal(f.fetched.length,5);
 }finally{await reopened.close()}
});

test('旧画质策略产生的缓存即使标注 1080p 也不复用，新缓存可以重开复用',async t=>{
 const f=await fixture(t);const oldKey='a'.repeat(32);
 await writeFile(path.join(f.dir,oldKey+'.mp4'),'old-low-quality');
 await writeFile(path.join(f.dir,oldKey+'.json'),JSON.stringify({key:oldKey,episodeId:ids[0],duration:1,definition:'1080p',touched:Date.now()}));
 await f.media.close();
 const {MediaCache}=await import('../src/main/media');let lookups=0;
 const updated=new MediaCache(f.dir,'fake-ffmpeg',async id=>{lookups++;return {episodeId:id,duration:1,definition:'1080p',codec:'h264',encrypted:false,url:`https://example.com/${id}`,size:6}});
 try{
  await updated.init();const playback=await updated.prepare(ids[0]);assert.equal(lookups,1);assert.notEqual(playback.url,`manju-media://local/${oldKey}`);
  assert.ok(!(await readdir(f.dir)).includes(oldKey+'.mp4'));
 }finally{await updated.close()}
});

test('缓存迁移校验并保留原文件，切换后旧播放地址可用，配置提交失败回滚',async t=>{
 const f=await fixture(t);const playback=await f.media.prepare(ids[0]);
 const target=await mkdtemp(path.join(tmpdir(),'manju-target-'));t.after(()=>rm(target,{recursive:true,force:true}));
 const next=path.join(target,'HongguoManjuCache');let committed=false;
 await f.media.relocate(next,async()=>{committed=true});assert.ok(committed);assert.equal(f.media.location,next);
 assert.equal((await f.media.response(playback.url,null)).status,200);assert.equal((await readdir(f.dir)).filter(n=>n.endsWith('.mp4')).length,1);
 const broken=path.join(target,'failed');await assert.rejects(f.media.relocate(broken,async()=>{throw Error('write-failed')}),{code:'CACHE_MOVE'});
 assert.equal(f.media.location,next);assert.equal((await f.media.response(playback.url,null)).status,200);assert.equal((await readdir(broken)).length,0);
 await assert.rejects(f.media.relocate(path.join(next,'nested'),async()=>{}),{code:'CACHE_PATH'});
});

test('兼容 H264 优先无损封装，封装失败回退兼容转码且只下载一次',async t=>{
 const f=await fixture(t,{failRemux:true});await f.media.prepare(ids[0]);assert.deepEqual(f.modes,['copy','libx264']);assert.equal(f.fetched.length,1);
});
