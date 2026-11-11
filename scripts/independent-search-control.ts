import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Signer} from '../src/main/transport';
import {safeJson} from '../src/main/json';
import {independentIdentity} from './independent-transport';

// Diagnostic controls only. q and search_source=1 come from the APK DTO/enums.
const out=path.resolve('research/independent');
const signer=new Signer(path.resolve('runtime-bundle'),path.join(out,'signer-work'));
const identities=[{name:'independent',params:independentIdentity,ua:'com.kylin.read/74032'},
 {name:'short-drama-control',params:{aid:'8662',app_name:'novelread',version_code:'72232',version_name:'7.2.2.32',update_version_code:'72232'},ua:'com.phoenix.read/72232'}];
const rows:any[]=[];
function summarize(v:any){
 const labels:string[]=[];let objects=0;
 function visit(x:any,d=0){if(!x||typeof x!=='object'||d>12||objects++>5000)return;
  for(const k of ['word','query','title','series_title','series_name','name'])if(typeof x[k]==='string'&&labels.length<30)labels.push(x[k]);
  for(const child of Object.values(x))visit(child,d+1);
 }visit(v);
 return {code:v?.code??v?.BaseResp?.StatusCode,keys:Object.keys(v??{}),labels};
}
try{
 for(const host of ['api5-normal-sinfonlinea.fqnovel.com','reading.snssdk.com'])for(const identity of identities)for(const kind of ['suggest','search']){
  const params=kind==='suggest'?{q:'到末世十年后竟然遇到四个尸王',search_source:1,tab_name:'feed'}:
   {query:'到末世十年后竟然遇到四个尸王',search_source:1,tab_name:'feed',count:0,offset:0,use_correct:true};
  const endpoint=kind==='suggest'?'/reading/bookapi/search/suggest/v':'/reading/bookapi/search/tab/v/';
  const url=new URL(endpoint,`https://${host}`);
  for(const [k,v] of Object.entries({...identity.params,channel:'audit',device_platform:'android',os_version:'12',_rticket:Date.now(),...params}))url.searchParams.set(k,String(v));
  const headers={'user-agent':`${identity.ua} (Linux; Android 12)`,'content-type':'application/json; charset=utf-8'};
  const row:any={identity:identity.name,host,kind,endpoint,params};
  try{const signed=await signer.sign(url.href,headers);const response=await fetch(url,{headers:{...headers,...signed},signal:AbortSignal.timeout(15000)});
   const body=await response.text();Object.assign(row,{http:response.status,bytes:Buffer.byteLength(body)});
   if(body.trim()){try{row.summary=summarize(safeJson(body))}catch{row.nonJson=true}}else row.empty=true;
  }catch(e){row.error=e instanceof Error?e.name:'FAILED'}
  rows.push(row);console.log(JSON.stringify(row));
 }
}finally{signer.close();await mkdir(out,{recursive:true});await writeFile(path.join(out,'search-control.json'),JSON.stringify({generatedAt:new Date().toISOString(),releasedProviderChanged:false,rows},null,2));}
