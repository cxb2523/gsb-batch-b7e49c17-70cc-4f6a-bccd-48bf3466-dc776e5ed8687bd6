// Real Electron renderer + production preload/MediaCache + local HTTP media + bundled FFmpeg.
// Isolated profile, generated video and no third-party content requests.
import {_electron as electron} from 'playwright-core';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve(`outputs/buffer-qa-${Date.now()}`);await mkdir(output,{recursive:true});
const video=path.join(output,'fixture.mp4'),ffmpeg=path.resolve('runtime-bundle/ffmpeg.exe');
execFileSync(ffmpeg,['-y','-f','lavfi','-i','testsrc2=s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-t','10','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video],{stdio:'ignore',windowsHide:true});
await build({entryPoints:['src/main/media.ts'],outfile:path.join(output,'media.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const main=path.join(output,'main.cjs');
await writeFile(main,`
const {app,BrowserWindow,protocol,ipcMain}=require('electron');
const {MediaCache}=require('./media.cjs');const fs=require('node:fs/promises');const http=require('node:http');
protocol.registerSchemesAsPrivileged([{scheme:'manju-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setPath('userData',${JSON.stringify(path.join(output,'profile'))});
const ids=Array.from({length:8},(_,i)=>String(7695386527160863700n+BigInt(i)));
const work={id:'7695370827507698713',title:'整剧缓存验收',cover:'',description:'本地生成视频，真实缓存和转码',total:8};
const requests=[],windows=[],playbacks=[];let offline=false;global.goOffline=()=>{offline=true};let library={favorites:[],history:[]},media,server;
global.qa=async()=>({requests,windows,playbacks,buffer:media.bufferState(),completed:await Promise.all((await fs.readdir(${JSON.stringify(path.join(output,'cache'))})).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await fs.readFile(require('node:path').join(${JSON.stringify(path.join(output,'cache'))},n),'utf8')).episodeId))});
app.whenReady().then(async()=>{
 const bytes=await fs.readFile(${JSON.stringify(video)});
 server=http.createServer((req,res)=>{requests.push(req.url.slice(1));if(offline){res.writeHead(503);res.end();return;}const half=Math.ceil(bytes.length/2);res.writeHead(200,{'content-type':'video/mp4'});res.write(bytes.subarray(0,half));setTimeout(()=>res.end(bytes.subarray(half)),1800)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 media=new MediaCache(${JSON.stringify(path.join(output,'cache'))},${JSON.stringify(ffmpeg)},async id=>({episodeId:id,duration:10,definition:'test',codec:'h264',encrypted:false,url:'http://127.0.0.1:'+server.address().port+'/'+id,size:bytes.length}));await media.init();
 protocol.handle('manju-media',request=>media.response(request.url,request.headers.get('range')));
 const handle=(channel,fn)=>ipcMain.handle(channel,async(_event,...args)=>{try{return {ok:true,data:await fn(...args)}}catch(e){return {ok:false,error:{code:e.code,message:e.message}}}});
 handle('catalog',()=>({items:[work],hasMore:false,nextOffset:1,label:'测试',source:'local'}));handle('series',()=>({...work,episodes:ids.map((id,i)=>({id,order:i+1,duration:10}))}));
 handle('library',()=>library);handle('progress',v=>(library={...library,history:[{...v,updatedAt:Date.now()}]}));
 handle('playback',async(id,force)=>{const start=performance.now();const value=await media.prepare(id,force);playbacks.push({id,ms:performance.now()-start});return value});
 handle('buffer-episodes',ids=>{windows.push(ids);return media.setBufferWindow(ids)});handle('buffer-state',()=>media.bufferState());handle('buffer-retry',()=>media.retryBuffer());
 handle('update-state',()=>({status:'current',currentVersion:'test',message:'测试'}));
 const w=new BrowserWindow({width:1280,height:800,webPreferences:{preload:${JSON.stringify(path.resolve('dist/main/preload.cjs'))},contextIsolation:true,nodeIntegration:false,sandbox:true}});await w.loadFile(${JSON.stringify(path.resolve('dist/renderer/index.html'))});
});
app.on('window-all-closed',()=>{media?.close().then(()=>{server?.close();app.quit()})});
`);
let app,page;const errors=[],events=[];let snapshot;
const ids=Array.from({length:8},(_,i)=>String(7695386527160863700n+BigInt(i)));
try{
 app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main]});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 const state=()=>app.evaluate(()=>global.qa());
 const until=async check=>{for(let i=0;i<400;i++){const value=await state();if(check(value))return value;await page.waitForTimeout(50)}assert.fail('buffer QA timeout')};
 const playing=async order=>{await page.waitForSelector(`.player[aria-label="第${order}集播放器"] video`);await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1;})};
 await page.locator('.work-card').first().click();
 await page.locator('.series-buffer').getByText(/第 1 集 · 下载 50%/).waitFor();
 const bar=page.getByRole('progressbar',{name:'整剧已缓存集数'});assert.equal(await bar.getAttribute('value'),'0');assert.equal(await bar.getAttribute('max'),'8');
 const bounds=await bar.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<800,'progress must be visible above the player');
 await page.screenshot({path:path.join(output,'cache-downloading.png')});events.push('visible progress bar reports 0/8 while episode 1 downloads at 50%, using real bytes');
 await playing(1);await page.getByRole('button',{name:'暂停',exact:true}).click();
 snapshot=await until(s=>s.buffer.status==='complete');assert.deepEqual(snapshot.requests,ids);assert.deepEqual(snapshot.windows.at(-1),ids);assert.equal(snapshot.completed.length,8);
 await page.locator('.series-buffer').getByText('已缓存 8/8 集',{exact:true}).waitFor();await page.locator('.series-buffer').getByText('全剧已缓存',{exact:true}).waitFor();assert.equal(await bar.getAttribute('value'),'8');
 events.push('opening episode 1 prepares every episode, beyond five, while paused; UI reports 8/8 complete');
 await page.screenshot({path:path.join(output,'full-series-ready.png')});
 // Make the fixture content endpoint unavailable; cached video still has to decode at 2x.
 await app.evaluate(()=>global.goOffline());
 await page.getByRole('combobox',{name:'播放倍速'}).selectOption('2');
 await page.getByRole('button',{name:'切换全屏'}).click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.evaluate(()=>{window.qaSurface=document.fullscreenElement});
 await page.locator('.fullscreen-cache').getByText(/整剧缓存 8\/8 集 · 100%/).waitFor();
 await page.getByRole('button',{name:'下一集',exact:true}).click();await playing(2);
 assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),2);
 assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaSurface),true);
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.25;});await playing(3);
 assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),2);
 assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaSurface),true);events.push('cached episodes 2 and 3 play at 2x via manual next and natural ended in fullscreen with content network unavailable');
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('button',{name:'切换全屏'}).click();await page.waitForFunction(()=>!document.fullscreenElement);
 await page.getByRole('button',{name:'播放第8集',exact:true}).click();await playing(8);await page.getByRole('button',{name:'暂停',exact:true}).click();
 snapshot=await until(s=>s.windows.at(-1)?.[0]===ids[7]);assert.deepEqual(snapshot.windows.at(-1),[ids[7],...ids.slice(0,7)]);assert.deepEqual(snapshot.requests,ids);
 assert.ok(snapshot.playbacks.slice(1).every(p=>p.ms<100),'complete caches must resolve without download or transcode');
 await page.getByRole('button',{name:'返回',exact:true}).click();snapshot=await until(s=>s.windows.at(-1)?.length===0);assert.equal(snapshot.completed.length,8);
 events.push('jump to final episode retains the entire work; leaving detail cancels preparation without deleting completed files');
 await app.close();app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main]});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await app.evaluate(()=>global.goOffline());await page.locator('.work-card').first().click();await playing(1);await page.getByRole('button',{name:'暂停',exact:true}).click();
 snapshot=await until(s=>s.buffer.status==='complete');assert.deepEqual(snapshot.requests,[]);assert.equal(snapshot.buffer.ready,8);assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),2);
 events.push('real application restart preserves 8/8 full cache and 2x speed with zero source downloads');
 assert.deepEqual(errors,[]);snapshot=await state();await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,events,errors,snapshot},null,2));console.log(JSON.stringify({passed:true,events,playbacks:snapshot.playbacks,output},null,2));
}catch(error){await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,events,errors,failure:error.message,snapshot,text:await page?.locator('body').innerText().catch(()=>undefined)},null,2));throw error}
finally{if(app)await app.close()}
