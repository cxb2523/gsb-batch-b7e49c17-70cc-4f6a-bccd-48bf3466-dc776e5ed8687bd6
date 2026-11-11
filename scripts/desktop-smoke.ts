import {Signer,Transport} from '../src/main/transport';import {ContentProvider} from '../src/main/provider';import {MediaCache} from '../src/main/media';import path from 'node:path';import {mkdir,writeFile} from 'node:fs/promises';
const runtime=path.resolve('runtime-bundle');const signer=new Signer(runtime);const provider=new ContentProvider(new Transport(signer));const media=new MediaCache(path.resolve('outputs/desktop-smoke-cache'),path.join(runtime,'ffmpeg.exe'),id=>provider.getResource(id));
const report:any={time:new Date().toISOString(),events:[]};
try{
 await media.init();const catalog=await provider.catalog('recommend');report.events.push({step:'catalog',items:catalog.items.length,label:catalog.label});
 const series=await provider.getSeries('7695370827507698713');report.events.push({step:'series',title:series.title,episodes:series.episodes.length});
 const search=await provider.search('到末世十年后竟然遇到四个尸王');report.events.push({step:'search',matches:search.items.some(w=>w.id===series.id),count:search.items.length});
 const imported=await provider.resolveShare('打开红果漫剧免费看 https://kylin.hainanyuyue.com/s/Nx9mnh9X6vY/');report.events.push({step:'share',sameWork:imported.id===series.id});
 for(const order of [1,78,155]){const e=series.episodes.find(e=>e.order===order)!;const start=Date.now();const playback=await media.prepare(e.id);const response=await media.response(playback.url,'bytes=0-99');const data=await response.arrayBuffer();report.events.push({step:'media',order,duration:playback.duration,definition:playback.definition,rangeStatus:response.status,bytes:data.byteLength,seconds:(Date.now()-start)/1000})}
 report.passed=true;console.log(JSON.stringify(report));
}catch(error){report.passed=false;report.error=error&&typeof error==='object'&&'code'in error?{code:(error as any).code,message:(error as any).message}:{code:'SMOKE_FAILED'};console.log(JSON.stringify(report));process.exitCode=1}
finally{await media.close();signer.close();await mkdir('outputs',{recursive:true});await writeFile('outputs/desktop-smoke.json',JSON.stringify(report,null,2))}
