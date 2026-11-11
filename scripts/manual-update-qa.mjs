// Tests download consent using an isolated packaged app and a harmless fixture.
// Never installs the fixture or modifies the user's installed application.
import {_electron as electron} from 'playwright-core';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory=path.resolve(process.env.QA_UPDATE_DIRECTORY||'outputs/manual-update-client/win-unpacked');
assert.ok(directory.startsWith(path.resolve('outputs')+path.sep),'QA updater configuration must remain inside outputs/');
const configFile=path.join(directory,'resources/app-update.yml');
const original=await readFile(configFile).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
const output=path.resolve(`outputs/manual-update-qa-${Date.now()}`);await mkdir(output,{recursive:true});
const {version}=JSON.parse(await readFile('package.json','utf8'));
const nextVersion=version.replace(/\d+$/,value=>String(Number(value)+1));
const fixture=Buffer.from('Harmless update consent QA fixture. Never execute.');
const sha512=createHash('sha512').update(fixture).digest('base64');
const manifest=`version: ${nextVersion}\nfiles:\n  - url: consent-fixture.exe\n    sha512: ${sha512}\n    size: ${fixture.length}\npath: consent-fixture.exe\nsha512: ${sha512}\n`;
const requests=[];let app;const errors=[];const events=[];
const server=createServer((request,response)=>{
 requests.push(request.url);
 if(request.url.startsWith('/latest.yml')){response.end(manifest);return;}
 if(request.url==='/consent-fixture.exe'){response.end(fixture);return;}
 response.writeHead(404);response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const downloads=()=>requests.filter(value=>value==='/consent-fixture.exe').length;
const launch=()=>electron.launch({executablePath:path.join(directory,'红果漫剧桌面版.exe'),env:{...process.env,HONGGUO_TEST_DATA:path.join(output,'profile')}});
const observe=async()=>{app=await launch();const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));return page;};
try{
 await writeFile(configFile,`provider: generic\nurl: ${url}\nupdaterCacheDirName: manual-consent-qa-${Date.now()}\n`);
 let page=await observe();
 await page.getByRole('button',{name:'立即更新',exact:true}).waitFor({timeout:30000});
 const prompt=page.getByRole('dialog',{name:'发现新版本',exact:true});await prompt.waitFor({timeout:1500});
 await prompt.getByText(`当前版本 ${version}`,{exact:true}).waitFor();await prompt.getByText(`新版本 ${nextVersion}`,{exact:true}).waitFor();
 assert.equal(downloads(),0);assert.equal((await page.evaluate(()=>window.desktop.updateState())).data.status,'available');
 events.push('startup check prompts without requesting installer');
 await page.screenshot({path:path.join(output,'available.png')});
 await page.getByRole('button',{name:'暂不更新',exact:true}).click();
 assert.equal(await page.getByRole('dialog',{name:'发现新版本',exact:true}).count(),0);
 await app.evaluate(({BrowserWindow},nextVersion)=>BrowserWindow.getAllWindows()[0].webContents.send('update-status',{status:'available',currentVersion:'test',nextVersion,message:'duplicate availability event'}),nextVersion);
 await page.waitForTimeout(250);assert.equal(await page.getByRole('dialog',{name:'发现新版本',exact:true}).count(),0);
 await app.evaluate(({BrowserWindow},nextVersion)=>{const contents=BrowserWindow.getAllWindows()[0].webContents;contents.send('update-status',{status:'checking',currentVersion:'test',message:'periodic check'});contents.send('update-status',{status:'available',currentVersion:'test',nextVersion,message:'same version after periodic check'})},nextVersion);
 await page.waitForTimeout(250);assert.equal(await page.getByRole('dialog',{name:'发现新版本',exact:true}).count(),0);assert.equal(downloads(),0);
 assert.equal(await page.locator('.update-panel').count(),0);
 await page.getByRole('button',{name:'我的收藏',exact:true}).click();
 await page.waitForTimeout(1500);assert.equal(downloads(),0);
 await page.getByRole('button',{name:'应用更新',exact:true}).click();
 await page.getByRole('button',{name:'立即更新',exact:true}).waitFor();assert.equal(downloads(),0);
 events.push('declining and reopening panel do not download');
 await page.evaluate(async()=>{const surface=document.createElement('div');surface.id='qa-fullscreen';surface.style.background='black';document.body.append(surface);await surface.requestFullscreen()});
 await app.evaluate(({BrowserWindow},nextVersion)=>BrowserWindow.getAllWindows()[0].webContents.send('update-status',{status:'available',currentVersion:'test',nextVersion:`${nextVersion}-fullscreen`,message:'fullscreen prompt QA'}),nextVersion);
 const fullscreenPrompt=page.getByRole('dialog',{name:'发现新版本',exact:true});await fullscreenPrompt.waitFor();
 assert.equal(await fullscreenPrompt.evaluate(el=>{const rect=el.querySelector('.update-prompt').getBoundingClientRect();return !!document.fullscreenElement&&el.matches(':modal')&&el.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))}),true);
 await fullscreenPrompt.getByRole('button',{name:'暂不更新',exact:true}).click();assert.equal(downloads(),0);
 await page.evaluate(async()=>{await document.exitFullscreen();document.getElementById('qa-fullscreen')?.remove()});
 events.push('delayed availability prompt remains visible above fullscreen playback');
 await app.close();app=undefined;
 page=await observe();await page.getByRole('button',{name:'立即更新',exact:true}).waitFor({timeout:30000});assert.equal(downloads(),0);
 const restartedPrompt=page.getByRole('dialog',{name:'发现新版本',exact:true});await restartedPrompt.waitFor();
 assert.equal(await restartedPrompt.getByRole('button',{name:'暂不更新',exact:true}).evaluate(el=>el===document.activeElement),true);
 for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await restartedPrompt.evaluate(el=>el.contains(document.activeElement)),true)}
 for(let i=0;i<5;i++){await page.keyboard.press('Shift+Tab');assert.equal(await restartedPrompt.evaluate(el=>el.contains(document.activeElement)),true)}
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'发现新版本',exact:true}).count(),0);assert.equal(downloads(),0);
 await page.getByRole('button',{name:'应用更新',exact:true}).click();
 events.push('dialog defaults to defer, traps keyboard focus, and Escape dismisses without download');
 events.push('restart checks again without downloading');
 await page.getByRole('button',{name:'立即更新',exact:true}).click();
 await page.getByRole('button',{name:'重启安装',exact:true}).waitFor({timeout:30000});
 assert.equal(downloads(),1);assert.equal((await page.evaluate(()=>window.desktop.updateState())).data.status,'downloaded');
 assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
 events.push('explicit click downloads once; verified fixture waits for install confirmation');
 await page.screenshot({path:path.join(output,'downloaded.png')});assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,version,events,requests,errors,fixtureOnly:true},null,2));
 console.log(JSON.stringify({passed:true,version,events,requests,output},null,2));
}finally{
 if(app)await app.close();if(original)await writeFile(configFile,original);else await unlink(configFile);server.closeAllConnections();server.close();
}
