import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {Resource} from '../src/shared/types';

test('下载完成后开始退出不能再启动 FFmpeg，关闭等待中的准备必须取消',async t=>{
 let cache:import('../src/main/media').MediaCache,closing:Promise<void>|undefined;
 const directory=await fs.mkdtemp((await import('node:path')).join((await import('node:os')).tmpdir(),'manju-shutdown-'));
 const originalOpen=fs.open;
 const openMock=t.mock.method(fs,'open',async(file:any,flags:any,mode?:any)=>{const handle=await originalOpen(file,flags,mode);if(String(file).endsWith('.partial.mp4')){const close=handle.close.bind(handle);handle.close=async()=>{await close();closing=cache.close()}}return handle});
 const fetchMock=t.mock.method(globalThis,'fetch',async()=>new Response(Buffer.from('source')));
 const spawnMock=t.mock.method(childProcess,'spawn',()=>{throw Error('decoder must not start')});syncBuiltinESMExports();
 const {MediaCache}=await import('../src/main/media');cache=new MediaCache(directory,'unused-ffmpeg',async id=>({episodeId:id,duration:1,definition:'540p',codec:'h264',encrypted:false,url:'https://example.com/video',size:6}),{freeBytes:async()=>10*1024**3});
 try{await assert.rejects(cache.prepare('7695386527160863769'),{code:'CANCELLED'});assert.ok(closing);await closing;assert.equal(spawnMock.mock.callCount(),0);assert.equal(fetchMock.mock.callCount(),1)}finally{await cache.close();openMock.mock.restore();fetchMock.mock.restore();spawnMock.mock.restore();syncBuiltinESMExports();await fs.rm(directory,{recursive:true,force:true})}
});

test('退出期间才返回的资源不能开始下载',async t=>{
 let resolveResource!:(resource:Resource)=>void;
 const resource=new Promise<Resource>(resolve=>{resolveResource=resolve});
 const fetchMock=t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected download')});
 const unlinkMock=t.mock.method(fs,'unlink',async()=>{});syncBuiltinESMExports();
 const {MediaCache}=await import('../src/main/media');
 const cache=new MediaCache('unused-directory','unused-ffmpeg',()=>resource);
 try{
  const prepared=cache.prepare('7695386527160863769');
  const rejected=assert.rejects(prepared,{code:'CANCELLED'});const closing=cache.close();
  resolveResource({episodeId:'7695386527160863769',duration:1,definition:'540p',codec:'h264',encrypted:false,url:'https://example.com/video',size:6});
  await rejected;await closing;assert.equal(fetchMock.mock.callCount(),0);
 }finally{await cache.close();fetchMock.mock.restore();unlinkMock.mock.restore();syncBuiltinESMExports()}
});
