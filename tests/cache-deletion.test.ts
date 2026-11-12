import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile,readdir,stat} from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MediaCache} from '../src/main/media';
import {CacheManager} from '../src/main/cache-manager';

const ids=['7695386527160863700','7695386527160863701','7695386527160863702'];
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(check:()=>boolean|Promise<boolean>){for(let i=0;i<300;i++){if(await check())return true;await tick()}assert.fail('timed out waiting for cache operation')}
const series=(id:string)=>({id,title:'删除流程测试',cover:'',description:'',total:3,episodes:ids.slice(0,3).map((episodeId,index)=>({id:episodeId,order:index+1}))});
async function exists(file:string){return !!(await stat(file).catch(()=>null))}

async function fixture(t:any,options:{hold?:string;holdEncode?:number;concurrency?:number}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'manju-cache-delete-'));
 const fetched:string[]=[],aborted:string[]=[],killed:string[]=[],encoded:string[]=[];
 let holdReleased=false,releaseHold:(()=>void)|undefined;
 const spawnMock=t.mock.method(childProcess,'spawn',(_exe:string,args:readonly string[])=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{killed.push(args[args.indexOf('-i')+1]);queueMicrotask(()=>child.emit('close',null));return true}});
  encoded.push(args[args.indexOf('-i')+1]);
  if(options.holdEncode===encoded.length)return child;
  queueMicrotask(async()=>{await writeFile(args.at(-1)!, 'prepared-video');child.stdout.write('out_time_us=1000000\n');child.emit('close',0)});
  return child;
 });
 const fetchMock=t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
  const id=new URL(url).pathname.slice(1);fetched.push(id);
  if(id===options.hold&&!holdReleased)await new Promise<void>((resolve,reject)=>{
   releaseHold=resolve;
   init?.signal?.addEventListener('abort',()=>{aborted.push(id);reject(init?.signal?.reason)},{once:true});
  });
  return new Response(Buffer.from('source'));
 });
 syncBuiltinESMExports();
 const media=new MediaCache(dir,'fake-ffmpeg',async episodeId=>({episodeId,duration:1,definition:'540p',codec:'h264',encrypted:false,url:`https://example.com/${episodeId}`,size:6}),{freeBytes:async()=>10*1024**3,concurrency:options.concurrency??2,progressive:false});
 await media.init();
 const cache=new CacheManager(dir,media);
 await cache.init();
 t.after(async()=>{await media.close();t.mock.restoreAll();syncBuiltinESMExports();await rm(dir,{recursive:true,force:true})});
 return {media,cache,dir,fetched,aborted,killed,encoded,release:()=>{holdReleased=true;releaseHold?.()}};
}

test('正常批量删除只移除目标分集，释放字节与残留文件同步下降',async t=>{
 const f=await fixture(t);
 const results=await Promise.all(ids.map(id=>f.media.prepare(id)));
 const urls=new Map(results.map(result=>[result.episodeId,result.url]));
 const keys=new Map(results.map(result=>[result.episodeId,new URL(result.url).pathname.slice(1)]));
 await writeFile(path.join(f.dir,'my-note.txt'),'keep');
 assert.equal(f.media.stateFor(ids).ready,3);
 const before=f.media.usedBytes;assert.ok(before>0);
 const result=await f.media.deleteEpisodes(ids.slice(0,2));
 assert.ok(result.freedBytes>0);
 assert.equal(f.media.stateFor(ids.slice(0,2)).ready,0);
 assert.equal(f.media.stateFor([ids[2]]).ready,1);
 assert.equal(f.media.usedBytes,before-result.freedBytes);
 assert.equal(f.media.usedBytes,(await stat(path.join(f.dir,keys.get(ids[2])!+'.mp4'))).size);
 assert.equal((await f.media.response(urls.get(ids[0])!,null)).status,404);
 assert.equal((await f.media.response(urls.get(ids[1])!,null)).status,404);
 assert.equal((await f.media.response(urls.get(ids[2])!,null)).status,200);
 const files=await readdir(f.dir);
 assert.equal(files.filter(name=>name.endsWith('.mp4')).length,1);
 assert.equal(files.filter(name=>name.endsWith('.json')).length,1);
 assert.equal(await exists(path.join(f.dir,'my-note.txt')),true);
});

