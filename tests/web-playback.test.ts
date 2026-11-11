import test from 'node:test';
import assert from 'node:assert/strict';
import {webPlayback,inspectMp4} from '../src/main/web-playback';
import {ContentProvider} from '../src/main/provider';
const ID='7695386527160863769';
const box=(name:string,...parts:Buffer[])=>{const body=Buffer.concat(parts),head=Buffer.alloc(8);head.writeUInt32BE(body.length+8);head.write(name,4);return Buffer.concat([head,body])};
function movie(codec='avc1',audio='mp4a',version=0){
 const mvhd=Buffer.alloc(version?32:24);mvhd[0]=version;
 if(version){mvhd.writeUInt32BE(1000,20);mvhd.writeBigUInt64BE(60033n,24)}else{mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(60033,16)}
 const handler=(name:string)=>{const b=Buffer.alloc(12);b.write(name,8);return box('hdlr',b)};
 const video=Buffer.alloc(36);video.writeUInt16BE(640,24);video.writeUInt16BE(360,26);
 const stsd=(name:string,b:Buffer)=>box('stsd',Buffer.alloc(4),Buffer.from([0,0,0,1]),box(name,b));
 const track=(type:string,name:string,b:Buffer)=>box('trak',box('mdia',handler(type),box('minf',box('stbl',stsd(name,b)))));
 return box('moov',box('mvhd',mvhd),track('vide',codec,video),track('soun',audio,Buffer.alloc(28)));
}
const range=(bytes:Buffer)=>'bytes 0-'+(bytes.length-1)+'/'+bytes.length;
test('MP4 inspection derives actual duration and resolution and rejects encrypted or missing audio',()=>{
 assert.deepEqual(inspectMp4(movie()),{duration:60.033,definition:'360p',codec:'h264'});
 assert.equal(inspectMp4(movie('avc1','mp4a',1)).duration,60.033);
 for(const bytes of [movie('encv'),movie('avc1','enca'),movie().subarray(0,40),Buffer.alloc(0)])assert.throws(()=>inspectMp4(bytes));
});
test('official fallback validates envelope and actual MP4, keeping media credentials in main process',async()=>{
 const media=movie();let calls=0;
 const fetcher=(async(input:any,init:any)=>{
  calls++;const url=new URL(String(input));
  if(calls===1){assert.equal(url.origin,'https://hongguoduanju.com');assert.equal(url.pathname,'/api/video/protected/fallback-play-info');assert.deepEqual(JSON.parse(init.body),{item_id:ID});return Response.json({base_resp:{StatusCode:0},main_url:'https://v26-hgweb.qznovelvod.com/resource',url_expire:Math.floor(Date.now()/1000)+300})}
  assert.equal(new Headers(init.headers).get('range'),'bytes=0-1048575');
  return new Response(media,{status:206,headers:{'Content-Range':range(media),'Content-Length':String(media.length)}});
 }) as typeof fetch;
 const r=await webPlayback(ID,fetcher);assert.equal(r.episodeId,ID);assert.equal(r.encrypted,false);assert.equal(r.definition,'360p');assert.equal(r.duration,60.033);assert.equal(r.size,media.length);assert.deepEqual(r.availableQualities,['360p']);
});
test('fallback rejects untrusted addresses, expired resources, errors and inconsistent sizes before download',async()=>{
 const expiry=Math.floor(Date.now()/1000)+300;
 for(const data of [
 {base_resp:{StatusCode:0},main_url:'http://v26-hgweb.qznovelvod.com/x',url_expire:expiry},
 {base_resp:{StatusCode:0},main_url:'https://attacker.example/x',url_expire:expiry},
 {base_resp:{StatusCode:0},main_url:'https://user:pass@v26-hgweb.qznovelvod.com/x',url_expire:expiry},
 {base_resp:{StatusCode:0},main_url:'https://v26-hgweb.qznovelvod.com:444/x',url_expire:expiry},
 {base_resp:{StatusCode:1},main_url:'https://v26-hgweb.qznovelvod.com/x',url_expire:expiry},
 {base_resp:{StatusCode:0},main_url:'https://v26-hgweb.qznovelvod.com/x',url_expire:1},
 ]){let calls=0;await assert.rejects(webPlayback(ID,(async()=>{calls++;return Response.json(data)}) as typeof fetch));assert.equal(calls,1)}
 await assert.rejects(webPlayback(ID,(async(input:any)=>String(input).includes('hongguoduanju.com')?Response.json({base_resp:{StatusCode:0},main_url:'https://v26-hgweb.qznovelvod.com/x',url_expire:Math.floor(Date.now()/1000)+300}):new Response(movie(),{status:206,headers:{'Content-Range':'bytes 100-200/500'}})) as typeof fetch));
});
test('provider falls back on native empty responses but preserves invalid-input and profile errors',async()=>{
 const media=movie();const fetcher=(async(input:any)=>String(input).includes('hongguoduanju.com')?Response.json({base_resp:{StatusCode:0},main_url:'https://v26-hgweb.qznovelvod.com/x',url_expire:Math.floor(Date.now()/1000)+300}):new Response(media,{status:206,headers:{'Content-Range':range(media)}})) as typeof fetch;
 const provider=new ContentProvider({request:async()=>{throw Object.assign(new Error('empty'),{code:'API_EMPTY'})}},{fetch:fetcher});
 assert.equal((await provider.getResource(ID)).codec,'h264');
 const bad=new ContentProvider({request:async()=>{throw Object.assign(new Error('profile'),{code:'PLAYER_PROFILE'})}},{fetch:async()=>{throw Error('must not fallback')}});
 await assert.rejects(bad.getResource(ID),{code:'PLAYER_PROFILE'});
 await assert.rejects(provider.getResource('invalid'));
});

test('an unavailable public episode is reported rather than replaced with a preview',async()=>{
 let calls=0;
 await assert.rejects(webPlayback(ID,(async()=>{calls++;return Response.json({error:'public_fallback_unavailable'},{status:403})}) as typeof fetch),{code:'WEB_PUBLIC_UNAVAILABLE'});
 assert.equal(calls,1);
});
