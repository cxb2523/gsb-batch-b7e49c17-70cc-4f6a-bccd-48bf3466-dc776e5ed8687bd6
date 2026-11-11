// Production main, preload and renderer; only ContentProvider is replaced at build time.
// Generated local media avoids downloading full online series during queue verification.
import {_electron as electron} from 'playwright-core';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp,copyFile,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve(`outputs/cache-center-qa-${Date.now()}`),main=path.join(output,'main/main.cjs'),profile=path.join(output,'profile'),parent=path.join(output,'ssd');
await mkdir(path.dirname(main),{recursive:true});await mkdir(parent,{recursive:true});
const video=path.join(output,'fixture.mp4');
execFileSync(path.resolve('runtime-bundle/ffmpeg.exe'),['-y','-f','lavfi','-i','testsrc2=s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-t','10','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video],{stdio:'ignore',windowsHide:true});
const provider=`
const fs=require('node:fs/promises'),http=require('node:http');
export class ProviderError extends Error{}
const works=Array.from({length:3},(_,n)=>({id:String(7695370827507698700n+BigInt(n)),title:['云海来信第一季','云海来信第二季','长街旧梦'][n],cover:'',description:'末世冒险 · 本地生成测试视频，不是线上作品',categories:['冒险'],total:8,episodes:Array.from({length:8},(_,i)=>({id:String(7695386527160863700n+BigInt(n*10+i)),order:i+1,duration:10}))}));
let offline=false,fail=true,active=0,maxActive=0,requests=[],server;
const ready=(async()=>{const bytes=await fs.readFile(${JSON.stringify(video)});server=http.createServer((req,res)=>{
 if(req.url.startsWith('/cover')){const n=Number(req.url.match(/\\d/)[0]);res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="320"><rect width="220" height="320" fill="'+['#7d8e9c','#776b89','#b28a68'][n]+'"/><circle cx="110" cy="90" r="45" fill="#f5ead5" opacity=".8"/><path d="M0 250L90 130L150 220L220 160V320H0" fill="#293f4a"/><text x="110" y="290" text-anchor="middle" fill="white" font-size="25">本地验收</text></svg>');return;}
 requests.push(req.url.slice(1));if(offline||(fail&&req.url==='/'+works[1].episodes[2].id)){res.writeHead(503);res.end();return;}
 active++;maxActive=Math.max(maxActive,active);res.once('close',()=>active--);res.writeHead(200,{'content-type':'video/mp4'});const half=Math.ceil(bytes.length/2);res.write(bytes.subarray(0,half));setTimeout(()=>res.end(bytes.subarray(half)),1500);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));for(let i=0;i<works.length;i++)works[i].cover='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="320"><rect width="220" height="320" fill="'+['#7d8e9c','#776b89','#b28a68'][i]+'"/><circle cx="110" cy="90" r="45" fill="#f5ead5"/><path d="M0 250L90 130L150 220L220 160V320H0" fill="#293f4a"/><text x="110" y="290" text-anchor="middle" fill="white" font-size="25">本地验收</text></svg>').toString('base64');return bytes;})();
global.qa=()=>({requests,maxActive,active});global.offline=()=>{offline=true};global.recover=()=>{fail=false};
export class ContentProvider{
 constructor(){}
 async catalog(){await ready;return {items:works,hasMore:false,nextOffset:3,label:'本地验收',source:'local'}}
 async search(){return this.catalog()}
 async getSeries(id){await ready;return works.find(w=>w.id===id)}
 async resolveShare(text){await ready;return works[Number(text.slice(-1))-1]}
 async getResource(id){const bytes=await ready;return {episodeId:id,duration:10,definition:'360p',codec:'h264',encrypted:false,url:'http://127.0.0.1:'+server.address().port+'/'+id,size:bytes.length}}
}
`;
await build({entryPoints:['src/main/main.ts'],outfile:main,bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent',plugins:[{name:'local-provider',setup(build){build.onLoad({filter:/[\\/]main[\\/]provider\.ts$/},()=>({contents:provider,loader:'js'}))}}]});
await copyFile('dist/main/preload.cjs',path.join(output,'main/preload.cjs'));await cp('dist/renderer',path.join(output,'renderer'),{recursive:true});await symlink(path.resolve('runtime-bundle'),path.join(output,'main/runtime-bundle'),'junction');
const workIds=Array.from({length:3},(_,i)=>String(7695370827507698700n+BigInt(i)));
const titleById=new Map(workIds.map((id,i)=>[id,['云海来信第一季','云海来信第二季','长街旧梦'][i]]));
const task=(state,id)=>state.tasks.find(item=>item.series.id===id);
let app,page;const events=[],errors=[];let snapshot;
const launch=async()=>{app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main],env:{...process.env,HONGGUO_TEST_DATA:profile}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'缓存中心',exact:true}).click()};
const state=async()=>{const result=await page.evaluate(()=>window.desktop.cacheState());assert.ok(result.ok,result.error?.message);return result.data};
const until=async check=>{for(let i=0;i<1000;i++){snapshot=await state();if(check(snapshot))return snapshot;await page.waitForTimeout(60)}assert.fail('cache center QA timeout')};
try{
 await launch();
 assert.equal((await state()).concurrency,4);
 await page.getByRole('combobox',{name:'缓存并行数'}).selectOption('6');await until(s=>s.concurrency===6);
 await page.getByRole('combobox',{name:'缓存并行数'}).selectOption('4');await until(s=>s.concurrency===4);
 events.push('cache center defaults to four and user changes concurrency through production IPC');
 await page.getByRole('button',{name:'发现',exact:true}).click();await page.locator('.work-card').first().click();await page.locator('.series-buffer').getByText(/第 1 集 · 下载/).waitFor();
 await page.locator('.playback-recommendations .work-card').filter({hasText:'云海来信第二季'}).waitFor({timeout:30000});
 assert.equal(await page.locator('.related-grid').first().locator('.work-card').first().innerText().then(t=>t.includes('云海来信第二季')),true);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1400,1200));await page.waitForTimeout(200);await page.locator('.playback-recommendations').evaluate(el=>{const scroller=document.querySelector('.content-scroll');scroller.scrollTop+=el.getBoundingClientRect().top-scroller.getBoundingClientRect().top-30});await page.waitForTimeout(200);await page.screenshot({path:path.join(output,'recommendations.png')});
 await page.locator('.playback-recommendations .work-card').filter({hasText:'云海来信第二季'}).click();await page.locator('.detail-heading h1').filter({hasText:'云海来信第二季'}).waitFor();
 await page.getByRole('button',{name:'发现',exact:true}).click();await page.locator('.work-card').first().click();
 events.push('playback page prioritizes title-matched second season then topic-related works; recommendation opens correct series');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=1},{},{polling:100});
 assert.equal(await page.locator('video').evaluate(v=>v.paused&&v.currentTime===0),true);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());await page.getByRole('button',{name:'缓存中心',exact:true}).click();
 events.push('closing during media preparation cannot autoplay a late resource or advance watching history in tray');
 for(let i=1;i<=3;i++){await page.getByRole('textbox',{name:'后台缓存分享链接'}).fill('fixture'+i);await page.getByRole('button',{name:'添加缓存',exact:true}).click();await until(s=>task(s,workIds[i-1])?.registered)}
 assert.deepEqual(new Set((await state()).tasks.filter(item=>item.registered).map(item=>item.series.id)),new Set(workIds));
 await page.getByRole('article',{name:`${titleById.get(workIds[2])}缓存任务`,exact:true}).waitFor();assert.equal(await page.locator('.cache-task').count(),3);
 await until(s=>s.tasks.filter(t=>t.state.ready>0).length>=2);
 const middle=page.getByRole('article',{name:`${titleById.get(workIds[1])}缓存任务`,exact:true});await middle.getByRole('button',{name:'暂停缓存',exact:true}).click();await until(s=>task(s,workIds[1])?.paused);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1400,1200));await page.waitForTimeout(150);await page.locator('.content-scroll').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(150);
 await page.screenshot({path:path.join(output,'cache-center.png')});
 events.push('three works registered idempotently through UI, including automatically discovered next-season task; tasks identified by work id/title; bounded concurrent progress and per-work pause shown');
 const before=(await state()).tasks.reduce((sum,t)=>sum+t.state.ready,0);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await until(s=>s.tasks.reduce((sum,t)=>sum+t.state.ready,0)>before);
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus()});
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
 events.push('production close handler hides window without exiting; completed count grows while hidden; reopen succeeds');
 await middle.getByRole('button',{name:'继续缓存',exact:true}).click();
 await until(s=>task(s,workIds[1])?.state.failed>0);await app.evaluate(()=>global.recover());
 await middle.getByRole('button',{name:'重试失败',exact:true}).click();
 await until(s=>s.tasks.every(t=>t.state.status==='complete'));
 const requests=await app.evaluate(()=>global.qa());assert.ok(requests.maxActive<=6);assert.ok(requests.maxActive>=3);assert.equal(snapshot.tasks.reduce((sum,t)=>sum+t.state.ready,0),24);
 events.push('resume and scoped retry prepare all 24 episodes; media concurrency remains bounded and exceeds two with configured four');
 const oldDirectory=snapshot.directory;
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},parent);
 await page.getByRole('button',{name:'更换目录并迁移',exact:true}).click();
 await until(s=>!s.migrating&&s.directory===path.join(parent,'HongguoManjuCache'));
 assert.equal(snapshot.usedBytes>0,true);const oldFiles=await (await import('node:fs/promises')).readdir(oldDirectory);assert.equal(oldFiles.filter(n=>n.endsWith('.mp4')).length,24);
 events.push('production directory dialog IPC migrates all 24 media files with checksum and retains source files');
 await app.evaluate(()=>global.offline());await page.getByRole('article',{name:`${titleById.get(workIds[0])}缓存任务`,exact:true}).getByRole('button',{name:'继续观看'}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.2&&v.videoWidth===640});
 assert.ok(await page.locator('video').evaluate(v=>v.webkitAudioDecodedByteCount>0));
 await page.getByRole('combobox',{name:'播放倍速'}).selectOption('2');if(await page.getByRole('checkbox').isChecked())await page.locator('.now-playing .toggle-label').click();assert.equal(await page.getByRole('checkbox').isChecked(),false);await page.getByRole('button',{name:'切换全屏'}).click();
 await page.waitForFunction(()=>!!document.fullscreenElement);await page.evaluate(()=>{window.qaFullscreen=document.fullscreenElement});
 await page.getByRole('button',{name:'下一集',exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector('video');return document.querySelector('.player')?.getAttribute('aria-label')==='第2集播放器'&&v&&!v.paused&&v.currentTime>.1&&v.playbackRate===2&&document.fullscreenElement===window.qaFullscreen});
 await page.getByRole('button',{name:'切换全屏'}).click();await page.getByRole('button',{name:'播放第8集',exact:true}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('video');return document.querySelector('.player')?.getAttribute('aria-label')==='第8集播放器'&&v&&v.readyState>=2});
 await page.locator('video').evaluate(async v=>{v.currentTime=v.duration-.2;await v.play().catch(()=>{})});
 await page.waitForFunction(async()=>{const r=await window.desktop.library();return r.data.history.some(p=>p.order===8&&p.time/p.duration>=.95)});
 events.push('autoNext disabled through its visible label; real final-episode playback writes watched status for cleanup without advancing into the cached next season');
 assert.deepEqual((await app.evaluate(()=>global.qa())).requests,requests.requests);
 events.push('migrated cache decodes video and audio offline, next episode keeps fullscreen and 2x with zero new source requests');
 // Exercise actual before-quit/window-beforeunload cleanup rather than Playwright force-close.
 const quit=app.waitForEvent('close');await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0)});await quit;app=null;
 await launch();await app.evaluate(()=>global.offline());await until(s=>s.tasks.length===3&&s.tasks.every(t=>t.state.ready===8));
 assert.equal(snapshot.directory,path.join(parent,'HongguoManjuCache'));assert.deepEqual((await app.evaluate(()=>global.qa())).requests,[]);
 assert.equal(snapshot.concurrency,4);const initialBytes=snapshot.usedBytes;
 const libraryBefore=await page.evaluate(()=>window.desktop.library());
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})});
 await page.getByRole('article',{name:`${titleById.get(workIds[1])}缓存任务`,exact:true}).getByRole('button',{name:'删除缓存',exact:true}).click();await page.waitForTimeout(200);assert.equal((await state()).tasks.length,3);assert.equal((await state()).usedBytes,initialBytes);
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})});
 await page.getByRole('article',{name:`${titleById.get(workIds[1])}缓存任务`,exact:true}).getByRole('button',{name:'删除缓存',exact:true}).click();await until(s=>s.tasks.length===2);assert.ok(snapshot.usedBytes<initialBytes);
 const bytesAfterOne=snapshot.usedBytes;
 await page.getByRole('button',{name:'清理已看完缓存',exact:true}).click();await until(s=>s.tasks.length===1);assert.ok(snapshot.usedBytes<bytesAfterOne);assert.deepEqual(snapshot.tasks.map(item=>item.series.id),[workIds[2]]);
 assert.deepEqual(await page.evaluate(()=>window.desktop.library()),libraryBefore);
 const files=await (await import('node:fs/promises')).readdir(snapshot.directory);assert.equal(files.filter(n=>n.endsWith('.mp4')).length,8);assert.equal(files.filter(n=>n.endsWith('.json')).length,8);
 events.push('deletion cancel preserves bytes; confirmed deletion frees actual media/index files; one-click watched cleanup preserves unfinished work, favorites and history');
 const quitAgain=app.waitForEvent('close');await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0)});await quitAgain;app=null;await launch();await until(s=>s.tasks.length===1&&task(s,workIds[2])?.state.ready===8);
 assert.equal(snapshot.usedBytes,bytesAfterOne/2);assert.deepEqual((await app.evaluate(()=>global.qa())).requests,[]);
 events.push('deleted queue and media stay deleted after restart with no re-download');
 await page.screenshot({path:path.join(output,'cache-center-complete.png')});
 events.push('explicit quit completes cleanup; restart restores path and all tasks without downloads; deleted tasks stay removed and other tasks and files persist');
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,events,errors,snapshot,requests},null,2));console.log(JSON.stringify({passed:true,events,output},null,2));
}catch(error){await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,events,errors,snapshot,failure:error.message,text:await page?.locator('body').innerText().catch(()=>null)},null,2));throw error}
finally{if(app){const quit=app.waitForEvent('close');await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0)}).catch(()=>{});await quit}}
