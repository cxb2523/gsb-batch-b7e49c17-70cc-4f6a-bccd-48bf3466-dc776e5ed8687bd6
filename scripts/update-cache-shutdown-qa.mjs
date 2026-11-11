// Real NSIS upgrade using an isolated app identity and installation under outputs/.
// Only the content source is replaced. Uses production shutdown/updater/cache code,
// actual Java and FFmpeg, complete media plus an interrupted HTTP Range transfer.
import {_electron as electron} from 'playwright-core';
import {build as bundle} from 'esbuild';
import {build as packageApp,Platform} from 'electron-builder';
import {mkdir,readFile,writeFile,copyFile,cp,readdir,stat,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{load}=require('js-yaml'),{extractFile}=require('@electron/asar');
const root=path.resolve('outputs/update-cache-shutdown-qa'),install=path.join(root,'installed'),profile=path.join(root,'profile');
const executable=path.join(install,'HongguoManjuUpdateQA.exe');
const guid='e081b245-9f5f-47a7-8c43-5ead994aface'; // QA only, never production identity.
const regKey=`HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`;
await mkdir(root,{recursive:true});await rename(profile,path.join(root,`profile-previous-${Date.now()}`)).catch(error=>{if(error.code!=='ENOENT')throw error});await mkdir(profile,{recursive:true});
const clip=path.join(root,'fixture.mp4');
execFileSync(path.resolve('runtime-bundle/ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-t','12','-c:v','libx264','-preset','ultrafast','-crf','22','-g','24','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',clip],{windowsHide:true});
const bytes=await readFile(clip),requests=[],events=[];let release=false,app,page;
const work={id:'7695370827507698790',title:'升级保留缓存验收',cover:'',description:'本地素材',categories:['测试'],total:2,episodes:[{id:'7695386527160863790',order:1,duration:12},{id:'7695386527160863791',order:2,duration:12}]};
const record=(step,info={})=>{events.push({step,...info});console.log(JSON.stringify(events.at(-1)))};
const serveFile=(response,file)=>{createReadStream(file).pipe(response)};
const targetDir=path.join(root,'target');
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://local');requests.push({path:url.pathname,range:request.headers.range||''});
 if(url.pathname==='/latest.yml'){response.end(await readFile(path.join(targetDir,'latest.yml')));return}
 if(url.pathname==='/qa-0.5.1.exe'){serveFile(response,path.join(targetDir,'qa-0.5.1.exe'));return}
 if(url.pathname.startsWith('/media/')){
  const partial=url.pathname.endsWith('1'),match=request.headers.range?.match(/^bytes=(\d+)-/),start=match?Number(match[1]):0;
  response.writeHead(match?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','ETag':'"update-cache-qa-v1"','Content-Length':bytes.length-start,...(match?{'Content-Range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});
  let cursor=start,timer;response.once('close',()=>clearTimeout(timer));
  const send=()=>{if(response.destroyed)return;if(partial&&!release&&cursor>=262144){timer=setTimeout(send,50);return}const end=Math.min(cursor+32768,bytes.length);response.write(bytes.subarray(cursor,end));cursor=end;if(cursor===bytes.length){response.end();return}timer=setTimeout(send,15)};send();return;
 }
 response.writeHead(404);response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const provider=String.raw`
export class ProviderError extends Error{}
const work=${JSON.stringify(work)};
export class ContentProvider{
 constructor(transport){this.signer=transport.signer;global.qaSigner=transport.signer}
 async catalog(){if(!this.started){this.started=true;this.signer.sign('https://example.com/?aid=8704',{}).catch(()=>{})}return {items:[work],hasMore:false,nextOffset:1,label:'隔离更新验收',source:'fixture'}}
 async search(){return this.catalog()}
 async getSeries(){return structuredClone(work)}
 async resolveShare(){return this.getSeries()}
 async getResource(id){return {episodeId:id,duration:12,definition:'360p',availableQualities:['360p'],codec:'h264',encrypted:false,size:${bytes.length},url:(process.env.HONGGUO_QA_SOURCE||${JSON.stringify(base)})+'/media/'+id}}
}`;
const originalConfig=load(await readFile('electron-builder.yml','utf8'));
async function buildInstaller(version,baseline){
 const client=path.join(root,baseline?'baseline-client':'target-client'),destination=path.join(root,baseline?'baseline':'target');
 await mkdir(path.join(client,'dist/main'),{recursive:true});await cp('dist/renderer',path.join(client,'dist/renderer'),{recursive:true});await copyFile('dist/main/preload.cjs',path.join(client,'dist/main/preload.cjs'));
 await writeFile(path.join(client,'package.json'),JSON.stringify({name:'hongguo-manju-upgrade-qa',version,main:'dist/main/main.cjs',description:'Isolated upgrade QA',author:'QA'}));
 const old={};if(baseline)for(const file of ['main','transport'])old[file]=execFileSync('git',['show',`e2c914916861cfd4dd984c0af212d9a0b6cf741a:src/main/${file}.ts`],{encoding:'utf8'});
 const resources=baseline?path.join(root,'baseline-build'):path.resolve('build');await mkdir(resources,{recursive:true});
 await bundle({entryPoints:['src/main/main.ts'],outfile:path.join(client,'dist/main/main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent',plugins:[{name:'upgrade-fixture',setup(builder){builder.onLoad({filter:/[\\/]main[\\/]provider\.ts$/},()=>({contents:provider,loader:'js',resolveDir:path.resolve('src/main')}));builder.onLoad({filter:/[\\/]main[\\/](main|transport)\.ts$/},async args=>{const name=path.basename(args.path,'.ts');let contents=baseline?old[name]:await readFile(args.path,'utf8');if(name==='main')contents=contents.replace("app.setName('红果漫剧桌面版');",`app.setName('Hongguo Manju Update QA');app.setPath('userData',${JSON.stringify(profile)});`);return {contents,loader:'ts',resolveDir:path.resolve('src/main')}})}}]});
 const config={...originalConfig,appId:'personal.hongguo.manju.updateqa',productName:'Hongguo Manju Update QA',compression:'store',electronDist:path.resolve('node_modules/electron/dist'),directories:{app:client,output:destination,buildResources:resources},extraResources:[{from:path.resolve('runtime-bundle'),to:'runtime-bundle'}],afterPack:path.resolve('scripts/verify-packaged-runtime.cjs'),win:{...originalConfig.win,executableName:'HongguoManjuUpdateQA'},nsis:{...originalConfig.nsis,guid,include:baseline?undefined:path.resolve('build/installer.nsh'),createDesktopShortcut:false,createStartMenuShortcut:false},artifactName:`qa-${version}.exe`,publish:[{provider:'generic',url:base+'/'}]};
 const configPath=path.join(root,`builder-${version}.json`);await writeFile(configPath,JSON.stringify(config));
 await packageApp({targets:Platform.WINDOWS.createTarget('nsis'),config:configPath,publish:'never'});return path.join(destination,`qa-${version}.exe`);
}
const run=(file,args)=>new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(`installer returned ${code}`)))});
const ps=(code)=>execFileSync('powershell.exe',['-NoProfile','-Command','[Console]::OutputEncoding=[Text.Encoding]::UTF8; '+code],{windowsHide:true,encoding:'utf8',env:{...process.env,QA_EXE:executable,QA_INSTALL:install,QA_REG:regKey}}).trim();
const wait=async(check,label,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,250))}throw Error('Timeout: '+label)};
const processes=()=>JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:QA_INSTALL+'\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object ProcessId,ExecutablePath)"));
const cacheFiles=async()=>{const directory=path.join(profile,'media-cache'),files={};for(const name of await readdir(directory)){if(/\.mp4$/.test(name)&&!name.includes('.working.'))files[name]={size:(await stat(path.join(directory,name))).size,sha256:createHash('sha256').update(await readFile(path.join(directory,name))).digest('hex')}}return files};
const launch=async()=>{await writeFile(path.join(install,'resources/app-update.yml'),`provider: generic\nurl: ${base}/\nupdaterCacheDirName: manju-upgrade-qa-${path.basename(profile)}\n`);app=await electron.launch({executablePath:executable,env:{...process.env,HONGGUO_TEST_DATA:profile,HONGGUO_QA_SOURCE:base}});page=await app.firstWindow();page.setDefaultTimeout(30000);await page.locator('.work-card').first().waitFor()};
const quit=async()=>{if(!app)return;const instance=app;app=null;const closed=instance.waitForEvent('close',{timeout:30000});await instance.evaluate(({app})=>{setTimeout(()=>app.quit(),0)});await closed};
try{
 assert.ok(install.startsWith(path.resolve('outputs')+path.sep));
 const baseline=process.env.QA_REUSE_BUILD?path.join(root,'baseline/qa-0.5.0.exe'):await buildInstaller('0.5.0',true);if(!process.env.QA_REUSE_BUILD&&!process.env.QA_REUSE_TARGET)await buildInstaller('0.5.1',false);
 await run(baseline,['/S','/currentuser',`/D=${install}`]);assert.ok(ps('(Get-ItemProperty -LiteralPath $env:QA_REG).UninstallString').toLowerCase().includes(install.toLowerCase()));record('baseline NSIS installed under isolated identity');
 await launch();assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.5.0');
 await page.evaluate(async work=>{await window.desktop.cacheCloseToTray(false);await window.desktop.favorite(work,true);await window.desktop.progress({seriesId:work.id,episodeId:work.episodes[0].id,order:1,time:7,duration:12,work});await window.desktop.cacheAdd(work.id)},work);
 await wait(async()=>{const result=await page.evaluate(()=>window.desktop.cacheState()),task=result.data?.tasks[0];return task?.state.ready===1&&task.state.activities.some(item=>item.activity?.stage==='downloading'&&item.activity.transferred>=262144)},'completed and interrupted cache');
 const before=await cacheFiles();assert.ok(Object.keys(before).some(name=>name.endsWith('.partial.mp4')));assert.ok(Object.keys(before).some(name=>!name.includes('.partial')));
 const java=processes().filter(proc=>proc.ExecutablePath.toLowerCase().endsWith('java.exe'));assert.ok(java.length);record('old client has full cache, interrupted cache, running Java and FFmpeg',{before,processes:processes()});
 // Real downloaded installer is launched by production electron-updater.
 await page.getByRole('button',{name:'立即更新',exact:true}).waitFor({timeout:30000});assert.equal(requests.filter(item=>item.path.endsWith('.exe')).length,0);
 await page.getByRole('button',{name:'立即更新',exact:true}).click();await page.getByRole('button',{name:'重启安装',exact:true}).waitFor({timeout:60000});
 const closed=app.waitForEvent('close',{timeout:30000});await page.getByRole('button',{name:'重启安装',exact:true}).click();await closed;app=null;
 await wait(()=>{try{return JSON.parse(extractFile(path.join(install,'resources/app.asar'),'package.json')).version==='0.5.1'}catch{return false}},'real NSIS replacement',90000);
 await wait(()=>processes().some(proc=>proc.ExecutablePath===executable),'NSIS relaunch',30000);record('old client upgraded and restarted without deleting cache');
 // Relaunched app does not inherit the test-data env on every Windows system.
 // Close only the isolated executable gracefully, then inspect with Playwright.
 ps("Get-Process | Where-Object {$_.Path -eq $env:QA_EXE -and $_.MainWindowHandle -ne 0} | ForEach-Object {[void]$_.CloseMainWindow()}");
 await wait(()=>!processes().some(proc=>proc.ExecutablePath===executable),'close restarted QA app');
 const after=await cacheFiles();for(const [name,value]of Object.entries(before))assert.deepEqual(after[name],value,'cache bytes must survive upgrade');
 await launch();assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.5.1');
 const library=(await page.evaluate(()=>window.desktop.library())).data;assert.equal(library.favorites[0].id,work.id);assert.equal(library.history[0].time,7);
 await wait(()=>requests.some(item=>item.path===`/media/${work.episodes[1].id}`&&item.range==='bytes=262144-'),'resume interrupted transfer');
 assert.equal(requests.filter(item=>item.path===`/media/${work.episodes[0].id}`).length,1,'completed video must not redownload');
 record('both caches byte-identical, favorites/history preserved, partial resumes with Range',{after,range:requests.filter(item=>item.range)});
 // New shutdown must release every real runtime while a partial stream is active.
 assert.ok(processes().some(proc=>proc.ExecutablePath.toLowerCase().endsWith('java.exe')));
 await quit();await wait(()=>processes().length===0,'new client releases Java and FFmpeg');record('fixed client exits with no installed runtime processes');
 // Exercise legacy orphan recovery in the real target installer.
 const orphan=spawn(path.join(install,'resources/runtime-bundle/java/bin/java.exe'),['-cp',path.join(install,'resources/runtime-bundle/classes')+';'+path.join(install,'resources/runtime-bundle/dependencies.jar'),'app.hongguo.runtime.SignerBridge',path.join(install,'resources/runtime-bundle/sdk')],{cwd:profile,windowsHide:true,stdio:['pipe','ignore','ignore']});
 await wait(()=>processes().some(proc=>proc.ProcessId===orphan.pid),'legacy orphan starts');
 await run(path.join(targetDir,'qa-0.5.1.exe'),['/S','/currentuser',`/D=${install}`]);assert.equal(processes().some(proc=>proc.ProcessId===orphan.pid),false);record('real installer safely releases legacy orphan without clearing media');
 // Finish the held transfer after upgrade and verify real decoding offline.
 release=true;await launch();await wait(async()=>{const r=await page.evaluate(()=>window.desktop.cacheState());return r.data?.tasks[0]?.state.ready===2},'resumed cache completes');
 await page.locator('.work-card').first().click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.webkitDecodedFrameCount>0&&v.videoWidth>0},null,{timeout:30000});await page.locator('video').evaluate(video=>video.pause());record('retained/resumed caches finish and decode in the actual player');await quit();
 const report={passed:true,events,requests,isolatedAppId:'personal.hongguo.manju.updateqa',productionIdentityUntouched:true};await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,root}));
}catch(error){await writeFile(path.join(root,'report.json'),JSON.stringify({passed:false,error:error.stack,events,requests,text:await page?.locator('body').innerText().catch(()=>null)},null,2));throw error}
finally{await quit();server.closeAllConnections();server.close()}

