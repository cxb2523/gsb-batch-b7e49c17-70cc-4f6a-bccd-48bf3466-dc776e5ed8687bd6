import type {Resource} from '../shared/types';
import {AppError} from './errors';
import {safeJson} from './json';

const LIMIT=1024*1024;
const FILE_LIMIT=150*1024*1024;
const invalid=()=>new AppError('WEB_RESOURCE','官网兼容播放资源暂不可用，请稍后重试');
interface Box {type:string;body:number;end:number}
function boxes(data:Buffer,start=0,end=data.length,partial=false):Box[]{
 const result:Box[]=[];
 for(let p=start;p<end;){
  if(p+8>end)throw invalid();
  let size=data.readUInt32BE(p),header=8;
  if(size===1){if(p+16>end)throw invalid();const large=data.readBigUInt64BE(p+8);if(large>BigInt(Number.MAX_SAFE_INTEGER))throw invalid();size=Number(large);header=16}
  if(size===0)size=end-p;
  if(size<header)throw invalid();
  if(p+size>end){if(partial&&['mdat','free'].includes(data.toString('ascii',p+4,p+8)))break;throw invalid()}
  result.push({type:data.toString('ascii',p+4,p+8),body:p+header,end:p+size});p+=size;
 }
 return result;
}
function child(data:Buffer,parent:Box,name:string):Box{
 const matches=boxes(data,parent.body,parent.end).filter(b=>b.type===name);
 if(matches.length!==1)throw invalid();return matches[0];
}
// Read only complete MP4 metadata; never infer resolution or duration from titles.
export function inspectMp4(data:Buffer):{duration:number;definition:string;codec:string}{
 const moov=boxes(data,0,data.length,true).find(b=>b.type==='moov');if(!moov)throw invalid();
 const mvhd=child(data,moov,'mvhd'),p=mvhd.body,version=data[p];
 if(![0,1].includes(version)||mvhd.end-p<(version===1?32:20))throw invalid();
 const scale=data.readUInt32BE(p+(version===1?20:12));
 const ticks=version===1?Number(data.readBigUInt64BE(p+24)):data.readUInt32BE(p+16);
 const duration=ticks/scale;
 if(!Number.isFinite(duration)||duration<=0||duration>1800)throw invalid();
 let height=0,video=0,audio=0;
 for(const track of boxes(data,moov.body,moov.end).filter(b=>b.type==='trak')){
  const mdia=child(data,track,'mdia'),hdlr=child(data,mdia,'hdlr');
  if(hdlr.end-hdlr.body<12)throw invalid();
  const type=data.toString('ascii',hdlr.body+8,hdlr.body+12);
  if(!['vide','soun'].includes(type))continue;
  const stsd=child(data,child(data,child(data,mdia,'minf'),'stbl'),'stsd');
  if(stsd.end-stsd.body<8||data.readUInt32BE(stsd.body+4)!==1)throw invalid();
  const entries=boxes(data,stsd.body+8,stsd.end);if(entries.length!==1)throw invalid();const entry=entries[0];
  if(type==='vide'){
   if(entry.type!=='avc1'||entry.end-entry.body<28)throw invalid();
   const width=data.readUInt16BE(entry.body+24),h=data.readUInt16BE(entry.body+26);
   if(!width||!h)throw invalid();height=Math.min(width,h);video++;
  }else{if(entry.type!=='mp4a')throw invalid();audio++}
 }
 if(video!==1||audio!==1)throw invalid();
 const resolution=[1080,720,540,480,360].find(n=>height>=n);if(!resolution)throw invalid();
 return {duration,definition:resolution+'p',codec:'h264'};
}
async function bounded(response:Response,limit:number):Promise<Buffer>{
 if(!response.body)throw invalid();const reader=response.body.getReader();const parts:Buffer[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw invalid();parts.push(Buffer.from(value))}return Buffer.concat(parts)}
 finally{await reader.cancel().catch(()=>{})}
}
export async function webPlayback(episodeId:string,fetcher:typeof fetch=fetch):Promise<Resource>{
 if(!/^[1-9]\d{7,23}$/.test(episodeId))throw invalid();
 try{
  const response=await fetcher('https://hongguoduanju.com/api/video/protected/fallback-play-info',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
   headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({item_id:episodeId})});
  if(!response.ok){
   await response.body?.cancel().catch(()=>{});
   if(response.status===403)throw new AppError('WEB_PUBLIC_UNAVAILABLE','官网暂未向当前访客提供此集播放资源，请稍后重试或使用官方 APP 查看。');
   throw invalid();
  }
  const info=safeJson((await bounded(response,64*1024)).toString('utf8'));
  if(info?.base_resp?.StatusCode!==0||typeof info.main_url!=='string'||!Number.isFinite(Number(info.url_expire))||Number(info.url_expire)<=Date.now()/1000+10)throw invalid();
  const url=new URL(info.main_url);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!/^v\d+-(hgweb|reading)\.qznovelvod\.com$/.test(url.hostname))throw invalid();
  const media=await fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{Range:'bytes=0-1048575'}});
  try{
  let size:number,expected:number;
  if(media.status===206){
   const match=/^bytes 0-(\d+)\/(\d+)$/.exec(media.headers.get('content-range')||'');if(!match)throw invalid();
   size=Number(match[2]);expected=Number(match[1])+1;if(expected!==Math.min(size,LIMIT))throw invalid();
  }else if(media.status===200){size=Number(media.headers.get('content-length'));expected=size;if(size>LIMIT)throw invalid()}
  else throw invalid();
  if(!Number.isSafeInteger(size)||size<=0||size>FILE_LIMIT)throw invalid();
  const prefix=await bounded(media,LIMIT);if(prefix.length!==expected)throw invalid();
  const metadata=inspectMp4(prefix);
  return {episodeId,...metadata,size,url:url.href,encrypted:false,availableQualities:[metadata.definition]};
  }finally{await media.body?.cancel().catch(()=>{})}
 }catch(error){if(error instanceof AppError)throw error;throw invalid()}
}
