import {_electron as electron} from 'playwright-core';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const executablePath=process.env.QA_EXECUTABLE;
if(!executablePath)throw new Error('QA_EXECUTABLE must be the installed application executable.');
const output=process.env.QA_OUTPUT||'outputs';const profile=path.resolve(`outputs/installed-qa-${Date.now()}`);await mkdir(output,{recursive:true});
const env={...process.env,HONGGUO_TEST_DATA:profile,PATH:`${process.env.SystemRoot}/System32;${process.env.SystemRoot}`,JAVA_HOME:'',PYTHONHOME:'',NODE_PATH:''};
const report={generatedAt:new Date().toISOString(),events:[],errors:[],passed:false};
let app,page;
const launch=async()=>electron.launch({executablePath,args:[],env});
const record=e=>{report.events.push(e);console.log(JSON.stringify(e))};
async function playing(order){await page.waitForSelector(`.player[aria-label="第${order}集播放器"] video`,{timeout:90000});await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>0.3&&!v.paused&&v.webkitDecodedFrameCount>0&&v.webkitAudioDecodedByteCount>0},{},{timeout:60000});return page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,frames:v.webkitDecodedFrameCount,audioBytes:v.webkitAudioDecodedByteCount,time:v.currentTime}))}
try{
 const bundle=path.join(path.dirname(executablePath),'resources','runtime-bundle');
 const manifest=JSON.parse(await readFile(path.join(bundle,'notices','build-manifest.json'),'utf8'));
 for(const entry of manifest.sdk){const hash=createHash('sha256').update(await readFile(path.join(bundle,'sdk',entry.filename))).digest('hex');assert.equal(hash,entry.sha256)}
 record({step:'installed-sdk-hashes',files:manifest.sdk.length,passed:true});
 app=await launch();page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.name));
 const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),executable:app.getPath('exe'),resources:process.resourcesPath,path:process.env.PATH}));
 if(process.env.QA_EXPECTED_VERSION)assert.equal(runtime.version,process.env.QA_EXPECTED_VERSION);
 assert.equal(runtime.packaged,true);assert.equal(path.resolve(runtime.executable).toLowerCase(),path.resolve(executablePath).toLowerCase());assert.doesNotMatch(runtime.path,/node|python|jdk/i);record({step:'installed-runtime-without-development-path',...runtime});
 await page.waitForSelector('.work-card',{timeout:60000});record({step:'installed-home',cards:await page.locator('.work-card').count()});
 for(const label of ['热播榜','新剧榜','推荐榜']){await page.getByRole('tab',{name:label,exact:true}).click();await page.waitForFunction(expected=>document.querySelector('.catalog-body > .section-heading h2')?.textContent===expected,label,{timeout:60000});await page.waitForSelector('.work-card',{timeout:60000});assert.equal(await page.locator('.catalog-body > .section-heading h2').innerText(),label);record({step:'installed-board',label,cards:await page.locator('.work-card').count()})}
 await page.waitForFunction(()=>{const i=document.querySelector('.spotlight img');return i&&i.complete&&i.naturalWidth>0},{},{timeout:30000});await page.screenshot({path:path.join(output,'installed-home.png')});
 await page.getByRole('button',{name:'导入分享',exact:true}).last().click();await page.getByRole('textbox',{name:'分享文本或链接'}).fill('https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/');await page.getByRole('button',{name:'导入并收藏'}).click();await page.waitForSelector('.episode-grid button',{timeout:60000});assert.equal(await page.locator('.episode-grid button').count(),155);
 record({step:'installed-first-episode',...await playing(1)});
 await page.getByRole('slider',{name:'播放进度'}).fill('12');await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.screenshot({path:path.join(output,'installed-playing.png')});
 const closed=app.waitForEvent('close',{timeout:30000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;
 app=await launch();page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.name));
 await page.getByRole('button',{name:/我的收藏/}).click();await page.waitForSelector('.work-card',{timeout:60000});
 const state=await page.evaluate(()=>window.desktop.library());assert.equal(state.ok,true);const history=state.data.history.find(p=>p.seriesId==='7695370827507698713');assert.ok(history.time>=12&&history.time<15);
 await page.locator('.work-card').filter({hasText:history.work.title}).click();const resumed=await playing(1);assert.ok(resumed.time>=12&&resumed.time<17);record({step:'installed-close-reopen-resume',saved:history.time,resumed:resumed.time});
 await page.getByRole('button',{name:'下一集',exact:true}).click();record({step:'installed-next-episode',...await playing(2)});
 await app.close();app=null;
 const normalEnv={...env};delete normalEnv.HONGGUO_TEST_DATA;
 app=await electron.launch({executablePath,args:[],env:normalEnv});page=await app.firstWindow();
 await page.waitForSelector('.work-card',{timeout:60000});
 await page.evaluate(async()=>{await Promise.allSettled([...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight).map(i=>i.decode()))});
 assert.equal(await page.locator('.sidebar').count(),0);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(244, 240, 232)');
 await page.screenshot({path:path.join(output,'installed-default-home.png')});
 record({step:'default-profile-startup',...await app.evaluate(({app})=>({userData:app.getPath('userData'),packaged:app.isPackaged}))});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=e.message;console.error(e.message);if(page&&!page.isClosed())await writeFile(path.join(output,'installed-qa-failure.txt'),await page.locator('body').innerText());process.exitCode=1}
finally{if(app)await app.close();await writeFile(path.join(output,'installed-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failure:report.failure}))}
