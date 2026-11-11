// Isolated Electron renderer test: actual fullscreen and real local test media.
// Uses a fixture preload instead of accessing content services or personal data.
import {_electron as electron} from 'playwright-core';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const output=path.resolve(`outputs/fullscreen-qa-${Date.now()}`);await mkdir(output,{recursive:true});
execFileSync(path.resolve('runtime-bundle/ffmpeg.exe'),['-y','-f','lavfi','-i','color=c=blue:s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-t','10','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(output,'fixture.mp4')],{stdio:'ignore',windowsHide:true});
const version=JSON.parse(await readFile('package.json','utf8')).version;
const preload=path.join(output,'preload.cjs');
await writeFile(preload,`
const {contextBridge}=require('electron');
const work={id:'fixture',title:'全屏回归测试',cover:'',description:'本地测试视频',total:3};
const episodes=[1,2,3].map(order=>({id:String(order),order,duration:10}));
let library={favorites:[],history:[]};
const ok=data=>Promise.resolve({ok:true,data});
const update={status:'current',currentVersion:${JSON.stringify(version)},message:'当前已是最新版本。'};
contextBridge.exposeInMainWorld('desktop',{
 bufferEpisodes:()=>ok({status:'complete',total:3,ready:3,failed:0,message:'全剧已缓存'}),bufferState:()=>ok({status:'complete',total:3,ready:3,failed:0,message:'全剧已缓存'}),retryBuffer:()=>ok({status:'complete',total:3,ready:3,failed:0,message:'全剧已缓存'}),
 catalog:()=>ok({items:[work],hasMore:false,nextOffset:1,label:'推荐榜',source:'fixture'}),search:()=>ok({items:[work]}),
 series:()=>ok({...work,episodes}),library:()=>ok(library),favorite:()=>ok(library),
 progress:value=>{library={...library,history:[{...value,updatedAt:Date.now()}]};return ok(library);},
 playback:async id=>{await new Promise(resolve=>setTimeout(resolve,350));return {ok:true,data:{url:new URL('fixture.mp4',location.href).href,duration:10,episodeId:id,definition:'测试'}};},
 updateState:()=>ok(update),checkUpdate:()=>ok(update),onUpdate:()=>()=>{},
});`);
// file URL in the fixture must be absolute; preload location is renderer page URL.
let fixturePreload=await readFile(preload,'utf8');
fixturePreload=fixturePreload.replace("new URL('fixture.mp4',location.href).href","'manju-media://fixture/'+id");
await writeFile(preload,fixturePreload);
const main=path.join(output,'main.cjs');
await writeFile(main,`const {app,BrowserWindow,protocol,net}=require('electron');protocol.registerSchemesAsPrivileged([{scheme:'manju-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);app.setPath('userData',${JSON.stringify(path.join(output,'profile'))});app.whenReady().then(()=>{protocol.handle('manju-media',()=>net.fetch(${JSON.stringify(pathToFileURL(path.join(output,'fixture.mp4')).href)}));const w=new BrowserWindow({width:1280,height:800,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadFile(${JSON.stringify(path.resolve('dist/renderer/index.html'))});});app.on('window-all-closed',()=>app.quit());`);
let app;let page;const errors=[];const events=[];
try{
 app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main]});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.work-card').first().click();
 const playing=async order=>{
  await page.waitForSelector(`.player[aria-label="第${order}集播放器"] video`);
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1;});
 };
 await playing(1);await page.getByRole('combobox',{name:'播放倍速'}).selectOption('1.5');
 await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
 await page.evaluate(()=>{window.qaEntered=new Promise(resolve=>document.addEventListener('fullscreenchange',resolve,{once:true}));});await page.getByRole('button',{name:'切换全屏'}).click();
 await page.evaluate(()=>window.qaEntered.then(()=>undefined));
 await page.waitForFunction(()=>!!document.fullscreenElement);
 await page.evaluate(()=>{window.qaFullscreen=document.fullscreenElement;window.qaFullscreenChanges=0;window.qaFullscreenLog=[];document.addEventListener('fullscreenchange',()=>{window.qaFullscreenChanges++;window.qaFullscreenLog.push({time:performance.now(),element:document.fullscreenElement?.className,connected:window.qaFullscreen.isConnected});});});
 const bottom=await page.locator('.player-controls').evaluate(el=>getComputedStyle(el).position);
 assert.equal(bottom,'absolute','fullscreen controls must overlay the video instead of reserving a bottom strip');
 await page.mouse.move(200,150);await page.waitForTimeout(3200);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.player-controls')).opacity==='0');
 const stage=await page.locator('.video-stage').boundingBox();assert.ok(Math.abs(stage.height-(await page.evaluate(()=>innerHeight)))<=2);
 await page.screenshot({path:path.join(output,'immersive.png')});events.push('fullscreen video fills viewport and controls hide during inactivity');
 await page.mouse.move(240,160);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.player-controls')).opacity==='1');
 await page.getByRole('button',{name:'下一集',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaFullscreen),true);
 await playing(2);assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),1.5,'manual next must preserve speed');assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaFullscreen),true);
 events.push('manual next keeps the exact fullscreen element');
 await page.mouse.move(250,170);await page.getByRole('button',{name:'上一集',exact:true}).click();await playing(1);
 assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaFullscreen),true);events.push('manual previous keeps fullscreen');
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.25;});
 await playing(2);assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaFullscreen),true);
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.25;});
 await playing(3);assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),1.5,'autoplay must preserve speed');assert.equal(await page.evaluate(()=>document.fullscreenElement===window.qaFullscreen),true);
 assert.equal(await page.evaluate(()=>window.qaFullscreenChanges),0);events.push('two natural ended events autoplay without exiting fullscreen');
 const saved=(await page.evaluate(()=>window.desktop.library())).data.history[0];assert.equal(saved.order,2);assert.ok(saved.time>9);
 await page.mouse.move(260,180);await page.getByRole('button',{name:'暂停',exact:true}).click();await page.waitForTimeout(3200);
 assert.equal(await page.locator('.player-controls').evaluate(el=>getComputedStyle(el).opacity),'1');events.push('paused controls stay visible');
 await page.getByRole('button',{name:'切换全屏'}).click();await page.waitForFunction(()=>!document.fullscreenElement);
 await page.getByRole('button',{name:'播放第2集',exact:true}).click();await playing(2);assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false);events.push('explicit fullscreen exit remains respected after episode changes');
 await app.close();app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main]});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.locator('.work-card').first().click();await playing(1);
 assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),1.5,'application restart must preserve speed');
 await page.getByRole('combobox',{name:'播放倍速'}).selectOption('2');await page.getByRole('button',{name:'下一集',exact:true}).click();await playing(2);
 assert.equal(await page.locator('video').evaluate(v=>v.playbackRate),2,'changed speed must immediately carry forward');
 events.push('speed survives manual next, autoplay, application restart, and a later speed change');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,events,output},null,2));
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,events,errors},null,2));
}catch(error){const state=await page?.evaluate(()=>{const v=document.querySelector('video');return {text:document.body.innerText,video:v&&{time:v.currentTime,paused:v.paused,ended:v.ended,ready:v.readyState,error:v.error?.message},fullscreen:!!document.fullscreenElement,sameSurface:window.qaFullscreen===document.querySelector('.player-surface'),connected:window.qaFullscreen?.isConnected,log:window.qaFullscreenLog};}).catch(()=>undefined);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,events,errors,failure:error.message,state},null,2));throw error;}
finally{if(app)await app.close();}
