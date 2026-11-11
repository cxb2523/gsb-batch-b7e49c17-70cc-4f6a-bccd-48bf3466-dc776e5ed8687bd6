// Compare actual MediaCache+FFmpeg on identical local media with controlled network delay.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const output=path.resolve(`outputs/cache-throughput-qa-${Date.now()}`);await mkdir(output,{recursive:true});
const ffmpeg=path.resolve('runtime-bundle/ffmpeg.exe'),source=path.join(output,'source.mp4');
execFileSync(ffmpeg,['-y','-f','lavfi','-i','testsrc2=s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-t','10','-c:v','libx264','-c:a','aac',source],{stdio:'ignore',windowsHide:true});
const bytes=await readFile(source),module=path.join(output,'media.mjs');await build({entryPoints:['src/main/media.ts'],outfile:module,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {MediaCache}=await import(pathToFileURL(module).href);let active=0,maxNetwork=0;
const server=createServer((_req,res)=>{active++;maxNetwork=Math.max(maxNetwork,active);res.once('close',()=>active--);res.writeHead(200,{'content-length':bytes.length});const half=Math.floor(bytes.length/2);res.write(bytes.subarray(0,half));setTimeout(()=>res.end(bytes.subarray(half)),700)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const ids=Array.from({length:12},(_,i)=>String(7695386527160863700n+BigInt(i))),results=[];
try{
 for(const concurrency of [2,4]){
  maxNetwork=0;let maxProcessing=0,observedSpeed=0;
  const cache=new MediaCache(path.join(output,`cache-${concurrency}`),ffmpeg,async id=>({episodeId:id,duration:10,definition:'360p',codec:'h264',encrypted:false,url:`http://127.0.0.1:${server.address().port}/${id}`,size:bytes.length}),{concurrency});await cache.init();const start=performance.now();
  try{
   cache.setBackgroundGroups([{id:'7695370827507698700',ids,paused:false}]);
   while(cache.stateFor(ids).ready<ids.length){
    assert.ok(performance.now()-start<30000,'controlled cache run timed out');
    const state=cache.stateFor(ids);assert.equal(state.failed,0);maxProcessing=Math.max(maxProcessing,(state.activities||[]).filter(x=>x.activity?.stage==='processing').length);observedSpeed=Math.max(observedSpeed,cache.downloadBytesPerSecond);await new Promise(resolve=>setTimeout(resolve,10));
   }
   const ms=Math.round(performance.now()-start);assert.equal(maxNetwork,concurrency);assert.ok(maxProcessing<=2);assert.ok(observedSpeed>0);
   const playback=await cache.prepare(ids.at(-1)),response=await cache.response(playback.url,null);const file=path.join(output,`decoded-${concurrency}.mp4`);await writeFile(file,Buffer.from(await response.arrayBuffer()));
   const progress=execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostats','-progress','pipe:1','-i',file,'-f','null','-'],{windowsHide:true}).toString();
   assert.ok(Number([...progress.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1])/1e6>=9.9);
   results.push({concurrency,ms,maxNetwork,maxProcessing,observedSpeed,ready:cache.stateFor(ids).ready});
  }finally{await cache.close()}
 }
 const report={passed:true,fixture:'12 episodes, same generated 10-second 640x360 H.264/AAC source, 700ms controlled per-request network delay',results,speedup:Number((results[0].ms/results[1].ms).toFixed(2)),limits:'Controlled network-bound comparison, not a claim about public sources, ISP speed or HEVC transcoding.'};await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output},null,2));
}finally{server.closeAllConnections();server.close()}
