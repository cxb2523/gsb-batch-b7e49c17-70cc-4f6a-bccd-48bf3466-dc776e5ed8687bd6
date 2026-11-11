// Real content playback with isolated app data; report contains no media URLs or credentials.
import {_electron as electron} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve(process.env.QA_OUTPUT||`outputs/quality-speed-qa-${Date.now()}`);await mkdir(output,{recursive:true});
const report={passed:false,events:[],errors:[]};let app,page;
const launch=async()=>{
 app=await electron.launch({executablePath:process.env.QA_EXECUTABLE||path.resolve('release/win-unpacked/红果漫剧桌面版.exe'),args:[],env:{...process.env,HONGGUO_TEST_DATA:path.join(output,'profile')}});
 page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.name));
};
const playing=async order=>{
 await page.waitForSelector(`.player[aria-label="第${order}集播放器"] video`,{timeout:180000});
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.2&&v.webkitDecodedFrameCount>0&&v.webkitAudioDecodedByteCount>0},{},{timeout:60000});
 const result=await page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,rate:v.playbackRate,frames:v.webkitDecodedFrameCount,audioBytes:v.webkitAudioDecodedByteCount}));
 const definition=await page.locator('.definition-label').innerText();
 const resolution=Number(definition.replace('p',''));assert.ok(Number.isFinite(resolution));assert.ok(Math.min(result.width,result.height)>=resolution-2,'cached output must retain the selected source resolution');
 report.events.push({step:'decoded-media',order,definition,...result});console.log(JSON.stringify(report.events.at(-1)));return result;
};
try{
 await launch();await page.waitForSelector('.work-card',{timeout:60000});
 await page.getByRole('button',{name:'导入分享',exact:true}).last().click();await page.getByRole('textbox',{name:'分享文本或链接'}).fill('https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/');await page.getByRole('button',{name:'导入并收藏'}).click();
 await playing(1);await page.getByRole('combobox',{name:'播放倍速'}).selectOption('1.5');await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.5);
 await page.getByRole('button',{name:'下一集',exact:true}).click();assert.equal((await playing(2)).rate,1.5);
 await page.locator('video').evaluate(v=>{v.currentTime=v.duration-.25;});assert.equal((await playing(3)).rate,1.5);
 await page.getByRole('button',{name:'播放第78集',exact:true}).click();assert.equal((await playing(78)).rate,1.5);
 await page.getByRole('button',{name:'暂停',exact:true}).click();await page.screenshot({path:path.join(output,'high-quality-player.png')});
 await page.getByRole('button',{name:'返回',exact:true}).click();
 const cards=page.locator('.work-card');const selected=await cards.evaluateAll(nodes=>nodes.findIndex(node=>!node.textContent?.includes('末世躺赢指南')));assert.ok(selected>=0);
 await cards.nth(selected).click();assert.equal((await playing(1)).rate,1.5);report.events.push({step:'different-work-preserves-speed',title:await page.locator('.detail-heading h1').innerText()});
 await page.getByRole('combobox',{name:'播放倍速'}).selectOption('2');await app.close();app=undefined;
 await launch();await page.waitForSelector('.work-card',{timeout:60000});await page.locator('.work-card').first().click();await page.waitForSelector('video',{timeout:180000});
 await page.waitForFunction(()=>document.querySelector('video')?.playbackRate===2);assert.equal(await page.getByRole('combobox',{name:'播放倍速'}).inputValue(),'2');report.events.push({step:'application-restart-preserves-speed',rate:2});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.message;if(page&&!page.isClosed())report.text=await page.locator('body').innerText().catch(()=>undefined);process.exitCode=1}
finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,output,failure:report.failure}));}
