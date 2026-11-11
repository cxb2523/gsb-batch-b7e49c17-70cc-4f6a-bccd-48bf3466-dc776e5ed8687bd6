// Destructive only to the explicitly selected QA installation under outputs/.
// Use an updater-bearing baseline built with extraMetadata.version=0.2.2.
import {_electron as electron} from 'playwright-core';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const {extractFile}=createRequire(import.meta.url)('@electron/asar');
const executablePath=path.resolve(process.env.QA_UPDATE_EXECUTABLE||'');
assert.ok(executablePath.startsWith(path.resolve('outputs')+path.sep),'QA executable must be inside outputs/');
const installDir=path.dirname(executablePath);
const uninstall=execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\6065b8f2-bab8-5a4a-a93d-2505fefb57aa').UninstallString"],{encoding:'utf8',windowsHide:true});
assert.ok(uninstall.toLowerCase().includes(installDir.toLowerCase()),'NSIS registered location must be the selected QA installation');
const output=path.resolve('outputs/update-qa');await mkdir(output,{recursive:true});
const profile=path.join(output,'profile');
let mode='unavailable';let app;const requests=[];const events=[];const errors=[];
const manifest=await readFile('release/latest.yml');
const {version}=JSON.parse(await readFile('package.json','utf8'));
const filename=`Hongguo-Manju-${version}-Windows-x64.exe`;
const server=createServer((request,response)=>{
 const url=new URL(request.url,'http://localhost');requests.push({mode,path:url.pathname});
 if(url.pathname==='/latest.yml'){
  if(mode==='unavailable'){response.writeHead(503);response.end('offline');return;}
  response.setHeader('Content-Type','text/yaml');response.end(manifest);return;
 }
 if(url.pathname===`/${filename}`){
  response.setHeader('Content-Type','application/octet-stream');
  if(mode==='corrupt'){response.write(Buffer.from('CORRUPT!'));createReadStream(`release/${filename}`,{start:8}).pipe(response);}
  else createReadStream(`release/${filename}`).pipe(response);
  return;
 }
 response.writeHead(404);response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
await writeFile(path.join(installDir,'resources/app-update.yml'),`provider: generic\nurl: ${url}\nupdaterCacheDirName: hongguo-manju-updater-qa-${Date.now()}\n`);
const env={...process.env,HONGGUO_TEST_DATA:profile};
const record=event=>{events.push(event);console.log(JSON.stringify(event));};
const launch=()=>electron.launch({executablePath,env});
try{
 app=await launch();let page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 let mainLog='';app.process().stderr.on('data',chunk=>{mainLog+=chunk.toString();});app.process().stdout.on('data',chunk=>{mainLog+=chunk.toString();});
 assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.2.2');
 await page.getByRole('button',{name:'应用更新',exact:true}).click();
 await page.getByRole('button',{name:'检查更新',exact:true}).click();
 await page.waitForFunction(async()=>{const r=await window.desktop.updateState();return r.data?.status==='error';},null,{timeout:30000});
 record({step:'real-network-failure',state:(await page.evaluate(()=>window.desktop.updateState())).data.status});
 mode='corrupt';await page.getByRole('button',{name:'重试更新',exact:true}).click();
 await page.getByRole('button',{name:'立即更新',exact:true}).waitFor();
 assert.equal(requests.filter(request=>request.path.endsWith('.exe')).length,0);
 await page.getByRole('button',{name:'暂不更新',exact:true}).click();
 await page.getByRole('button',{name:'应用更新',exact:true}).click();
 assert.equal(requests.filter(request=>request.path.endsWith('.exe')).length,0);
 await page.getByRole('button',{name:'立即更新',exact:true}).click();
 await page.waitForFunction(async()=>{const r=await window.desktop.updateState();return r.data?.status==='error'&&!!r.data?.nextVersion;},null,{timeout:90000});
 assert.match(mainLog,/checksum mismatch/i);record({step:'sha512-rejects-corrupt-installer',checksumMismatchLogged:true});
 mode='valid';await page.getByRole('button',{name:'重试更新',exact:true}).click();
 await page.getByRole('button',{name:'重启安装',exact:true}).waitFor({timeout:90000});
 const ready=(await page.evaluate(()=>window.desktop.updateState())).data;assert.equal(ready.status,'downloaded');
 await page.screenshot({path:path.join(output,'downloaded.png')});record({step:'real-installer-downloaded-and-verified',...ready});
 // Exercise the same IPC persistence operations the player uses immediately before shutdown.
 const work={id:'7695370827507698713',title:'到末世十年后竟然遇到四个尸王第一季',cover:'',description:'',total:155};
 await page.evaluate(async work=>{
  const f=await window.desktop.favorite(work,true);if(!f.ok)throw new Error('favorite failed');
  const p=await window.desktop.progress({seriesId:work.id,episodeId:'7695335020380357161',order:4,time:42,duration:120,work});if(!p.ok)throw new Error('progress failed');
 },work);
 const child=app.process();const exited=new Promise(resolve=>child.once('exit',resolve));await page.getByRole('button',{name:'重启安装',exact:true}).click();
 let exitTimer;try{await Promise.race([exited,new Promise((_,reject)=>{exitTimer=setTimeout(()=>reject(new Error('Old app did not exit')),30000);})]);}finally{clearTimeout(exitTimer);}
 await writeFile(path.join(output,'main.log'),mainLog);app=undefined;
 // NSIS relaunch is outside Playwright; wait for installation then close only this QA executable.
 const deadline=Date.now()+90000;let installed=false;
 while(Date.now()<deadline){
  try{installed=JSON.parse(extractFile(path.join(installDir,'resources/app.asar'),'package.json').toString()).version===version;}catch{}
  if(installed)break;await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.equal(installed,true,`NSIS must replace the installed application with ${version}`);
 const afterRestart=Date.now()+30000;let restarted=false;
 while(Date.now()<afterRestart){
  const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @(Get-Process -Name '红果漫剧桌面版' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $env:QA_UPDATE_EXECUTABLE -and $_.MainWindowHandle -ne 0} | Select-Object Id,Path)"],{encoding:'utf8',windowsHide:true,env:{...env,QA_UPDATE_EXECUTABLE:executablePath}}));
  if(processes.length){restarted=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.equal(restarted,true,'Installer must relaunch the QA client');record({step:'nsis-installed-and-relaunched',version});
 execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Process -Name '红果漫剧桌面版' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $env:QA_UPDATE_EXECUTABLE -and $_.MainWindowHandle -ne 0} | ForEach-Object { [void]$_.CloseMainWindow() }"],{windowsHide:true,env:{...env,QA_UPDATE_EXECUTABLE:executablePath}});
 await new Promise(resolve=>setTimeout(resolve,2500));
 app=await launch();page=await app.firstWindow();assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
 const library=(await page.evaluate(()=>window.desktop.library())).data;assert.ok(library.favorites.some(w=>w.id===work.id));assert.equal(library.history.find(p=>p.seriesId===work.id).time,42);
 record({step:'installed-version-and-persistence',version,favorites:library.favorites.length,time:42});
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,events,requests,errors},null,2));
}catch(error){await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,failure:error.message,events,requests,errors},null,2));throw error;}
finally{if(app)await app.close();server.closeAllConnections();server.close();}
