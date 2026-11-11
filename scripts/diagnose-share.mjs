import {_electron as electron} from 'playwright-core';
const app=await electron.launch({args:['.'],env:{...process.env,HONGGUO_TEST_DATA:'F:/红果漫剧/outputs/share-diagnose'}});
try{const p=await app.firstWindow();await p.waitForSelector('.work-card',{timeout:60000});console.log(await app.evaluate(async()=>{
 const result=[];for(const headers of [{Accept:'text/html'},{Accept:'text/html','user-agent':'HongguoManjuDesktop/0.2.0'}]){let url='https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/';const chain=[];for(let hop=0;hop<6;hop++){const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers});chain.push({status:r.status,host:new URL(url).host,path:new URL(url).pathname});if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('location'),url).href;await r.body?.cancel();continue}const s=await r.text();result.push({chain,bytes:s.length,router:s.includes('_ROUTER_DATA'),scripts:(s.match(/<script/g)||[]).length,title:s.match(/<title>(.*?)<\/title>/)?.[1],challenge:/captcha|验证码|security verification/i.test(s),fetch:fetch.toString().slice(0,100)});break}}
 return result;
 }));console.log(await p.evaluate(async()=>{const r=await window.desktop.importShare('https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/');return {ok:r.ok,error:r.error,total:r.data?.total}}));
}finally{await app.close()}
