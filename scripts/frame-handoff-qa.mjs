// Production main/preload/renderer with local media and a deliberate playback IPC delay.
// Run after `npm run build`. The QA runner deliberately does not rebuild shared dist.
import {_electron as electron} from 'playwright-core';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp,copyFile,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const output=path.resolve(process.env.QA_OUTPUT||`outputs/frame-handoff-qa-${Date.now()}`);
const main=path.join(output,'main/main.cjs'),profile=path.join(output,'profile');
const duration=6;
const ids=['7695370827507698701','7695370827507698702','7695370827507698703'];
const titles=['云海来信第一季','云海来信第二季','长街末世冒险'];
const works=ids.map((id,n)=>({id,title:titles[n],cover:'',description:'末世冒险，本地 H264/AAC 验收素材',categories:['冒险'],total:2,episodes:Array.from({length:2},(_,i)=>({id:String(7695386527160863700n+BigInt(n*10+i)),order:i+1,duration}))}));
const events=[],errors=[];
let app,page,snapshot;
await mkdir(path.dirname(main),{recursive:true});await mkdir(profile,{recursive:true});
const clips={};
for(const [quality,size] of [['720p','1280x720'],['480p','854x480']]){
 const file=path.join(output,`fixture-${quality}.mp4`);clips[quality]=file;
 execFileSync(path.resolve('runtime-bundle/ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`color=c=0x3268cc:s=${size}:r=24`,'-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t',String(duration),'-c:v','libx264','-preset','ultrafast','-crf','29','-g','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart',file],{stdio:'pipe',windowsHide:true});
}
// Historical B2 must never win over an automatic/manual recommendation first-episode start.
await writeFile(path.join(profile,'library.json'),JSON.stringify({favorites:[],history:[{seriesId:ids[1],episodeId:works[1].episodes[1].id,order:2,time:2,duration,updatedAt:Date.now(),work:works[1]}]}));
const provider=String.raw`
const fs=require('node:fs/promises'),http=require('node:http');
export class ProviderError extends Error{constructor(code,message){super(message);this.code=code}}
const works=${JSON.stringify(works)},files=${JSON.stringify(clips)};
const fixture={playbackDelayMs:650,failPlayback:false,delayMs:0,inFlight:0,failRecommendations:false,requests:[],resources:[],active:0,maxActive:0};global.fixture=fixture;
let server,bytes;
const ready=(async()=>{
 bytes=Object.fromEntries(await Promise.all(Object.entries(files).map(async([k,v])=>[k,await fs.readFile(v)])));
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://local'),quality=url.searchParams.get('quality')==='480p'?'480p':'720p',body=bytes[quality],etag='"qa-'+quality+'-v1"';
  const match=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);let start=match?Number(match[1]):0,end=match&&match[2]?Number(match[2]):body.length-1;
  if(req.headers['if-range']&&req.headers['if-range']!==etag)start=0;
  end=Math.min(end,body.length-1);if(start>=body.length){res.writeHead(416,{'Content-Range':'bytes */'+body.length});res.end();return}
  const ranged=!!match&&(!req.headers['if-range']||req.headers['if-range']===etag);
  fixture.requests.push({path:url.pathname,quality,range:req.headers.range||'',status:ranged?206:200});fixture.active++;fixture.maxActive=Math.max(fixture.maxActive,fixture.active);
  let timer;res.once('close',()=>{fixture.active--;clearTimeout(timer)});
  res.writeHead(ranged?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','ETag':etag,'Content-Length':end-start+1,...(ranged?{'Content-Range':'bytes '+start+'-'+end+'/'+body.length}:{})});
  if(req.method==='HEAD'){res.end();return}
  let cursor=start;const send=()=>{if(res.destroyed)return;const next=Math.min(cursor+65536,end+1);res.write(body.subarray(cursor,next));cursor=next;if(cursor>end){res.end();return}timer=setTimeout(send,25)};send();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return bytes;
})();
async function recommendationDelay(){const delay=fixture.delayMs;fixture.inFlight++;try{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(fixture.failRecommendations)throw new ProviderError('QA_SOURCE_OFFLINE','推荐来源暂时不可用')}finally{fixture.inFlight--}}
export class ContentProvider{
 constructor(){}
 async catalog(){await ready;await recommendationDelay();return {items:works,hasMore:false,nextOffset:3,label:'本地连播验收',source:'fixture'}}
 async search(){return this.catalog()}
 async getSeries(id){await ready;const work=works.find(item=>item.id===id);if(!work)throw new ProviderError('NOT_FOUND','本地作品不存在');return structuredClone(work)}
 async resolveShare(text){return this.getSeries(text.includes('A2')?works[1].id:text.includes('similar')?works[2].id:works[0].id)}
 async getResource(id,quality='auto'){await ready;const selected=quality==='480p'||quality==='360p'?'480p':'720p';fixture.resources.push({id,requested:quality,selected});return {episodeId:id,duration:${duration},definition:selected,availableQualities:['720p','480p'],codec:'h264',encrypted:false,size:bytes[selected].length,url:'http://127.0.0.1:'+server.address().port+'/'+id+'?quality='+selected+'&token=QA_SECRET_DO_NOT_EXPORT'}}
}
`;
await build({entryPoints:['src/main/main.ts'],outfile:main,bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent',banner:{js:`const qaIpc=require('electron').ipcMain,qaHandle=qaIpc.handle.bind(qaIpc);qaIpc.handle=(channel,handler)=>qaHandle(channel,channel==='playback'?async(...args)=>{await new Promise(resolve=>setTimeout(resolve,global.fixture.playbackDelayMs));if(global.fixture.failPlayback)return {ok:false,error:{code:'QA_OFFLINE',message:'测试播放来源不可用'}};return handler(...args)}:handler);`},plugins:[{name:'continuous-playback-fixture',setup(builder){builder.onLoad({filter:/[\\/]main[\\/]provider\.ts$/},()=>({contents:provider,loader:'js'}))}}]});
await copyFile('dist/main/preload.cjs',path.join(output,'main/preload.cjs'));
await cp('dist/renderer',path.join(output,'renderer'),{recursive:true});
await symlink(path.resolve('runtime-bundle'),path.join(output,'main/runtime-bundle'),'junction');
const record=(step,data={})=>{events.push({step,...data});console.log(JSON.stringify(events.at(-1)))};
const state=async()=>{const result=await page.evaluate(()=>window.desktop.cacheState());assert.equal(result.ok,true,result.error?.message);snapshot=result.data;return snapshot};
const until=async(check,label,timeout=45000)=>{
 const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await state();if(check(value))return value;await page.waitForTimeout(100)}
 throw new Error(`Timeout: ${label}; cache=${JSON.stringify(snapshot)}`);
};
const launch=async()=>{
 app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main],env:{...process.env,HONGGUO_TEST_DATA:profile}});
 page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.work-grid .work-card').first().waitFor();
};
const quit=async()=>{if(!app)return;const instance=app;app=null;const closed=instance.waitForEvent('close',{timeout:30000});await instance.evaluate(({app})=>{setTimeout(()=>app.quit(),0)});await closed};
const ready=async(seriesIndex,order,{pause=true}={})=>{
 await page.waitForFunction(({title,order})=>document.querySelector('.detail-heading h1')?.textContent===title&&document.querySelector('.player')?.getAttribute('aria-label')===`第${order}集播放器`&&(()=>{const v=document.querySelector('video');return v&&v.readyState>=3&&!v.paused&&v.currentTime>.03&&v.videoWidth>0&&v.webkitDecodedFrameCount>0})(),{title:titles[seriesIndex],order},{timeout:60000});
 if(pause)await page.locator('video').evaluate(video=>video.pause());
 return page.locator('video').evaluate(video=>({time:video.currentTime,duration:video.duration,width:video.videoWidth,height:video.videoHeight,rate:video.playbackRate,volume:video.volume,muted:video.muted,frames:video.webkitDecodedFrameCount,audioBytes:video.webkitAudioDecodedByteCount}));
};
const open=async(seriesIndex,order=1)=>{if(await page.evaluate(()=>!!document.fullscreenElement))await page.evaluate(()=>document.exitFullscreen());await page.getByRole('button',{name:'发现',exact:true}).click();await page.locator('.work-grid .work-card').filter({hasText:titles[seriesIndex]}).click();return ready(seriesIndex,order)};
const finish=async()=>{
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&Number.isFinite(v.duration)&&v.duration>0&&v.buffered.length&&v.buffered.end(v.buffered.length-1)>=v.duration-.2},{},{timeout:45000});
 await page.locator('video').evaluate(video=>{video.currentTime=video.duration-.12;void video.play()});
};
// Each animation frame must have either the outgoing decoded picture or the incoming one.
const arm=async()=>page.evaluate(()=>{
 window.qaFrames=[];window.qaWatch=true;window.qaFirstVideo=document.querySelector('video');
 const sample=()=>{
  if(!window.qaWatch)return;
  const stage=document.querySelector('.video-stage'),video=stage?.querySelector('video');
  const canvas=stage?.querySelector('canvas.player-handoff');
  const held=!!canvas&&!canvas.hidden&&getComputedStyle(canvas).display!=='none';
  window.qaFrames.push({at:performance.now(),episode:document.querySelector('.player')?.getAttribute('aria-label'),picture:!!video&&(video===window.qaFirstVideo||video.readyState>=2&&video.webkitDecodedFrameCount>0),held});
  requestAnimationFrame(sample);
 };requestAnimationFrame(sample);
});
const handoff=async(label,action,nextSeries,nextOrder)=>{
 await arm();await action();
 await page.waitForFunction(()=>document.querySelector('video')!==window.qaFirstVideo);
 // The outgoing video already has a presented frame, even while the test seeks near its end.
 // A real screenshot during the deliberately delayed IPC must still show the blue video.
 await page.waitForTimeout(120);
 const box=await page.locator('.video-stage').boundingBox();
 const shot=await page.screenshot({path:path.join(output,`${label}.png`),clip:{x:Math.floor(box.x+box.width*.4),y:Math.floor(box.y+box.height*.4),width:20,height:20}});
 const pixel=await app.evaluate(({nativeImage},bytes)=>Array.from(nativeImage.createFromBuffer(Buffer.from(bytes)).toBitmap().subarray(0,4)),Array.from(shot));
 await ready(nextSeries,nextOrder);
 const frames=await page.evaluate(()=>{window.qaWatch=false;return window.qaFrames});
 const gaps=frames.filter(f=>!f.picture&&!f.held);
 record(label,{pixel,samples:frames.length,gaps:gaps.length,gapDetails:gaps,held:frames.filter(f=>f.held).length});
 assert.ok(pixel[0]>120&&pixel[0]>pixel[2]*1.5,`${label}: screenshot must retain the decoded blue picture, got BGRA ${pixel}`);
 assert.equal(gaps.length,0,`${label}: ${gaps.length} animation frames had no picture`);
 await page.waitForFunction(()=>!document.querySelector('canvas.player-handoff:not([hidden])'));
};
try{
 await launch();
 for(const id of ids.slice(0,2)){const result=await page.evaluate(id=>window.desktop.cacheAdd(id),id);assert.equal(result.ok,true)}
 await until(s=>ids.slice(0,2).every(id=>s.tasks.some(t=>t.series.id===id&&t.state.ready===2)),'both seasons completely cached');
 record('both seasons fully cached before playback; address preparation delay must not expose an empty stage');
 await open(0);
 await page.getByRole('combobox',{name:'播放倍速',exact:true}).selectOption('2');
 await page.getByRole('button',{name:'切换全屏',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
 await page.evaluate(()=>{window.qaFullscreen=document.fullscreenElement});
 await handoff('automatic-next',finish,0,2);
 assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaFullscreen),true);
 assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),2);
 await handoff('automatic-next-season',finish,1,1);
 assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaFullscreen),true);
 await handoff('manual-next',()=>page.getByRole('button',{name:'下一集',exact:true}).click(),1,2);
 // Late first-frame callbacks from superseded players must not clear the retained picture.
 await page.getByRole('button',{name:'上一集',exact:true}).click();
 await page.getByRole('button',{name:'下一集',exact:true}).click();await ready(1,2);
 await page.waitForFunction(()=>!document.querySelector('canvas.player-handoff:not([hidden])'));
 record('rapid skip settles on the requested episode and releases the held frame');
 // Deliver already-queued first-frame notifications late, including after cancellation.
 await page.evaluate(()=>{
  window.qaNativeFrame=HTMLVideoElement.prototype.requestVideoFrameCallback;
  HTMLVideoElement.prototype.requestVideoFrameCallback=function(callback){return window.qaNativeFrame.call(this,(now,metadata)=>setTimeout(()=>callback(now,metadata),1200))};
 });
 await page.getByRole('button',{name:'上一集',exact:true}).click();await ready(1,1);
 assert.equal(await page.locator('canvas.player-handoff').evaluate(c=>!c.hidden),true,'canplay must not release the picture before the first-frame callback');
 await page.getByRole('button',{name:'下一集',exact:true}).click();await ready(1,2);await page.waitForTimeout(650);
 assert.equal(await page.locator('canvas.player-handoff').evaluate(c=>!c.hidden),true,'a superseded first-frame callback must not clear the next handoff');
 await page.waitForFunction(()=>!document.querySelector('canvas.player-handoff:not([hidden])'));
 await page.evaluate(()=>{HTMLVideoElement.prototype.requestVideoFrameCallback=window.qaNativeFrame});
 record('handoff waits for the first presented frame; late callbacks from a skipped episode cannot release it');
 // An unavailable episode must still expose its real error and a usable retry button.
 await app.evaluate(()=>{global.fixture.failPlayback=true});await page.getByRole('button',{name:'上一集',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'测试播放来源不可用'}).waitFor();
 await page.getByRole('button',{name:'重试当前集',exact:true}).click();await page.getByRole('alert').filter({hasText:'测试播放来源不可用'}).waitFor({state:'hidden'});await page.getByRole('alert').filter({hasText:'测试播放来源不可用'}).waitFor();
 await app.evaluate(()=>{global.fixture.failPlayback=false});await page.getByRole('button',{name:'重试当前集',exact:true}).click();await ready(1,1);
 await page.waitForFunction(()=>!document.querySelector('canvas.player-handoff:not([hidden])'));
 record('playback error remains visible and retry decodes a new frame');
 await page.evaluate(()=>document.exitFullscreen());
 await handoff('windowed-next',()=>page.getByRole('button',{name:'下一集',exact:true}).click(),1,2);
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,events,errors},null,2));console.log(JSON.stringify({passed:true,output,events},null,2));
}catch(error){
 await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,events,errors,failure:error.stack||error.message},null,2));console.error(JSON.stringify({passed:false,output,failure:error.message},null,2));throw error;
}finally{await quit()}
