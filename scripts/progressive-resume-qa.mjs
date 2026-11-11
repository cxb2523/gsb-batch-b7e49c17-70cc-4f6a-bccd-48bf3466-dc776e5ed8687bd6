// Production Electron UI regression for a finite early fragment shorter than saved resume time.
// Requires the unified dist build. Only ContentProvider is replaced; no production code is patched.
import {_electron as electron} from 'playwright-core';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,copyFile,cp,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const output=path.resolve(`outputs/progressive-resume-qa-${Date.now()}`),main=path.join(output,'main/main.cjs'),profile=path.join(output,'profile'),file=path.join(output,'fixture.mp4');
await mkdir(path.dirname(main),{recursive:true});await mkdir(profile,{recursive:true});
execFileSync(path.resolve('runtime-bundle/ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-t','20','-c:v','libx264','-preset','ultrafast','-crf','25','-g','24','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',file],{stdio:'pipe',windowsHide:true});
const works=Array.from({length:2},(_,i)=>({id:String(7695370827507698710n+BigInt(i)),title:['恢复样本甲','退出等待样本乙'][i],cover:'',description:'本地流媒体验收素材',categories:[`测试${i}`],total:1,episodes:[{id:String(7695386527160863790n+BigInt(i)),order:1,duration:20}]}));
await writeFile(path.join(profile,'library.json'),JSON.stringify({favorites:[],history:works.map(work=>({seriesId:work.id,episodeId:work.episodes[0].id,order:1,time:15,duration:20,updatedAt:Date.now(),work}))}));
const provider=String.raw`
const fs=require('node:fs/promises'),http=require('node:http');
export class ProviderError extends Error{}
const works=${JSON.stringify(works)},file=${JSON.stringify(file)};
const fixture={released:[],requests:[],sent:{},complete:[]};global.fixture=fixture;
let server,bytes;
const ready=(async()=>{bytes=await fs.readFile(file);server=http.createServer((req,res)=>{
 const id=req.url.slice(1),range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
 if(start>bytes.length-1){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});res.end();return}
 fixture.requests.push({id,range:req.headers.range||''});let cursor=start,timer;res.once('close',()=>clearTimeout(timer));
 res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','ETag':'"resume-fixture-v1"','Content-Length':end-start+1,...(range?{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}:{})});
 const send=()=>{if(res.destroyed)return;if(cursor>=bytes.length*.42&&!fixture.released.includes(id)){timer=setTimeout(send,50);return}const next=Math.min(cursor+32768,end+1);res.write(bytes.subarray(cursor,next));cursor=next;fixture.sent[id]=cursor/bytes.length;if(cursor>end){fixture.complete.push(id);res.end();return}timer=setTimeout(send,35)};send();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));return bytes})();
export class ContentProvider{
 async catalog(){await ready;return {items:works,hasMore:false,nextOffset:2,label:'渐进恢复验收',source:'local'}}
 async search(){return this.catalog()}
 async getSeries(id){await ready;return structuredClone(works.find(work=>work.id===id))}
 async resolveShare(){return this.getSeries(works[0].id)}
 async getResource(id){await ready;return {episodeId:id,duration:20,definition:'360p',codec:'h264',encrypted:false,size:bytes.length,availableQualities:['360p'],url:'http://127.0.0.1:'+server.address().port+'/'+id}}
}`;
await build({entryPoints:['src/main/main.ts'],outfile:main,bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent',plugins:[{name:'progressive-resume-fixture',setup(builder){builder.onLoad({filter:/[\\/]main[\\/]provider\.ts$/},()=>({contents:provider,loader:'js'}))}}]});
await copyFile('dist/main/preload.cjs',path.join(output,'main/preload.cjs'));await cp('dist/renderer',path.join(output,'renderer'),{recursive:true});await symlink(path.resolve('runtime-bundle'),path.join(output,'main/runtime-bundle'),'junction');
let app,page;const events=[],errors=[];
const record=(step,data)=>{events.push({step,...data});console.log(JSON.stringify(events.at(-1)))};
const library=async()=>{const result=await page.evaluate(()=>window.desktop.library());assert.ok(result.ok);return result.data};
const quit=async()=>{if(!app)return;const instance=app;app=null;const closed=instance.waitForEvent('close',{timeout:30000});await instance.evaluate(({app})=>{setTimeout(()=>app.quit(),0)});await closed};
const pending=async(index)=>{
 await page.getByRole('button',{name:'发现',exact:true}).click();await page.locator('.work-grid .work-card').filter({hasText:works[index].title}).click();
 await page.getByRole('button',{name:'从头播放',exact:true}).waitFor({timeout:30000});
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=1&&Number.isFinite(v.duration)&&v.duration>0&&v.duration<15},{},{timeout:15000});
 return page.locator('video').evaluate(v=>({nativeDuration:v.duration,time:v.currentTime,paused:v.paused,buffered:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)]),uiTotal:Number(document.querySelector('[aria-label="播放进度"]').max),uiTime:Number(document.querySelector('[aria-label="播放进度"]').value)}));
};
try{
 app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main],env:{...process.env,HONGGUO_TEST_DATA:profile}});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.work-grid .work-card').first().waitFor();
 await page.evaluate(()=>{window.qaMetadata=[];document.addEventListener('loadedmetadata',event=>{if(event.target instanceof HTMLVideoElement)window.qaMetadata.push({duration:event.target.duration,time:event.target.currentTime,src:event.target.currentSrc})},true)});
 const initial=await pending(0);assert.equal(initial.uiTotal,20);assert.equal(initial.uiTime,15);assert.equal(initial.time,0);assert.equal(initial.paused,true);
 const firstTransfer=await app.evaluate((_electron,id)=>({fraction:global.fixture.sent[id],complete:global.fixture.complete.includes(id)}),works[0].episodes[0].id);assert.equal(firstTransfer.complete,false);assert.ok(firstTransfer.fraction<.6);
 await page.waitForTimeout(5800);const before=(await library()).history.find(item=>item.seriesId===works[0].id);assert.equal(before.time,15);assert.equal(before.duration,20);assert.equal(await page.getByRole('button',{name:'从头播放',exact:true}).isVisible(),true);
 record('finite initial fragment is shorter than saved target; UI retains total20/target15 and history survives autosave tick while waiting',{initial,firstTransfer,history:before});await page.screenshot({path:path.join(output,'pending-resume.png')});
 await page.evaluate(()=>{window.qaResumeTotals=[];window.qaTotalTimer=setInterval(()=>{const slider=document.querySelector('[aria-label="播放进度"]');if(slider)window.qaResumeTotals.push(Number(slider.max))},20)});
 await app.evaluate((_electron,id)=>global.fixture.released.push(id),works[0].episodes[0].id);
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>=15&&v.currentTime<19&&v.webkitDecodedFrameCount>0&&Number(document.querySelector('[aria-label="播放进度"]').max)>=19.8},{},{timeout:30000});await page.locator('video').evaluate(v=>v.pause());
 const resumed=await page.locator('video').evaluate(v=>({time:v.currentTime,nativeDuration:v.duration,frames:v.webkitDecodedFrameCount,uiTotal:Number(document.querySelector('[aria-label="播放进度"]').max)}));assert.ok(resumed.uiTotal>=19.8&&resumed.uiTotal<=20.2);
 await page.waitForFunction(async id=>{const result=await window.desktop.library();return result.data.history.some(item=>item.seriesId===id&&item.time>=15&&item.duration>=19.8&&item.duration<=20.2)},works[0].id);
 assert.equal((await app.evaluate(()=>global.fixture.requests)).filter(request=>request.id===works[0].episodes[0].id).length,1);
 const observedTotals=await page.evaluate(()=>{clearInterval(window.qaTotalTimer);return window.qaResumeTotals});assert.ok(observedTotals.length>0);assert.ok(Math.min(...observedTotals)>=20,`verified source total shrank to ${Math.min(...observedTotals)}`);
 record('actual browser resumes at target15 after buffering/completion without a new source transfer',{resumed,observedTotalMin:Math.min(...observedTotals),observedTotalMax:Math.max(...observedTotals),metadata:await page.evaluate(()=>window.qaMetadata)});
 const escapeInitial=await pending(1);assert.equal(escapeInitial.uiTotal,20);assert.equal(escapeInitial.uiTime,15);
 await page.getByRole('button',{name:'从头播放',exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1&&v.currentTime<3&&v.webkitDecodedFrameCount>0});await page.locator('video').evaluate(v=>v.pause());
 await page.waitForFunction(async id=>{const result=await window.desktop.library();return result.data.history.some(item=>item.seriesId===id&&item.time<3&&item.duration===20)},works[1].id);
 assert.equal(await page.getByRole('button',{name:'从头播放',exact:true}).count(),0);assert.equal(await page.getByRole('slider',{name:'播放进度',exact:true}).getAttribute('max'),'20');
 record('visible start-from-beginning escape starts real decoded video and intentionally replaces saved target while retaining total20',{escapeInitial,history:(await library()).history.find(item=>item.seriesId===works[1].id)});
 await app.evaluate((_electron,id)=>global.fixture.released.push(id),works[1].episodes[0].id);await page.waitForFunction(async()=>{const result=await window.desktop.bufferState();return result.data.ready>=1&&!result.data.activities?.length},{},{timeout:30000});
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,events,errors},null,2));console.log(JSON.stringify({passed:true,output}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,events,errors,failure:error.stack||error.message,text:await page?.locator('body').innerText().catch(()=>null)},null,2));console.error(JSON.stringify({passed:false,output,failure:error.message}));throw error}
finally{await quit()}