test('批量中任一集仍在播放窗口时整体拒绝，且不取消其他任务、不删除任何文件',async t=>{
 const f=await fixture(t,{hold:ids[0]});
 await f.media.prepare(ids[1]);await f.media.prepare(ids[2]);
 f.media.setBackgroundGroups([{id:'12345678',ids:[ids[0]],paused:false}]);
 await until(()=>f.fetched.includes(ids[0]));
 const filesBefore=await readdir(f.dir);
 f.media.setBufferWindow([ids[1]]);
 const before=f.media.usedBytes,readyBefore=f.media.stateFor(ids).ready;
 await assert.rejects(f.media.deleteEpisodes(ids),{code:'CACHE_IN_USE'});
 assert.equal(f.aborted.length,0,'rejection must happen before cancelling cache work');
 assert.equal(f.media.usedBytes,before);
 assert.equal(f.media.stateFor(ids).ready,readyBefore);
 assert.deepEqual(await readdir(f.dir),filesBefore);
});

test('删除正在下载的分集先取消并等待任务结束，再移除文件',async t=>{
 const f=await fixture(t,{hold:ids[0]});
 f.media.setBackgroundGroups([{id:'12345678',ids:[ids[0]],paused:false}]);
 await until(()=>f.fetched.includes(ids[0]));
 const deletion=f.media.deleteEpisodes([ids[0]]);
 await deletion;
 assert.deepEqual(f.aborted,[ids[0]]);
 assert.equal(f.media.stateFor([ids[0]]).ready,0);
 assert.equal(f.media.stateFor([ids[0]]).activeId,undefined);
 const fetched=f.fetched.length;await tick();await tick();
 assert.equal(f.fetched.length,fetched,'an active background queue must not restart a deleted episode');
 assert.equal((await readdir(f.dir)).filter(name=>name.endsWith('.mp4')).length,0);
});

test('删除正在处理的分集先终止处理进程并等待临时文件清理',async t=>{
 const f=await fixture(t,{holdEncode:1});
 f.media.setBackgroundGroups([{id:'12345678',ids:[ids[0]],paused:false}]);
 await until(()=>f.encoded.length===1);
 assert.equal(f.killed.length,0);
 await f.media.deleteEpisodes([ids[0]]);
 assert.equal(f.killed.length,1);
 assert.equal(f.media.stateFor([ids[0]]).ready,0);
 assert.equal((await readdir(f.dir)).filter(name=>name.endsWith('.mp4')).length,0);
});

test('单个文件被占用时保留其余删除结果并报告失败，恢复后重试只清理残留',async t=>{
 const f=await fixture(t);
 const results=await Promise.all(ids.map(id=>f.media.prepare(id)));
 const keys=new Map(results.map(result=>[result.episodeId,new URL(result.url).pathname.slice(1)]));
 const heldFile=path.join(f.dir,keys.get(ids[0])!+'.mp4');
 const original=fsPromises.unlink;let held=true;
 t.mock.method(fsPromises,'unlink',async(file:any)=>{
  if(held&&String(file)===heldFile){held=false;throw Object.assign(Error('locked'),{code:'EPERM'})}
  return original(file);
 });
 syncBuiltinESMExports();
 const before=f.media.usedBytes;
 await assert.rejects(f.media.deleteEpisodes(ids),{code:'CACHE_DELETE'});
 assert.equal(f.media.stateFor([ids[0]]).ready,1,'locked episode must remain');
 assert.equal(f.media.stateFor(ids.slice(1)).ready,0,'other episodes must stay deleted');
 assert.equal(f.media.usedBytes<before,true);
 assert.equal(f.media.usedBytes,(await stat(heldFile)).size);
 assert.equal((await readdir(f.dir)).filter(name=>name.endsWith('.mp4')).length,1);
 const retry=await f.media.deleteEpisodes(ids);
 assert.ok(retry.freedBytes>0);
 assert.equal(f.media.stateFor(ids).ready,0);
 assert.equal(f.media.usedBytes,0);
 const files=await readdir(f.dir);assert.equal(files.filter(name=>name.endsWith('.mp4')).length,0);assert.equal(files.filter(name=>name.endsWith('.json')).length,0);
 const third=await f.media.deleteEpisodes(ids);
 assert.equal(third.freedBytes,0,'already deleted entries must not be counted again');
 assert.equal(f.media.usedBytes,0);
});

