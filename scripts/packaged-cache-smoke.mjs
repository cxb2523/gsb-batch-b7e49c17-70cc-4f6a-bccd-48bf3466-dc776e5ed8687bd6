// Isolated packaged app with no developer runtimes on PATH; prepare only one source episode.
import {_electron as electron} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve(`outputs/packaged-cache-smoke-${Date.now()}`);await mkdir(output,{recursive:true});
const executablePath=path.resolve(process.env.QA_EXECUTABLE||'release/win-unpacked/红果漫剧桌面版.exe');
const env={...process.env,HONGGUO_TEST_DATA:path.join(output,'profile'),PATH:`${process.env.SystemRoot}/System32;${process.env.SystemRoot}`,JAVA_HOME:'',NODE_PATH:'',PYTHONHOME:''};
let app,page;const report={passed:false,events:[],errors:[]};
const quit=async()=>{const closed=app.waitForEvent('close');await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0)});await closed;app=null};
try{
 app=await electron.launch({executablePath,args:[],env});page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
 const runtime=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,path:process.env.PATH}));assert.equal(runtime.version,'0.3.0');assert.ok(runtime.packaged);assert.doesNotMatch(runtime.path,/node|python|jdk/i);
 await page.getByRole('button',{name:'缓存中心',exact:true}).click();await page.getByRole('heading',{name:'缓存中心',exact:true}).waitFor();
 const initial=await page.evaluate(()=>window.desktop.cacheState());assert.ok(initial.ok);assert.equal(initial.data.tasks.length,0);assert.ok(initial.data.closeToTray);
 report.events.push('packaged 0.3.0 starts without developer runtimes; cache center and real IPC initialize');
 const source=await page.evaluate(async()=>{const result=await window.desktop.series('7695370827507698713');return result.ok?{ok:true,title:result.data.title,total:result.data.total,id:result.data.episodes[0].id}:{ok:false,error:result.error}});assert.ok(source.ok,source.error?.message);
 const start=performance.now();const playback=await page.evaluate(id=>window.desktop.playback(id),source.id);assert.ok(playback.ok,playback.error?.message);const ms=Math.round(performance.now()-start);
 await page.evaluate(async resource=>{const v=document.createElement('video');v.src=resource.url;v.style.width='400px';document.body.append(v);await v.play()},playback.data);
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>.2&&v.webkitDecodedFrameCount>0&&v.webkitAudioDecodedByteCount>0},{},{timeout:60000});
 report.media=await page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,frames:v.webkitDecodedFrameCount,audioBytes:v.webkitAudioDecodedByteCount}));report.media.prepareMs=ms;report.media.definition=playback.data.definition;
 await page.locator('video').evaluate(v=>v.pause());assert.ok(report.media.duration>30);report.events.push('one real source episode prepares using bundled Java/SDK/FFmpeg and decodes picture plus sound; no full-series downloads requested');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await quit();app=await electron.launch({executablePath,args:[],env});page=await app.firstWindow();
 const cached=await page.evaluate(async id=>{const start=performance.now(),result=await window.desktop.playback(id);return {result,ms:performance.now()-start}},source.id);assert.ok(cached.result.ok);assert.ok(cached.ms<500);assert.equal(cached.result.data.url,playback.data.url);
 report.events.push('packaged tray close/reopen and explicit quit work; restarted app reuses the exact completed cache');assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.message;process.exitCode=1}
finally{if(app)await quit();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output},null,2))}
