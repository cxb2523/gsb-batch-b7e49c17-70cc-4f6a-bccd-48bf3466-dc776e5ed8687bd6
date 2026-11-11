import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlaybackRate,savePlaybackRate} from '../src/renderer/player-preferences';

test('保存倍速后新的播放器读取同一设置，允许改回一倍速',()=>{
 const values=new Map<string,string>();
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}};
 assert.equal(readPlaybackRate(storage),1);
 assert.equal(savePlaybackRate(1.5,storage),true);assert.equal(readPlaybackRate(storage),1.5);
 savePlaybackRate(2,storage);assert.equal(readPlaybackRate(storage),2);
 savePlaybackRate(1,storage);assert.equal(readPlaybackRate(storage),1);
 assert.equal(savePlaybackRate(99,storage),false);assert.equal(readPlaybackRate(storage),1);
});

test('无效偏好回到一倍速，存储不可用不会让播放器崩溃',()=>{
 for(const value of [null,'','junk','NaN','0','-1','99','1.1'])assert.equal(readPlaybackRate({getItem:()=>value}),1);
 const broken={getItem:()=>{throw Error('unavailable')},setItem:()=>{throw Error('unavailable')}};
 assert.equal(readPlaybackRate(broken),1);assert.equal(savePlaybackRate(1.5,broken),false);
});
