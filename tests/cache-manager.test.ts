import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {CacheManager} from '../src/main/cache-manager';
const series=(id:string)=>({id,title:'缓存作品'+id,cover:'',description:'',total:2,episodes:[{id:id+'01',order:1},{id:id+'02',order:2}]});
async function fixture(t:any){const dir=await mkdtemp(path.join(tmpdir(),'manju-queue-'));t.after(()=>rm(dir,{recursive:true,force:true}));let groups:any[]=[],limits:any;const removed:string[][]=[];const media={location:path.join(dir,'media-cache'),usedBytes:10,downloadConcurrency:4,downloadBytesPerSecond:0,setConcurrency(value:number){this.downloadConcurrency=value},setLimits(value:any){limits=value},deleteEpisodes:async(ids:string[])=>{removed.push(ids);return {freedBytes:10}},setBackgroundGroups:(value:any)=>{groups=value},stateFor:(ids:string[])=>({status:'preparing',total:ids.length,ready:0,failed:0,message:''}),freeBytes:async()=>5*1024**3,retryBuffer:()=>{}};return {dir,media,removed,get groups(){return groups},get limits(){return limits}}}

test('旧版设置恢复默认总额度和普通优先级，不会被当成损坏文件',async t=>{
 const f=await fixture(t),work=series('12345678');
 await writeFile(path.join(f.dir,'cache-settings.json'),JSON.stringify({version:1,directory:f.media.location,closeToTray:false,tasks:[{series:work,paused:true,createdAt:1}]}));
 const manager=new CacheManager(f.dir,f.media as any);await manager.init();const snapshot=await manager.snapshot();
 assert.deepEqual(snapshot.limits,{maxGiB:20,bandwidthMiB:0});assert.equal(snapshot.tasks[0].priority,'normal');assert.equal(snapshot.closeToTray,false);assert.equal(snapshot.message,'');
 assert.deepEqual(f.limits,{maxBytes:20*1024**3,bytesPerSecond:0});assert.equal(f.groups[0].priority,'normal');
});

test('总额度和总限速支持小数及无限制，原子持久化后传递字节单位并重启恢复',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any);await manager.init();assert.deepEqual((await manager.snapshot()).limits,{maxGiB:20,bandwidthMiB:0});
 await manager.setLimits({maxGiB:12.5,bandwidthMiB:2.5});assert.deepEqual(f.limits,{maxBytes:12.5*1024**3,bytesPerSecond:2.5*1024**2});
 const saved=JSON.parse(await readFile(path.join(f.dir,'cache-settings.json'),'utf8'));assert.deepEqual(saved.limits,{maxGiB:12.5,bandwidthMiB:2.5});
 const reopened=new CacheManager(f.dir,f.media as any);await reopened.init();assert.deepEqual((await reopened.snapshot()).limits,saved.limits);
 await reopened.setLimits({maxGiB:0,bandwidthMiB:0});assert.deepEqual(f.limits,{maxBytes:0,bytesPerSecond:0});
 await reopened.setLimits({maxGiB:1e-12,bandwidthMiB:1e-12});assert.deepEqual(f.limits,{maxBytes:1,bytesPerSecond:1});
});

test('非法额度不写入设置，保存失败也不改变媒体限制',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any);await manager.init();await manager.setLimits({maxGiB:10,bandwidthMiB:5});
 const before=await readFile(path.join(f.dir,'cache-settings.json'),'utf8');
 for(const invalid of [null,{}, {maxGiB:NaN,bandwidthMiB:0},{maxGiB:Infinity,bandwidthMiB:0},{maxGiB:-1,bandwidthMiB:0},{maxGiB:10001,bandwidthMiB:0},{maxGiB:20,bandwidthMiB:-1},{maxGiB:20,bandwidthMiB:1001},{maxGiB:20,bandwidthMiB:'5'}])await assert.rejects(async()=>manager.setLimits(invalid as any),{code:'INVALID_INPUT'});
 assert.equal(await readFile(path.join(f.dir,'cache-settings.json'),'utf8'),before);
 await mkdir(path.join(f.dir,'cache-settings.json.tmp'));await assert.rejects(manager.setLimits({maxGiB:1,bandwidthMiB:1}),{code:'CACHE_SETTINGS'});
 assert.deepEqual((await manager.snapshot()).limits,{maxGiB:10,bandwidthMiB:5});assert.deepEqual(f.limits,{maxBytes:10*1024**3,bytesPerSecond:5*1024**2});
});

