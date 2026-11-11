import {_electron as electron} from 'playwright-core';
const app=await electron.launch({args:['.'],env:{...process.env,HONGGUO_TEST_DATA:'F:/红果漫剧/outputs/diagnose-profile'}});
const page=await app.firstWindow();page.on('console',m=>console.log('console',m.type(),m.text().slice(0,250)));page.on('pageerror',e=>console.log('pageerror',e.name));
try{
 await page.waitForSelector('.work-card',{timeout:60000});
 console.log('window',await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {bounds:w.getBounds(),visible:w.isVisible(),minimized:w.isMinimized(),destroyed:w.isDestroyed()}}));
 console.log('page',await page.evaluate(()=>({visibility:document.visibilityState,width:innerWidth,height:innerHeight,images:[...document.images].map(i=>({complete:i.complete,width:i.naturalWidth}))})));
 try{await page.screenshot({path:'outputs/diagnose.png'});console.log('screenshot pass')}catch(e){console.log('screenshot fail',e.message)}
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.on('close',()=>console.log('QA close'));w.webContents.on('will-prevent-unload',()=>console.log('QA will-prevent-unload'));w.on('closed',()=>console.log('QA closed'));w.close()});
 const outcome=await Promise.race([app.waitForEvent('close').then(()=>true),new Promise(r=>setTimeout(()=>r(false),6000))]);console.log('graceful',outcome);
 if(!outcome){console.log('still-open',await page.evaluate(()=>({visibility:document.visibilityState})));await app.evaluate(({app})=>app.exit(0))}
}catch(e){console.log(e.message);await app.evaluate(({app})=>app.exit(1)).catch(()=>{})}