test('索引文件删除失败记录待清理标记，重试成功后清除且不复活已删媒体',async t=>{
 const f=await fixture(t);
 const playback=await f.media.prepare(ids[0]),key=new URL(playback.url).pathname.slice(1),metadata=path.join(f.dir,key+'.json');
 const original=fsPromises.unlink;let held=true;
 t.mock.method(fsPromises,'unlink',async(file:any)=>{
  if(held&&String(file)===metadata){held=false;throw Object.assign(Error('locked'),{code:'EPERM'})}
  return original(file);
 });
 syncBuiltinESMExports();
 await assert.rejects(f.media.deleteEpisodes([ids[0]]),{code:'CACHE_DELETE'});
 assert.equal(f.media.stateFor([ids[0]]).ready,0,'media file was already removed');
 assert.equal(f.media.hasDeletionPending([ids[0]]),true);
 assert.equal(await exists(metadata),true);
 await f.media.deleteEpisodes([ids[0]]);
 assert.equal(f.media.hasDeletionPending([ids[0]]),false);
 assert.equal(await exists(metadata),false);
 assert.equal(f.media.usedBytes,0);
});

test('缓存中心删除任务：批量文件、队列与占用字节一并更新',async t=>{
 const f=await fixture(t),work=series('12345678');
 await f.cache.add(work);
 await until(()=>f.media.stateFor(ids).ready===3);
 const before=f.media.usedBytes;assert.ok(before>0);
 const snapshot=await f.cache.action(work.id,'delete');
 assert.equal(snapshot.tasks.length,0);
 assert.equal(f.media.usedBytes,0);
 assert.ok(snapshot.message.includes('已删除'));
 assert.equal((await readdir(f.dir)).filter(name=>name.endsWith('.mp4')).length,0);
 assert.equal((await readdir(f.dir)).filter(name=>/^[a-f0-9]{32}\.json$/.test(name)).length,0);
});

test('缓存中心删除与播放窗口冲突时整体拒绝且不改变任务状态',async t=>{
 const f=await fixture(t),work=series('12345678');
 await f.cache.add(work);
 await until(()=>f.media.stateFor(ids).ready===3);
 f.media.setBufferWindow([ids[1]]);
 const before=f.media.usedBytes;
 await assert.rejects(f.cache.action(work.id,'delete'),{code:'CACHE_IN_USE'});
 const snapshot=await f.cache.snapshot();
 assert.equal(snapshot.tasks.length,1);
 assert.equal(snapshot.tasks[0].paused,false,'a rejected delete must not pause the task');
 assert.equal(f.media.usedBytes,before);
 assert.equal(f.media.stateFor(ids).ready,3);
 f.media.setBufferWindow([]);
 await f.cache.action(work.id,'delete');
 assert.equal((await f.cache.snapshot()).tasks.length,0);
 assert.equal(f.media.usedBytes,0);
});

test('缓存中心删除正在下载的任务：先取消再等结束，任务和文件一起消失',async t=>{
 const f=await fixture(t,{hold:ids[0]}),work=series('12345678');
 await f.cache.add(work);
 await until(()=>f.fetched.includes(ids[0]));
 await until(()=>f.media.stateFor(ids).ready>=1);
 await f.cache.action(work.id,'delete');
 assert.ok(f.aborted.includes(ids[0]));
 assert.equal((await f.cache.snapshot()).tasks.length,0);
 assert.equal(f.media.usedBytes,0);
 assert.equal((await readdir(f.dir)).filter(name=>name.endsWith('.mp4')).length,0);
});
