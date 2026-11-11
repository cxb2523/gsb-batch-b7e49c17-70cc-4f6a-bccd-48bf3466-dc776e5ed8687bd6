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
const media=new MediaCache(path.join(output,'rank-playback-cache'),path.resolve('runtime-bundle/ffmpeg.exe'),id=>provider.getResource(id));
const report:any={generatedAt:new Date().toISOString(),identity:independentIdentity,releasedProviderChanged:false,
 soundAuditionVerified:false,cellIdDiscoveredFromIndependentHome:false,passed:false};
let browser:any;
try{
 await mkdir(output,{recursive:true});await media.init();
 const catalog=await provider.catalog('recommend');
 assert.ok(catalog.items.length>0);
 report.catalog={label:catalog.label,source:catalog.source,count:catalog.items.length,hasMore:catalog.hasMore,nextOffset:catalog.nextOffset,items:catalog.items};
 const work=catalog.items.find(w=>!['7695370827507698713','7692043430955863102'].includes(w.id));
 assert.ok(work,'榜单没有新作品');
 const series=await provider.getSeries(work.id);assert.equal(series.title,work.title);assert.equal(series.total,work.total);
 const episode=series.episodes[0];const resource=await provider.getResource(episode.id);
 assert.ok(episode.duration&&Math.abs(resource.duration-episode.duration)<1);
 report.work={id:series.id,title:series.title,total:series.total,categories:series.categories};
 report.episode={id:episode.id,order:episode.order,detailDuration:episode.duration,apiDuration:resource.duration};
 console.log(JSON.stringify({step:'rank-to-detail',...report.work,duration:resource.duration}));
 const playback=await media.prepare(episode.id,true);browser=await openProbeBrowser();const page=await browser.newPage();
 await page.route('http://127.0.0.1:18997/**',async(route:any)=>{
  if(new URL(route.request().url()).pathname==='/')return route.fulfill({contentType:'text/html',body:'<video muted controls></video>'});
  const response=await media.response(playback.url,route.request().headers().range??null);
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });await page.goto('http://127.0.0.1:18997/');
 const observed=await page.evaluate(async(duration:number)=>{
  const video=document.querySelector('video')!;const start=performance.now();
  const full=await new Promise<any>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('PLAYBACK_TIMEOUT')),(duration/3+20)*1000);
   video.onended=()=>{clearTimeout(timer);resolve({duration:video.duration,time:video.currentTime,ended:video.ended,frames:video.webkitDecodedFrameCount,audioBytes:(video as any).webkitAudioDecodedByteCount,wallSeconds:(performance.now()-start)/1000})};
   video.onerror=()=>{clearTimeout(timer);reject(Error('MEDIA_ERROR'))};
   video.src='http://127.0.0.1:18997/episode';video.playbackRate=3;video.play().catch(reject);
  });video.onended=null;video.onerror=null;
  video.currentTime=0;await video.play();video.pause();const target=video.duration/2;
  const seeked=new Promise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),8000);video.onseeked=()=>{clearTimeout(timer);resolve(Math.abs(video.currentTime-target)<1)}});
  video.currentTime=target;const seek=await seeked;await video.play();const before=video.currentTime;
  await new Promise(resolve=>setTimeout(resolve,600));const resumed=video.currentTime>before+.5;video.pause();
  return {...full,seeked:seek,resumed};
 },resource.duration);
 Object.assign(report.episode,observed);
 assert.ok(observed.ended&&observed.frames>0&&observed.audioBytes>0&&observed.seeked&&observed.resumed&&Math.abs(observed.duration-resource.duration)<1&&Math.abs(observed.time-observed.duration)<.1);
 report.passed=true;console.log(JSON.stringify({step:'rank-full-playback',episode:report.episode}));
}catch(e){report.error=e instanceof Error?e.message:'PROBE_FAILED';process.exitCode=1;console.log(JSON.stringify({step:'failure',error:report.error}))}
finally{await browser?.close();await media.close();signer.close();await writeFile(path.join(output,'rank-playback.json'),JSON.stringify(report,null,2));}
