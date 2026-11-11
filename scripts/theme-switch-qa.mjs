import {_electron as electron} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Real renderer + mocked content/cache IPC. No network or media is required.
const output=path.resolve(`outputs/theme-qa-${Date.now()}`);
await mkdir(output,{recursive:true});
const coverFiles=['poster-1.jpg','poster-2.jpg','poster-3.jpg','poster-4.jpg','poster-5.jpg','poster-6.jpg'];
let covers=[];
try{
 covers=await Promise.all(coverFiles.map(async file=>'data:image/jpeg;base64,'+(await readFile(path.resolve('outputs/ui-design/assets',file))).toString('base64')));
}catch{
 console.log('optional poster assets not found; using theme cover placeholders');
}
const coverFor=index=>covers.length?covers[index%covers.length]:'';
const works=Array.from({length:12},(_,index)=>({
  id:`theme-${index}`,title:index===0?'糯糯下山，师兄们都慌了':index===1?'我家仙尊不太正经':index===2?'东北后妈，整顿全家':index===3?'天生二月，从废柴到封号斗罗':index===4?'万妖图录传':index===5?'荒岛上还摆高姿态':`示例作品${index+1}`,
  cover:coverFor(index),description:'用于检查桌面外观的示例内容，不是线上推荐。',total:[63,122,120,282,156,108][index%6],categories:['仙侠','轻松','师徒']
}));
const episodes=Array.from({length:12},(_,index)=>({id:`ep-${index+1}`,order:index+1,duration:60}));
const series=works.map(work=>({...work,episodes}));
const history=series.slice(0,3).map((work,index)=>({work,seriesId:work.id,episodeId:`ep-${index+1}`,order:index+1,time:12,duration:60,updatedAt:Date.now()-index}));
const taskState=(ready,total,status,activeId,extra={})=>({status,total,ready,failed:0,activeId,active:activeId?{stage:'processing',percent:42}:undefined,message:extra.message||'',cachedBytes:ready*820000,activities:activeId?[{episodeId:activeId,activity:{stage:'processing',percent:42}}]:[],...extra});
const cache={
  directory:'F:\\红果漫剧\\media-cache',freeBytes:84181359002,usedBytes:7301444403,migrating:false,closeToTray:true,message:'',concurrency:4,bytesPerSecond:2831155,
  limits:{maxGiB:20,bandwidthMiB:0},
  tasks:[
    {series:series[1],paused:false,createdAt:Date.now(),state:taskState(6,8,'preparing','ep-7'),watched:false,registered:true,priority:'high'},
    {series:series[0],paused:false,createdAt:Date.now()-1000,state:taskState(12,12,'complete',undefined),watched:false,registered:true,priority:'normal'},
    {series:series[3],paused:true,createdAt:Date.now()-2000,state:taskState(38,155,'paused',undefined,{message:'后台任务已暂停'}),watched:false,registered:true,priority:'low'}
  ]
};
const report={generatedAt:new Date().toISOString(),passed:false,screenshots:[],checks:[],errors:[]};
let app,page;
const profile=path.join(output,`profile-${Date.now()}`);
const shot=async name=>{const file=path.join(output,`${name}.png`);await page.screenshot({path:file});report.screenshots.push(file)};
const themeName=theme=>({paper:'宣纸书卷',cinema:'午夜影院',neon:'流光',arcade:'像素放映厅'}[theme]);
const openAppearance=async()=>{await page.getByRole('button',{name:/外观设置，当前/}).click();await page.getByRole('dialog',{name:'选择界面风格'}).waitFor()};
const chooseTheme=async theme=>{await openAppearance();await page.locator('.appearance-option').filter({hasText:themeName(theme)}).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);await page.waitForTimeout(320);await shot(`appearance-${theme}`);await page.getByRole('button',{name:'完成',exact:true}).click();await page.waitForTimeout(180)};
const goHome=async()=>{
  if(await page.locator('.theme-rail').count())await page.locator('.theme-rail .rail-nav button').filter({hasText:'发现'}).click();
  else await page.getByRole('button',{name:'发现',exact:true}).click();
  await page.waitForTimeout(120);
};
const goCache=async()=>{
  if(await page.locator('.theme-rail').count())await page.locator('.theme-rail .rail-nav button').filter({hasText:'缓存'}).click();
  else await page.getByRole('button',{name:'缓存中心'}).click();
  await page.locator('.cache-center').waitFor();await page.waitForTimeout(180);
};
try{
  app=await electron.launch({args:['.'],env:{...process.env,HONGGUO_TEST_DATA:profile}});
  page=await app.firstWindow();
  page.on('pageerror',error=>report.errors.push(error.message));
  await app.evaluate(({ipcMain},payload)=>{
    const ok=data=>({ok:true,data});
    const {works,series,history,cache}=payload;
    const handlers={
      catalog:board=>ok({items:works,hasMore:false,nextOffset:0,label:{recommend:'推荐榜',hot:'热播榜',new:'新剧榜'}[board],source:'UI fixture'}),
      search:()=>ok({items:works.slice(0,1),hasMore:false,nextOffset:0,label:'搜索结果',source:'UI fixture'}),
      library:()=>ok({favorites:works.slice(0,2),history}),
      favorite:(work,enabled)=>ok({favorites:enabled?[work]:[],history}),
      series:id=>ok(series.find(work=>work.id===id)||series[0]),
      recommendations:()=>ok({seasons:[],similar:[],message:''}),
      'cache-state':()=>ok(cache),
      'cache-add':()=>ok(cache),
      'cache-action':()=>ok(cache),
      'cache-delete-watched':()=>ok(cache),
      'cache-concurrency':()=>ok(cache),
      'cache-limits':()=>ok(cache),
      'cache-priority':()=>ok(cache),
      'cache-close-to-tray':()=>ok(cache),
      'cache-open-directory':()=>ok(true),
      'cache-directory':()=>ok(cache),
      'buffer-state':()=>ok({status:'idle',total:12,ready:0,failed:0,message:''}),
      'buffer-episodes':()=>ok({status:'idle',total:12,ready:0,failed:0,message:''}),
      'buffer-retry':()=>ok({status:'idle',total:12,ready:0,failed:0,message:''}),
      'video-quality':()=>ok(true),
      'update-state':()=>ok({status:'current',currentVersion:'test',message:'外观检查版本'}),
      'diagnostics-export':()=>ok({saved:false})
    };
    for(const [channel,handler] of Object.entries(handlers)){ipcMain.removeHandler(channel);ipcMain.handle(channel,(_event,...args)=>handler(...args))}
  },{works,series,history,cache});
  await page.reload();
  await page.waitForSelector('.work-card');
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'paper');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(244, 240, 232)');
  await shot('home-paper');
  for(const theme of ['cinema','neon','arcade']){
    await chooseTheme(theme);
    await shot(`home-${theme}`);
    if(theme==='neon')assert.equal(await page.locator('.theme-rail').isVisible(),true);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),theme==='cinema'?'rgb(12, 10, 9)':theme==='neon'?'rgb(7, 10, 19)':'rgb(20, 16, 31)');
    await goCache();
    await shot(`cache-${theme}`);
    await goHome();
    await page.waitForSelector('.work-card');
  }
  await chooseTheme('paper');
  assert.equal(await page.locator('.theme-rail').count(),0);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(244, 240, 232)');
  assert.equal(await page.evaluate(()=>localStorage.getItem('hongguo.uiTheme')),'paper');
  await chooseTheme('cinema');
  assert.equal(await page.evaluate(()=>localStorage.getItem('hongguo.uiTheme')),'cinema');
  await shot('home-cinema-persisted');
  await openAppearance();
  await page.getByRole('button',{name:/恢复默认/}).click();
  await page.waitForTimeout(320);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'paper');
  assert.equal(await page.evaluate(()=>localStorage.getItem('hongguo.uiTheme')),'paper');
  await shot('appearance-restored-paper');
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.waitForTimeout(180);
  await shot('home-paper-restored');
  // Fit checks at the minimum supported width.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1040,720));
  await page.waitForTimeout(250);
  for(const theme of ['paper','cinema','neon','arcade']){
    await chooseTheme(theme);
    const geometry=await page.evaluate(()=>{
      const main=document.querySelector('.content-scroll');
      const visibleButtons=[...document.querySelectorAll('.topbar button,.theme-rail button')].filter(button=>{const style=getComputedStyle(button);return style.display!=='none'&&style.visibility!=='hidden'&&button.getBoundingClientRect().width>0});
      const outside=visibleButtons.map(button=>{const bounds=button.getBoundingClientRect();return {label:button.getAttribute('aria-label')||button.textContent.trim(),left:bounds.left,right:bounds.right}}).filter(item=>item.left<0||item.right>innerWidth);
      return {width:innerWidth,bodyOverflow:document.body.scrollWidth>innerWidth,mainOverflow:main.scrollWidth>main.clientWidth,outside};
    });
    report.checks.push({step:'narrow-layout',theme,...geometry});
    assert.equal(geometry.bodyOverflow,false,`${theme} body overflow`);
    assert.equal(geometry.mainOverflow,false,`${theme} main overflow`);
    assert.deepEqual(geometry.outside,[],`${theme} top buttons outside window`);
  }
  // A fresh launch must apply the saved theme before the user opens 外观.
  await page.evaluate(()=>localStorage.setItem('hongguo.uiTheme','cinema'));
  await app.close();app=null;
  app=await electron.launch({args:['.'],env:{...process.env,HONGGUO_TEST_DATA:profile}});
  page=await app.firstWindow();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='cinema',null,{timeout:20000});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(12, 10, 9)');
  await page.waitForTimeout(800);
  await shot('startup-cinema');
  report.checks.push({step:'startup-theme',theme:'cinema',applied:true});
  assert.deepEqual(report.errors,[]);
  report.passed=true;
  console.log(JSON.stringify({passed:true,output,screenshots:report.screenshots,checks:report.checks},null,2));
}catch(error){
  report.failure=error.message;
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.error(error.message);
  process.exitCode=1;
}finally{
  if(app)await app.close();
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
}