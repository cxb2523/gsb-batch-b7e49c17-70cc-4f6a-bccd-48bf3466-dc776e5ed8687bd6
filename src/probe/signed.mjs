import {createHash} from 'node:crypto';

const HOST='https://api5-normal-sinfonlinea.fqnovel.com';
const ID=/^[0-9]{8,24}$/;

// aid=8704 为本次实验参数；其余参数来自参考 TV，不代表官方漫剧协议。
export function buildResourceRequest(id,{aid='8704',now=Date.now()}={}){
 if(typeof id!=='string'||!ID.test(id))throw new Error('INVALID_EPISODE_ID');
 const url=new URL('/novel/player/video_model/v1/',HOST);
 for(const [k,v] of Object.entries({aid,app_name:'novelread',version_code:'72232',version_name:'7.2.2.32',channel:'audit',device_platform:'android',os_version:'12',update_version_code:'72232',_rticket:now}))url.searchParams.set(k,String(v));
 const body=JSON.stringify({video_id:id,content_type:1,biz_param:{need_all_video_definition:true,video_platform:3}});
 const headers={'user-agent':'HongguoTV/0.1','content-type':'application/json; charset=utf-8','x-ss-stub':createHash('md5').update(body).digest('hex').toUpperCase()};
 return {url:url.href,body,headers,method:'POST'};
}

// 只输出证据白名单，绝不序列化原始 model、播放地址或内容密钥。
export function summarizeVideoModel(response){
 const missing={modelFound:false,fullPlaybackVerified:false};
 if(response?.code!==0)return missing;
 let model=response.data?.video_model;
 if(typeof model==='string'){try{model=JSON.parse(model)}catch{return missing}}
 if(!model||typeof model!=='object'||Array.isArray(model))return missing;
 const tracks=model.video_list;
 const duration=model.video_duration;
 return {modelFound:true,...(typeof duration==='number'&&Number.isFinite(duration)?{duration}:{}),fullPlaybackVerified:false,
  tracks:tracks&&typeof tracks==='object'?Object.values(tracks).filter(t=>t&&typeof t==='object').map(t=>({
   ...(typeof t.definition==='string'?{definition:t.definition}:{}),
   ...(typeof t.codec_type==='string'?{codec:t.codec_type}:{}),
   encryption:t.encrypt===true?'encrypted':t.encrypt===false?'clear':'unknown',
   ...(typeof t.encryption_method==='string'?{encryptionMethod:t.encryption_method}:{}),hasResource:typeof t.main_url==='string'&&t.main_url.length>0,
  })):[]};
}

export function summarizeEpisodes(response,seriesId){
 if(response?.code!==0)throw new Error('DETAIL_RESPONSE_FAILED');
 const list=response.data?.[seriesId]?.video_data?.video_list;
 if(!Array.isArray(list))throw new Error('EPISODE_LIST_MISSING');
 return list.map(e=>{
  if(typeof e.vid!=='string'||!ID.test(e.vid)||!Number.isInteger(e.vid_index)||e.vid_index<1)throw new Error('INVALID_EPISODE_ID_OR_ORDER');
  return {id:e.vid,order:e.vid_index,...(typeof e.duration==='number'?{duration:e.duration}:{})};
 }).sort((a,b)=>a.order-b.order);
}
