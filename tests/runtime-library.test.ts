import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {LibraryStore} from '../src/main/library';

const work={id:'7695370827507698713',title:'保留的作品',cover:'',description:'',total:155};
const progress={seriesId:work.id,episodeId:'7695386527160863769',order:1,time:12,duration:60,updatedAt:100,work};
async function fixture(run:(dir:string)=>Promise<void>){
 const dir=await mkdtemp(path.join(tmpdir(),'manju-recovery-'));
 try{await run(dir)}finally{await rm(dir,{recursive:true,force:true})}
}

test('坏收藏和坏历史条目不能清空其他有效记录',async()=>fixture(async dir=>{
 await writeFile(path.join(dir,'library.json'),JSON.stringify({favorites:[work,{id:'bad'}],history:[progress,null,{...progress,order:0},{...progress,work:{id:'bad'}}]}));
 const store=new LibraryStore(dir);await store.init();
 assert.deepEqual(store.snapshot(),{favorites:[{...work,categories:[]}],history:[{...progress,work:{...work,categories:[]}}]});
 await store.favorite({...work,id:'7692043430955863102'},true);
 const reopened=new LibraryStore(dir);await reopened.init();assert.equal(reopened.snapshot().history[0].time,12);assert.equal(reopened.snapshot().favorites.length,2);
}));

for(const damaged of ['{"favorites":[',JSON.stringify({favorites:{},history:[]})]){
 test(`完整损坏的库在允许新写入前备份：${damaged.startsWith('{"favorites":[')?'JSON':'结构'}`,async()=>fixture(async dir=>{
  const file=path.join(dir,'library.json');await writeFile(file,damaged);
  const store=new LibraryStore(dir);await store.init();
  const backups=(await readdir(dir)).filter(name=>name.startsWith('library.json.corrupt-'));
  assert.equal(backups.length,1);assert.equal(await readFile(path.join(dir,backups[0]),'utf8'),damaged);
  await store.favorite(work,true);assert.equal(JSON.parse(await readFile(file,'utf8')).favorites[0].id,work.id);
  assert.equal(await readFile(path.join(dir,backups[0]),'utf8'),damaged);
 }));
}

test('非 ENOENT 读取失败必须报错并禁止未初始化的库覆盖文件',async()=>fixture(async dir=>{
 await mkdir(path.join(dir,'library.json'));const store=new LibraryStore(dir);
 await assert.rejects(store.init(),{code:'LIBRARY_READ'});
 await assert.rejects(()=>store.favorite(work,true),{code:'LIBRARY_NOT_READY'});
 assert.deepEqual(await readdir(path.join(dir,'library.json')),[]);
}));

test('持久化失败不能改变内存或污染下一次成功的写入',async()=>fixture(async dir=>{
 const store=new LibraryStore(dir);await store.init();await store.favorite(work,true);
 const before=store.snapshot();await mkdir(path.join(dir,'library.json.tmp'));
 await assert.rejects(store.favorite(work,false));assert.deepEqual(store.snapshot(),before);
 await rm(path.join(dir,'library.json.tmp'),{recursive:true});
 await store.progress(progress);
 const reopened=new LibraryStore(dir);await reopened.init();assert.equal(reopened.snapshot().favorites[0].id,work.id);assert.equal(reopened.snapshot().history[0].time,12);
}));

test('旧签名进程的退出事件不能拒绝新进程中的重试请求',async t=>fixture(async dir=>{
 const children:Array<EventEmitter&{stdin:PassThrough;stdout:PassThrough;stderr:PassThrough;kill:()=>boolean}>=[];
 const spawnMock=t.mock.method(childProcess,'spawn',()=>{
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});children.push(child);return child;
 });
 syncBuiltinESMExports();
 const {Signer}=await import('../src/main/transport');const signer=new Signer('unused-runtime',dir);
 try{
  const first=signer.sign('https://example.com',{});const cancelled=assert.rejects(first,{code:'CANCELLED'});signer.close();await cancelled;
  const retry=signer.sign('https://example.com',{});const settled=retry.then(value=>({value}),error=>({error}));
  children[0].emit('close',0);
  const request=JSON.parse(children[1].stdin.read().toString());
  children[1].stdout.write(JSON.stringify({seq:request.seq,headers:{'X-Argus':'test-value','X-Gorgon':'test-value'}})+'\n');
  const result=await settled;assert.ok('value' in result,'the live worker must complete the retry');
  const [,args,options]=spawnMock.mock.calls[1].arguments;
  assert.ok(options);assert.equal(options.cwd,dir);
  assert.ok(args);assert.ok(args.includes(`-Djava.io.tmpdir=${dir}`));
 }finally{signer.close();spawnMock.mock.restore();syncBuiltinESMExports()}
}));

test('更新关闭必须等到所有签名子进程实际退出，并拒绝迟到请求',async t=>fixture(async dir=>{
 const children:Array<EventEmitter&{stdin:PassThrough;stdout:PassThrough;stderr:PassThrough;kill:()=>boolean}>=[];
 const mock=t.mock.method(childProcess,'spawn',()=>{const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});children.push(child);return child});syncBuiltinESMExports();
 const {Signer}=await import('../src/main/transport');const signer=new Signer('unused-runtime',dir);
 try{
  assert.equal(typeof signer.shutdown,'function','terminal shutdown must be implemented');
  const first=assert.rejects(signer.sign('https://example.com',{}),{code:'CANCELLED'});signer.close();await first;
  const retry=assert.rejects(signer.sign('https://example.com',{}),{code:'CANCELLED'});
  let finished=false;const shutdown=signer.shutdown().then(()=>{finished=true});await retry;
  assert.throws(()=>signer.sign('https://example.com',{}),{code:'CANCELLED'});assert.equal(children.length,2);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'kill is not proof of exit');
  children[1].emit('close',0);await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'also wait for the previously closed worker');
  children[0].emit('close',0);await shutdown;assert.equal(finished,true);
 }finally{children.forEach(child=>child.emit('close',0));signer.close();mock.mock.restore();syncBuiltinESMExports()}
}));

test('签名进程无法结束时，关闭明确失败，不能开始覆盖安装',async t=>fixture(async dir=>{
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>false});
 const mock=t.mock.method(childProcess,'spawn',()=>child);syncBuiltinESMExports();
 const {Signer}=await import('../src/main/transport');const signer=new Signer('unused-runtime',dir);
 try{
  assert.equal(typeof signer.shutdown,'function','terminal shutdown must be implemented');
  const request=assert.rejects(signer.sign('https://example.com',{}),{code:'CANCELLED'});
  await assert.rejects(signer.shutdown(20),{code:'SIGN_SHUTDOWN'});await request;
  assert.throws(()=>signer.sign('https://example.com',{}),{code:'CANCELLED'});
 }finally{child.emit('close',0);signer.close();mock.mock.restore();syncBuiltinESMExports()}
}));
