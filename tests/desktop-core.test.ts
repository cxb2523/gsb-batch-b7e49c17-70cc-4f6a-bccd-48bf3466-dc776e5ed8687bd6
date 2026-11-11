import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {LibraryStore} from '../src/main/library';
import {parseRange,decodeContentKey} from '../src/main/media';
import {safeJson} from '../src/main/json';
const work={id:'7695370827507698713',title:'测试作品',cover:'https://example.com/cover.jpg',description:'介绍',total:155};

test('原生响应的19位编号保留精度，文字和普通数值保持原样',()=>{
 const parsed=safeJson('{"id":7695370827507698713,"code":0,"duration":60.034,"note":"id 7695370827507698713 \\"ok\\""}');
 assert.equal(parsed.id,'7695370827507698713');assert.equal(parsed.code,0);assert.equal(parsed.duration,60.034);assert.equal(parsed.note,'id 7695370827507698713 "ok"');
});
test('同时保存收藏和观看进度后重开仍保留，拒绝非同集的非法时间',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'manju-library-'));
 try{const store=new LibraryStore(dir);await store.init();await Promise.all([store.favorite(work,true),store.progress({seriesId:work.id,episodeId:'7695386527160863769',order:1,time:12.5,duration:60,work})]);
 const fresh=new LibraryStore(dir);await fresh.init();const state=fresh.snapshot();assert.equal(state.favorites[0].id,work.id);assert.equal(state.history[0].time,12.5);
 await assert.rejects(()=>store.progress({seriesId:work.id,episodeId:'7695386527160863769',order:1,time:Infinity,duration:60,work}));
 const saved=await readFile(path.join(dir,'library.json'),'utf8');assert.doesNotMatch(saved,/spade|x-argus|main_url/i);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Range 支持前段/后段/开放末尾，非法及超界请求必须拒绝',()=>{
 assert.deepEqual(parseRange('bytes=0-9',100),{start:0,end:9,status:206});assert.deepEqual(parseRange('bytes=90-',100),{start:90,end:99,status:206});assert.deepEqual(parseRange('bytes=-5',100),{start:95,end:99,status:206});
 assert.deepEqual(parseRange(null,100),{start:0,end:99,status:200});for(const r of ['bytes=100-','bytes=10-5','bytes=1-2,4-5','garbage'])assert.equal(parseRange(r,100),null);
});
test('无法识别的密钥格式不能送给媒体解码器或误当成明文',()=>{
 for(const v of ['', '%%%',Buffer.from([0,0,0]).toString('base64')])assert.throws(()=>decodeContentKey(v));
});
