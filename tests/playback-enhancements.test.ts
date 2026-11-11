import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSeason,episodeFinished,sleepExpired} from '../src/renderer/season-continuation';
import {readPlayerPreferences,savePlayerPreferences,qualityChoices} from '../src/renderer/player-preferences';
const work=(id:string,title:string)=>({id,title,cover:'',description:'',total:1});
test('only an explicit unique exact base next season continues',()=>{
 const current=work('1','星河第一季'),next=work('2','星河第二季');
 assert.equal(nextSeason(current,[next,work('3','星河第三季')])?.id,'2');
 assert.equal(nextSeason(work('1','星河'),[next]),undefined);
 assert.equal(nextSeason(current,[work('2','新星河第二季')]),undefined);
 assert.equal(nextSeason(current,[next,work('4','星河第2季')]),undefined);
 assert.equal(nextSeason(current,[next,next])?.id,'2');
 assert.equal(nextSeason(work('1','星河第十一季'),[work('2','星河第十二季')])?.id,'2');
});
test('sleep deadline stops at boundary and terminal episode plan never reopens',()=>{
 assert.equal(sleepExpired({kind:'deadline',deadline:1000},1000),true);
 assert.equal(sleepExpired({kind:'deadline',deadline:1000},999),false);
 const stopped=episodeFinished({kind:'episodes',remaining:1},900);
 assert.deepEqual(stopped,{kind:'stopped'});
 assert.deepEqual(episodeFinished(stopped,1200),{kind:'stopped'});
 assert.deepEqual(episodeFinished({kind:'episodes',remaining:3},900),{kind:'episodes',remaining:2});
});
test('preferences validate each value and survive new players',()=>{
 const values=new Map<string,string>(); const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}};
 assert.deepEqual(readPlayerPreferences(storage),{volume:0.8,muted:false,autoNext:true,quality:'auto'});
 assert.equal(savePlayerPreferences({volume:0,muted:true,autoNext:false,quality:'720p'},storage),true);
 assert.deepEqual(readPlayerPreferences(storage),{volume:0,muted:true,autoNext:false,quality:'720p'});
 values.set('hongguo.playerPreferences',JSON.stringify({volume:9,muted:'false',autoNext:0,quality:'4K'}));
 assert.deepEqual(readPlayerPreferences(storage),{volume:0.8,muted:false,autoNext:true,quality:'auto'});
 assert.deepEqual(qualityChoices(['1080p','720p','720p','480p','unknown']),['1080p','720p','480p']);
});
