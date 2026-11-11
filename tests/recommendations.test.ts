import test from 'node:test';
import assert from 'node:assert/strict';
import {RecommendationService} from '../src/main/recommendations';
import type {Work,Series,Catalog} from '../src/shared/types';
const work=(n:number,title:string,description='',categories?:string[]):Work=>({id:String(10000000+n),title,description,categories,cover:'',total:10});
const current:Series={...work(1,'末世求生第二季'),episodes:[]};
const catalog=(items:Work[],hasMore=false):Catalog=>({items,hasMore,nextOffset:10,label:'',source:''});
test('explicit exact-base seasons use Chinese numbers and next-first ordering, excluding prefix collisions',async()=>{
 const pool=[work(2,'末世求生第三季！'),work(3,'末世求生第十一部'),work(4,'末世求生第一季'),work(5,'末世求生外传第三季'),work(6,'末世求生'),current];
 const service=new RecommendationService({getSeries:async()=>current,search:async()=>catalog(pool),catalog:async()=>catalog(pool)});
 const result=await service.get(current.id);
 assert.deepEqual(result.seasons.map(x=>x.work.id),['10000002','10000003','10000004']);
 assert.equal(result.seasons[0].reason,'同名第3季');
 assert.equal(new Set([...result.seasons,...result.similar].map(x=>x.work.id)).size,result.seasons.length+result.similar.length);
});
test('similarity requires common category or bounded topic evidence, never popularity alone',async()=>{
 const pool=[work(2,'雪原','末世生存故事'),work(3,'豪门恋曲'),work(4,'异星', '', ['科幻'])];
 const service=new RecommendationService({getSeries:async()=>({...current,categories:['科幻']}),search:async()=>catalog(pool),catalog:async()=>catalog(pool)});
 const result=await service.get(current.id);
 assert.deepEqual(result.similar.map(x=>x.work.id).sort(),['10000002','10000004']);
 assert.match(result.similar.find(x=>x.work.id==='10000002')!.reason,/末世.*关键词/);
});
test('generic categories do not establish similarity and same-season mirrors are excluded',async()=>{
 const source:Series={...work(1,'星河第二季','',['漫剧','短剧','AI漫剧','全部','其他','男频','女频']),episodes:[]};
 const pool=[work(2,'星河第2季'),work(3,'星河第3季'),work(4,'豪门恋曲','',['AI漫剧','女频']),work(5,'星河传说','',['其他'])];
 const service=new RecommendationService({getSeries:async()=>source,search:async()=>catalog(pool),catalog:async()=>catalog(pool)});
 const result=await service.get(source.id);
 assert.deepEqual(result.seasons.map(x=>x.work.id),['10000003']);
 assert.deepEqual(result.similar,[]);
});
test('failed sources preserve partial results and are retried, complete failure rejects',async()=>{
 let fails=true,calls=0;
 const service=new RecommendationService({getSeries:async()=>current,search:async()=>{calls++;if(fails)throw Error('offline');return catalog([work(2,'末世求生第三季')]);},catalog:async()=>catalog([work(3,'异世','末世故事')])});
 assert.match((await service.get(current.id)).message,/部分/);const first=calls;fails=false;
 assert.equal((await service.get(current.id)).seasons.length,1);assert.ok(calls>first);
 await assert.rejects(new RecommendationService({getSeries:async()=>{throw Error('offline')},search:async()=>catalog([]),catalog:async()=>catalog([])}).get(current.id));
 await assert.rejects(new RecommendationService({getSeries:async()=>current,search:async()=>{throw Error('offline')},catalog:async()=>{throw Error('offline')}}).get(current.id),/推荐来源暂时不可用/);
 await assert.rejects(service.get('bad'));
});

test('explicit refresh bypasses successful recommendation cache',async()=>{
 let calls=0;const service=new RecommendationService({getSeries:async()=>{calls++;return current},search:async()=>catalog([]),catalog:async()=>catalog([])});
 await service.get(current.id);await service.get(current.id);assert.equal(calls,1);await service.get(current.id,true);assert.equal(calls,2);
});
test('coalesces requests, expires TTL and bounds search pagination, result counts and cache capacity',async()=>{
 let now=1000,details=0;const oldNow=Date.now;Date.now=()=>now;
 try{
  const searches:{q:string;offset:number}[]=[];
  const service=new RecommendationService({getSeries:async id=>{details++;return {...current,id}},search:async(q,offset=0)=>{searches.push({q,offset});return catalog(Array.from({length:100},(_,i)=>work(i+20,`末世求生第${i+3}季`)),true)},catalog:async()=>catalog([])});
  const [a,b]=await Promise.all([service.get(current.id),service.get(current.id)]);assert.deepEqual(a,b);assert.equal(details,1);assert.equal(a.seasons.length,8);
  assert.ok(searches.length<=5);assert.ok(searches.every(x=>x.q.length<=30&&x.offset%10===0&&x.offset<=20));
  a.seasons.length=0;assert.equal((await service.get(current.id)).seasons.length,8);assert.equal(details,1);now+=300001;await service.get(current.id);assert.equal(details,2);
  for(let i=0;i<33;i++)await service.get(String(20000000+i));const before=details;await service.get(current.id);assert.equal(details,before+1);
 }finally{Date.now=oldNow;}
});
