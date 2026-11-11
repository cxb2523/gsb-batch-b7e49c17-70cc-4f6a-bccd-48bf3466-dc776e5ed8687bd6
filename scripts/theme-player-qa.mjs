import {_electron as electron} from 'playwright-core';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real player surface with a locally generated video and mocked content metadata.
const output=path.resolve(`outputs/theme-player-qa-${Date.now()}`);await mkdir(output,{recursive:true});
const video=path.join(output,'fixture.mp4'),ffmpeg=path.resolve('runtime-bundle/ffmpeg.exe');
execFileSync(ffmpeg,['-y','-f','lavfi','-i','testsrc2=s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-t','8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video],{stdio:'ignore',windowsHide:true});
await build({entryPoints:['src/main/media.ts'],outfile:path.join(output,'media.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const main=path.join(output,'main.cjs');
await writeFile(main,`
const {app,BrowserWindow,protocol,ipcMain}=require('electron');
const {MediaCache}=require('./media.cjs');const fs=require('node:fs/promises');const http=require('node:http');
protocol.registerSchemesAsPrivileged([{scheme:'manju-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setPath('userData',${JSON.stringify(path.join(output,'profile'))});
const ids=Array.from({length:12},(_,i)=>String(7695386527160863700n+BigInt(i)));
const work={id:'7695370827507698713',title:'到末世十年后竟然遇到四个尸王',cover:'',description:'本地生成视频，用于检查播放页外观。',total:12,categories:['末世','玄幻','逆袭']};
let library={favorites:[],history:[]},media,server;const requests=[];
app.whenReady().then(async()=>{
 const bytes=await fs.readFile(${JSON.stringify(video)});
 server=http.createServer((req,res)=>{requests.push(req.url.slice(1));res.writeHead(200,{'content-type':'video/mp4','content-length':bytes.length});res.end(bytes)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 media=new MediaCache(${JSON.stringify(path.join(output,'cache'))},${JSON.stringify(ffmpeg)},async id=>({episodeId:id,duration:8,definition:'本地测试',codec:'h264',encrypted:false,url:'http://127.0.0.1:'+server.address().port+'/'+id,size:bytes.length}));await media.init();
 protocol.handle('manju-media',request=>media.response(request.url,request.headers.get('range')));
 const handle=(channel,fn)=>ipcMain.handle(channel,async(_event,...args)=>{try{return {ok:true,data:await fn(...args)}}catch(e){return {ok:false,error:{code:e.code,message:e.message}}}});
 handle('catalog',()=>({items:[work],hasMore:false,nextOffset:1,label:'测试',source:'local'}));
 handle('search',()=>({items:[work],hasMore:false,nextOffset:1,label:'搜索结果',source:'local'}));
 handle('series',()=>({...work,episodes:ids.map((id,i)=>({id,order:i+1,duration:8}))}));
 handle('library',()=>library);handle('progress',v=>(library={...library,history:[{...v,updatedAt:Date.now()}]}));
 handle('favorite',(series,enabled)=>(library={...library,favorites:enabled?[series]:library.favorites.filter(item=>item.id!==series.id)}));
 handle('playback',async(id,force)=>{const value=await media.prepare(id,force);return value});
 handle('buffer-episodes',ids=>media.setBufferWindow(ids));handle('buffer-state',()=>media.bufferState());handle('buffer-retry',()=>media.retryBuffer());
 handle('video-quality',()=>true);
 handle('recommendations',()=>({seasons:[],similar:[],message:''}));
 handle('cache-state',()=>({directory:'F:\\\\红果漫剧\\\\media-cache',freeBytes:84181359002,usedBytes:0,migrating:false,tasks:[],closeToTray:true,message:'',concurrency:4,bytesPerSecond:0,limits:{maxGiB:20,bandwidthMiB:0}}));
 handle('update-state',()=>({status:'current',currentVersion:'test',message:'播放页外观检查'}));
 handle('diagnostics-export',()=>({saved:false}));
 const w=new BrowserWindow({width:1400,height:920,backgroundColor:'#f4f0e8',webPreferences:{preload:${JSON.stringify(path.resolve('dist/main/preload.cjs'))},contextIsolation:true,nodeIntegration:false,sandbox:true}});await w.loadFile(${JSON.stringify(path.resolve('dist/renderer/index.html'))});
});
app.on('window-all-closed',()=>{media?.close().then(()=>{server?.close();app.quit()})});
`);
const report={generatedAt:new Date().toISOString(),passed:false,screenshots:[],errors:[]};
let app,page;
const shot=async name=>{const file=path.join(output,`${name}.png`);await page.screenshot({path:file});report.screenshots.push(file)};
const themeName=theme=>({paper:'宣纸书卷',cinema:'午夜影院',neon:'流光',arcade:'像素放映厅'}[theme]);
try{
 app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[main]});
 page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
 await page.locator('.work-card').first().click();
 await page.waitForSelector('.player video',{timeout:30000});
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=2&&!v.paused},null,{timeout:30000});
 await page.waitForTimeout(1200);
 await page.evaluate(()=>document.querySelector('video')?.pause());
 await page.waitForTimeout(250);
 await shot('player-paper');
 for(const theme of ['cinema','neon','arcade']){
  await page.getByRole('button',{name:/外观设置，当前/}).click();
  await page.locator('.appearance-option').filter({hasText:themeName(theme)}).click();
  await page.waitForTimeout(320);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.waitForTimeout(260);
  await shot(`player-${theme}`);
  const surface=await page.evaluate(()=>({controls:getComputedStyle(document.querySelector('.player-controls')).backgroundColor,episode:getComputedStyle(document.querySelector('.episode-grid button.current')).backgroundColor,sleep:!!document.querySelector('.sleep-control')}));
  report[theme]=surface;
  assert.equal(surface.sleep,true);
 }
 await page.getByRole('button',{name:/外观设置，当前/}).click();
 await page.getByRole('button',{name:/恢复默认/}).click();
 await page.waitForTimeout(260);
 await page.getByRole('button',{name:'完成',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'paper');
 await page.locator('.top-import').click();
 await page.getByRole('dialog').waitFor();
 await shot('import-paper');
 await page.getByRole('textbox',{name:'分享文本或链接'}).press('Escape');
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.deepEqual(report.errors,[]);
 report.passed=true;
 console.log(JSON.stringify({passed:true,output,screenshots:report.screenshots,surfaces:{cinema:report.cinema,neon:report.neon,arcade:report.arcade}},null,2));
}catch(error){
 report.failure=error.message;
 console.error(error.message);
 process.exitCode=1;
}finally{
 if(app)await app.close();
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
}