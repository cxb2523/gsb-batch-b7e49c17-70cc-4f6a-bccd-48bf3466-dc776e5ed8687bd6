import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('强制重新取得同一集时生成新缓存地址，不能覆盖播放器仍可能占用的文件',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'manju-refresh-'));
 const spawnMock=t.mock.method(childProcess,'spawn',(_exe:string,args:readonly string[])=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  queueMicrotask(async()=>{await writeFile(args!.at(-1)!,Buffer.from('prepared-video'));child.stdout.write('out_time_us=1000000\n');child.emit('close',0)});
  return child;
 });
 const fetchMock=t.mock.method(globalThis,'fetch',async()=>new Response(Buffer.from('source')));
 syncBuiltinESMExports();
 const {MediaCache}=await import('../src/main/media');
 const media=new MediaCache(dir,'fake-ffmpeg',async id=>({episodeId:id,duration:1,definition:'540p',codec:'h264',encrypted:false,url:'https://example.com/video',size:6}));
 try{
  await media.init();const original=await media.prepare('7695386527160863769');const fresh=await media.prepare('7695386527160863769',true);
  assert.notEqual(fresh.url,original.url);assert.equal(fresh.episodeId,original.episodeId);
  const response=await media.response(fresh.url,'bytes=0-3');assert.equal(response.status,206);assert.equal(await response.text(),'prep');
 }finally{await media.close();spawnMock.mock.restore();fetchMock.mock.restore();syncBuiltinESMExports();await rm(dir,{recursive:true,force:true})}
});