test('优先级保存后调度，重复添加及暂停恢复均保留；本地清单不能被优先级操作升级',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any),work=series('12345678'),local=series('23456789');await manager.init();await manager.add(work);await manager.remember(local);
 await manager.setPriority(work.id,'high');await manager.add(work);await manager.action(work.id,'pause');await manager.action(work.id,'resume');assert.equal(f.groups[0].priority,'high');
 const reopened=new CacheManager(f.dir,f.media as any);await reopened.init();assert.equal((await reopened.snapshot()).tasks[0].priority,'high');
 const before=await readFile(path.join(f.dir,'cache-settings.json'),'utf8');await assert.rejects(reopened.setPriority(local.id,'low'),{code:'CACHE_TASK'});await assert.rejects(reopened.setPriority(work.id,'urgent' as any),{code:'INVALID_INPUT'});assert.equal(await readFile(path.join(f.dir,'cache-settings.json'),'utf8'),before);assert.equal(f.groups.length,1);
 await mkdir(path.join(f.dir,'cache-settings.json.tmp'));await assert.rejects(reopened.setPriority(work.id,'low'),{code:'CACHE_SETTINGS'});assert.equal(f.groups[0].priority,'high');
});

test('直接添加的后台任务移除后保留只读清理入口，不丢失作品索引',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any),work=series('12345678');f.media.stateFor=ids=>({status:'complete',total:ids.length,ready:ids.length,failed:0,message:''});await manager.init();await manager.add(work);await manager.action(work.id,'remove');const snapshot=await manager.snapshot();assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.tasks[0].registered,false);assert.equal(f.groups.length,0);await manager.action(work.id,'delete');assert.equal((await manager.snapshot()).tasks.length,0);
});

test('仅有断点或其他画质文件的作品也保留只读清理入口',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any),work=series('12345678');(f.media as any).stateFor=(ids:string[])=>({status:'idle',total:ids.length,ready:0,failed:0,message:'',cachedBytes:100});await manager.init();await manager.remember(work);const snapshot=await manager.snapshot();assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.tasks[0].registered,false);assert.equal(snapshot.tasks[0].state.cachedBytes,100);assert.equal(f.groups.length,0);
});

test('缓存并行数默认四路，调整后原子保存并重启恢复，非法值被拒绝',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any);await manager.init();assert.equal((await manager.snapshot()).concurrency,4);
 await manager.setConcurrency(6);const reopened=new CacheManager(f.dir,f.media as any);await reopened.init();assert.equal((await reopened.snapshot()).concurrency,6);
 await assert.rejects(manager.setConcurrency(100),{code:'INVALID_INPUT'});
 await mkdir(path.join(f.dir,'cache-settings.json.tmp'));await assert.rejects(manager.setConcurrency(2),{code:'CACHE_SETTINGS'});assert.equal(f.media.downloadConcurrency,6);
});

test('删除缓存移除持久队列且只删除专有分集，末集看完可一键清理而不清理未看完作品',async t=>{
 const f=await fixture(t),work=series('12345678'),other=series('23456789');
 const history=[{seriesId:work.id,episodeId:work.episodes[1].id,order:2,time:99,duration:100,updatedAt:Date.now(),work}];
 const manager=new CacheManager(f.dir,f.media as any,()=>history);await manager.init();await manager.add(work);await manager.add(other);
 assert.equal((await manager.snapshot()).tasks[0].watched,true);assert.equal((await manager.snapshot()).tasks[1].watched,false);
 await manager.deleteWatched();assert.deepEqual(f.removed,[work.episodes.map(e=>e.id)]);assert.equal((await manager.snapshot()).tasks.length,1);
 const reopened=new CacheManager(f.dir,f.media as any);await reopened.init();assert.deepEqual((await reopened.snapshot()).tasks.map(t=>t.series.id),[other.id]);
});

test('删除文件失败保留已暂停任务供重试；不会删除收藏或记录文件',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any);await manager.init();await manager.add(series('12345678'));
 f.media.deleteEpisodes=async()=>{throw Error('locked')};await assert.rejects(manager.action('12345678','delete'));
 assert.equal((await manager.snapshot()).tasks.length,1);assert.equal((await manager.snapshot()).tasks[0].paused,true);assert.equal(f.groups[0].paused,true);
});

