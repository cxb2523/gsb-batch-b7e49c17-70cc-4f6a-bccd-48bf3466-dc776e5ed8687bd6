import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Signer} from '../src/main/transport';
import {ContentProvider} from '../src/main/provider';
import {MediaCache} from '../src/main/media';
import {IndependentTransport,independentIdentity} from './independent-transport';
import {openProbeBrowser} from '../src/probe/browser.mjs';

const output=path.resolve('research/independent');
const signer=new Signer(path.resolve('runtime-bundle'),path.join(output,'signer-work'));
const provider=new ContentProvider(new IndependentTransport(signer));
const media=new MediaCache(path.join(output,'playback-cache'),path.resolve('runtime-bundle/ffmpeg.exe'),id=>provider.getResource(id));
const report:any={generatedAt:new Date().toISOString(),identity:independentIdentity,releasedProviderChanged:false,soundAuditionVerified:false,passed:false,series:[]};
const save=()=>writeFile(path.join(output,'full-playback.json'),JSON.stringify(report,null,2));
let browser:any;
try{
 await mkdir(output,{recursive:true});await media.init();browser=await openProbeBrowser();
 for(const id of ['7695370827507698713','7692043430955863102']){
  const series=await provider.getSeries(id);
  const orders=[1,2,3,Math.ceil(series.total/2),series.total];
  const entry:any={id,title:series.title,total:series.total,episodes:[],transitions:[]};report.series.push(entry);
  const page=await browser.newPage();const prepared=new Map();
  await page.route('http://127.0.0.1:18996/**',async (route:any)=>{
   const item=prepared.get(new URL(route.request().url()).pathname.slice(1));
   if(!item)return route.fulfill({contentType:'text/html',body:'<video muted controls></video>'});
   const response=await media.response(item.url,route.request().headers().range??null);
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });await page.goto('http://127.0.0.1:18996/');
  for(const order of orders){
   const episode=series.episodes[order-1];const resource=await provider.getResource(episode.id);
   assert.ok(episode.duration&&Math.abs(resource.duration-episode.duration)<1);
   const playback=await media.prepare(episode.id,true);prepared.set(episode.id,playback);
   entry.episodes.push({order,id:episode.id,detailDuration:episode.duration,apiDuration:resource.duration,definition:resource.definition});
   console.log(JSON.stringify({step:'prepared',seriesId:id,order,duration:resource.duration}));await save();
  }
  const played=await page.evaluate(async (items:any[])=>{
   const video=document.querySelector('video')!;const observations:any[]=[],transitions:any[]=[];
   for(const item of items){
    const start=performance.now();let maxTime=0;
    if(observations.length)transitions.push({from:items[observations.length-1].order,to:item.order,trigger:'ended'});
    const observation=await new Promise<any>((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(Error('PLAYBACK_TIMEOUT')),(item.apiDuration/3+20)*1000);
     video.ontimeupdate=()=>maxTime=Math.max(maxTime,video.currentTime);
     video.onerror=()=>{clearTimeout(timeout);reject(Error('MEDIA_ERROR'))};
     video.onended=()=>{clearTimeout(timeout);resolve({order:item.order,duration:video.duration,time:video.currentTime,maxTime,ended:video.ended,frames:video.webkitDecodedFrameCount,audioBytes:(video as any).webkitAudioDecodedByteCount,wallSeconds:(performance.now()-start)/1000})};
     video.src=`http://127.0.0.1:18996/${item.id}`;video.playbackRate=3;video.play().catch(reject);
    });observations.push(observation);
   }
   video.onended=null;video.onerror=null;const seeks=[];
   for(const item of items){
    video.src=`http://127.0.0.1:18996/${item.id}`;video.playbackRate=3;await video.play();
    await new Promise(resolve=>setTimeout(resolve,250));video.pause();const target=video.duration/2;
    const seeked=new Promise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),8000);video.onseeked=()=>{clearTimeout(timer);resolve(Math.abs(video.currentTime-target)<1)}});video.currentTime=target;
    const ok=await seeked;await video.play();const before=video.currentTime;await new Promise(resolve=>setTimeout(resolve,600));seeks.push({order:item.order,seeked:ok,resumed:video.currentTime>before+.5});video.pause();video.onseeked=null;
   }
   return {observations,transitions,seeks};
  },entry.episodes);
  entry.transitions=played.transitions;
  for(const episode of entry.episodes){Object.assign(episode,played.observations.find((o:any)=>o.order===episode.order),played.seeks.find((o:any)=>o.order===episode.order));assert.ok(episode.ended&&episode.frames>0&&episode.audioBytes>0&&episode.seeked&&episode.resumed&&Math.abs(episode.duration-episode.detailDuration)<1&&Math.abs(episode.time-episode.duration)<.1)}
  entry.fullPlaybackVerified=true;console.log(JSON.stringify({step:'full-playback',id,total:series.total,episodes:entry.episodes}));await save();await page.close();
 }
 const imported=await provider.resolveShare('https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/');report.share={matches:imported.id===report.series[0].id,total:imported.total};assert.ok(report.share.matches);report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:'PROBE_FAILED';process.exitCode=1;console.log(JSON.stringify({step:'failure',error:report.error}))}
finally{await browser?.close();await media.close();signer.close();await save()}
