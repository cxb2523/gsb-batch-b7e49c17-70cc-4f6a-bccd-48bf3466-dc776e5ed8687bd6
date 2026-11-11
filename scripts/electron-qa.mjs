import {_electron as electron} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=process.env.QA_OUTPUT||'outputs';await mkdir(output,{recursive:true});
const profile=path.resolve(process.env.QA_PROFILE||`outputs/electron-qa-${Date.now()}`);
const executablePath=process.env.QA_EXECUTABLE;
const report={generatedAt:new Date().toISOString(),packaged:!!executablePath,events:[],errors:[],passed:false};
let instance;let page;
const targetId='7695370827507698713';let targetTitle;
const launch=async()=>electron.launch({...(executablePath?{executablePath,args:[]}:{args:['.']}),env:{...process.env,HONGGUO_TEST_DATA:profile}});
async function screenshot(page,file){for(let i=0;i<3;i++){try{await page.bringToFront();await page.evaluate(async()=>{const visible=[...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight);await Promise.race([Promise.allSettled(visible.map(i=>i.decode())),new Promise(r=>setTimeout(r,10000))]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});await page.screenshot({path:file});return}catch(e){if(i===2)throw e;await page.waitForTimeout(500)}}}
const event=value=>{report.events.push(value);console.log(JSON.stringify(value))};
async function ready(page,order){
 await page.waitForSelector(`.player[aria-label="第${order}集播放器"] video`,{timeout:90000});
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=3&&!v.paused&&v.currentTime>0.2},{},{timeout:60000});
 return page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,frames:v.webkitDecodedFrameCount,audioBytes:v.webkitAudioDecodedByteCount}));
}
async function importTarget(page){
 await page.getByRole('button',{name:'导入分享',exact:true}).last().click();
 await page.getByRole('textbox',{name:'分享文本或链接'}).fill('https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/');
 await page.getByRole('button',{name:'导入并收藏'}).click();
 await page.waitForSelector('.episode-grid button',{timeout:60000});
 assert.equal(await page.locator('.episode-grid button').count(),155);
}
try{
 instance=await launch();page=await instance.firstWindow();page.on('pageerror',e=>report.errors.push(e.name));
 await page.evaluate(()=>{window.qaTransitions=[];let previous='';new MutationObserver(()=>{const current=JSON.stringify({dialog:!!document.querySelector('[role=dialog]'),detail:!!document.querySelector('.detail-page'),alert:document.querySelector('[role=alert]')?.textContent,toast:document.querySelector('.toast')?.textContent});if(current!==previous){window.qaTransitions.push(current);previous=current}}).observe(document.body,{subtree:true,childList:true,characterData:true})});
 await page.waitForSelector('.work-card',{timeout:60000});
 await page.waitForFunction(()=>[...document.querySelectorAll('.work-card img')].some(i=>i.complete&&i.naturalWidth>0),{},{timeout:30000});
 await screenshot(page,path.join(output,'desktop-home.png'));
 event({step:'home',cards:await page.locator('.work-card').count(),loadedCovers:await page.locator('.work-card img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth>0).length)});
 const recommended=await page.locator('.work-card h3').first().innerText();await page.locator('.work-card').first().click();
 await page.waitForSelector('.detail-heading h1',{timeout:60000});assert.equal(await page.locator('.detail-heading h1').innerText(),recommended);
 event({step:'recommendation-opens-correct-series',title:recommended,...await ready(page,1)});
 await page.getByRole('button',{name:'返回',exact:true}).click();
 const target=await page.evaluate(id=>window.desktop.series(id),targetId);assert.equal(target.ok,true);assert.equal(target.data.id,targetId);targetTitle=target.data.title;
 await page.getByRole('textbox',{name:'搜索漫剧名称'}).fill('到末世十年后竟然遇到四个尸王');
 await page.getByRole('button',{name:'搜索',exact:true}).click();await page.waitForSelector('.work-card',{timeout:60000});
 const search=await page.evaluate(()=>window.desktop.search('到末世十年后竟然遇到四个尸王'));assert.equal(search.ok,true);assert.ok(search.data.items.some(work=>work.id===targetId));await page.locator('.work-grid .work-card h3').filter({hasText:targetTitle}).waitFor();event({step:'search-ui',matched:true,id:targetId,title:targetTitle});
 await importTarget(page);
 const ended=[];await page.exposeFunction('qaEnded',v=>ended.push(v));
 await page.evaluate(()=>{document.addEventListener('ended',e=>{if(e.target instanceof HTMLVideoElement)window.qaEnded({duration:e.target.duration,time:e.target.currentTime,frames:e.target.webkitDecodedFrameCount,audioBytes:e.target.webkitAudioDecodedByteCount})},true)});
 for(const order of [1,2,3]){
  const info=await ready(page,order);assert.ok(info.frames>0&&info.audioBytes>0);event({step:'playing',order,...info});
  await page.getByRole('combobox',{name:'播放倍速'}).selectOption('2');
  if(order===1){
   await page.getByRole('slider',{name:'音量',exact:true}).fill('0.5');assert.equal(await page.locator('video').evaluate(v=>v.volume),0.5);
   await page.getByRole('slider',{name:'播放进度'}).fill('12');await page.waitForFunction(()=>document.querySelector('video').currentTime>=12);
   await page.getByRole('button',{name:'切换全屏'}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
   await page.getByRole('button',{name:'切换全屏'}).click();await page.waitForFunction(()=>!document.fullscreenElement);
   await screenshot(page,path.join(output,'desktop-playing.png'));event({step:'seek-volume-speed-fullscreen',passed:true});
   await page.getByRole('slider',{name:'播放进度'}).fill('0');
  }
  await page.waitForFunction(n=>document.querySelector('.player')?.getAttribute('aria-label')===`第${n+1}集播放器`,order,{timeout:60000});
 }
 assert.equal(ended.length,3);for(const e of ended)assert.ok(Math.abs(e.time-e.duration)<0.1&&e.frames>0&&e.audioBytes>0);event({step:'three-episodes-ended-and-autonext',ended});
 for(const order of [78,155]){
  await page.getByRole('button',{name:`播放第${order}集`,exact:true}).click();event({step:'random-episode',order,...await ready(page,order)});
  await page.getByRole('slider',{name:'播放进度'}).fill('10');await page.waitForFunction(()=>document.querySelector('video').currentTime>=10);
 }
 await page.getByRole('button',{name:'播放第1集',exact:true}).click();await ready(page,1);
 await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('error')));await ready(page,1);
 await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('error')));await page.getByRole('button',{name:'重试当前集'}).waitFor();
 await page.getByRole('button',{name:'重试当前集'}).click();await ready(page,1);event({step:'media-error-once-automatic-then-manual-retry',passed:true});
 await page.getByRole('slider',{name:'播放进度'}).fill('12');await page.getByRole('button',{name:'暂停',exact:true}).click();
 const closed=instance.waitForEvent('close',{timeout:30000});await instance.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close()});await closed;instance=null;
 instance=await launch();page=await instance.firstWindow();page.on('pageerror',e=>report.errors.push(e.name));
 await page.getByRole('button',{name:/我的收藏/}).click();await page.waitForSelector('.work-card',{timeout:60000});
 const saved=await page.evaluate(()=>window.desktop.library());assert.ok(saved.ok);const history=saved.data.history.find(p=>p.seriesId==='7695370827507698713');assert.equal(history.order,1);assert.ok(history.time>=12&&history.time<15);
 await page.locator('.work-card').filter({hasText:targetTitle}).click();await ready(page,1);
 const resumed=await page.locator('video').evaluate(v=>v.currentTime);assert.ok(resumed>=12&&resumed<17);event({step:'close-reopen-favorite-resume',saved:history.time,resumed});
 await page.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'发现',exact:true}).click();await page.waitForSelector('.work-card',{timeout:60000});
 await instance.evaluate(()=>{globalThis.qaFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError('QA_OFFLINE')}});
 await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('alert').waitFor({timeout:60000});
 assert.match(await page.getByRole('alert').innerText(),/网络/);
 await instance.evaluate(()=>{globalThis.fetch=globalThis.qaFetch;delete globalThis.qaFetch});await page.getByRole('button',{name:'重新尝试',exact:true}).click();await page.waitForSelector('.work-card',{timeout:60000});event({step:'network-error-retry',passed:true});
 await page.waitForSelector('.resume-card');await screenshot(page,path.join(output,'desktop-home-history.png'));event({step:'homepage-resume-cards',count:await page.locator('.resume-card').count()});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){if(page&&!page.isClosed()){report.transitions=await page.evaluate(()=>window.qaTransitions);await writeFile(path.join(output,'qa-failure.txt'),await page.locator('body').innerText());await screenshot(page,path.join(output,'qa-failure.png')).catch(()=>{})}report.failure=e.message;console.error(e.message);process.exitCode=1}
finally{if(instance)await instance.close();await writeFile(path.join(output,'electron-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,errors:report.errors,failure:report.failure}))}