test('普通播放的只读缓存清单可清理，登记清单不启动后台下载，状态只读取一次历史',async t=>{
 const f=await fixture(t),work=series('12345678');let copies=0;
 f.media.stateFor=ids=>({status:'complete',total:ids.length,ready:ids.length,failed:0,message:''});
 const manager=new CacheManager(f.dir,f.media as any,()=>{copies++;return [{seriesId:work.id,episodeId:work.episodes[1].id,order:2,time:99,duration:100,updatedAt:1,work}]});await manager.init();await manager.remember(work);
 assert.equal(f.groups.length,0);copies=0;const snapshot=await manager.snapshot();assert.equal(copies,1);assert.equal(snapshot.tasks[0].registered,false);assert.equal(snapshot.tasks[0].watched,true);
 await manager.deleteWatched();assert.equal((await manager.snapshot()).tasks.length,0);assert.deepEqual(f.removed,[work.episodes.map(e=>e.id)]);
});

test('后台队列已满仍可删除本地清单作品，加入任务不可写入超限设置',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any);await manager.init();
 for(let i=0;i<100;i++)await manager.add(series(String(12345678+i)));
 const local=series('33333333');await manager.remember(local);
 await assert.rejects(manager.action(local.id,'resume'),{code:'CACHE_LIMIT'});assert.equal(JSON.parse(await readFile(path.join(f.dir,'cache-settings.json'),'utf8')).tasks.length,100);
 await manager.action(local.id,'delete');assert.equal(JSON.parse(await readFile(path.join(f.dir,'cache-settings.json'),'utf8')).tasks.length,100);
 const reopened=new CacheManager(f.dir,f.media as any);await reopened.init();assert.equal((await reopened.snapshot()).tasks.length,100);assert.ok(!(await reopened.snapshot()).message.includes('损坏'));
});
test('作品队列原子保存，重复添加不产生副本，暂停和重启保留，移除不删除媒体',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any);await manager.init();await manager.add(series('12345678'));await manager.add(series('23456789'));await manager.add(series('12345678'));
 assert.equal((await manager.snapshot()).tasks.length,2);await manager.action('12345678','pause');assert.equal(f.groups.find(g=>g.id==='12345678').paused,true);
 const reopened=new CacheManager(f.dir,f.media as any);await reopened.init();assert.equal((await reopened.snapshot()).tasks.find(task=>task.series.id==='12345678')?.paused,true);
 await reopened.action('12345678','resume');assert.equal(f.groups.find(g=>g.id==='12345678').paused,false);await reopened.action('12345678','remove');assert.equal((await reopened.snapshot()).tasks.length,1);
 assert.ok(!(await readFile(path.join(f.dir,'cache-settings.json'),'utf8')).includes('spade'));
});
test('损坏队列不能静默覆盖，非法作品不能进入缓存队列',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.dir,'cache-settings.json'),'bad-json');const manager=new CacheManager(f.dir,f.media as any);await manager.init();assert.ok((await manager.snapshot()).message.includes('损坏'));
 const invalid={...series('12345678'),episodes:[{id:'bad',order:1}]};await assert.rejects(async()=>manager.add(invalid));assert.equal((await manager.snapshot()).tasks.length,0);
});

test('队列写入失败不改变内存、调度或其他已保存任务',async t=>{
 const f=await fixture(t),manager=new CacheManager(f.dir,f.media as any);await manager.init();await manager.add(series('12345678'));
 await mkdir(path.join(f.dir,'cache-settings.json.tmp'));
 await assert.rejects(manager.add(series('23456789')),{code:'CACHE_SETTINGS'});await assert.rejects(manager.action('12345678','pause'),{code:'CACHE_SETTINGS'});
 assert.equal((await manager.snapshot()).tasks.length,1);assert.equal(f.groups.length,1);assert.equal(f.groups[0].paused,false);
 await rm(path.join(f.dir,'cache-settings.json.tmp'),{recursive:true});await manager.add(series('34567890'));
 const reopened=new CacheManager(f.dir,f.media as any);await reopened.init();assert.deepEqual((await reopened.snapshot()).tasks.map(t=>t.series.id),['12345678','34567890']);
});
