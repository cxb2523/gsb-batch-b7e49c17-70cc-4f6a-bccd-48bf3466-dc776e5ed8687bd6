import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {buildResourceRequest,summarizeEpisodes,summarizeVideoModel} from '../src/probe/signed.mjs';

// 研究命令需要已审查的本机 signer；本项目不内置来源不明的签名实现。
const signer=new URL(process.env.HONGGUO_PROBE_SIGNER||'http://127.0.0.1:18974/sign');
if(signer.protocol!=='http:'||signer.hostname!=='127.0.0.1'||signer.username||signer.password)throw new Error('SIGNER_MUST_BE_LOOPBACK');

async function call(request){
 const signed=await fetch(signer,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:request.url,headers:request.headers}),signal:AbortSignal.timeout(30000)});
 if(!signed.ok)throw new Error('SIGNER_HTTP_ERROR');
 const signatures=await signed.json();
 if(!signatures['X-Argus']||!signatures['X-Gorgon'])throw new Error('SIGNATURE_MISSING');
 const result=await fetch(request.url,{method:request.method,headers:{...request.headers,...signatures},body:request.body,signal:AbortSignal.timeout(30000)});
 const text=await result.text();
 if(!result.ok)throw new Error('API_HTTP_ERROR');
 if(!text.trim())throw new Error('API_EMPTY_RESPONSE');
 return {status:result.status,bytes:Buffer.byteLength(text),json:JSON.parse(text)};
}

function detailsRequest(seriesId){
 const r=buildResourceRequest(seriesId);const u=new URL(r.url);u.pathname='/novel/player/multi_video_detail/v1/';r.url=u.href;
 r.body=JSON.stringify({series_id:seriesId,biz_param:{detail_page_version:0,disable_digg_stat:false,disable_video_relate_book:false,need_all_video_definition:false,need_mp4_align:false,screen_width_px:'900',source:7,use_os_player:false,use_server_dns:false}});
 r.headers['x-ss-stub']=createHash('md5').update(r.body).digest('hex').toUpperCase();return r;
}

const report={generatedAt:new Date().toISOString(),stage2Started:false,fullPlaybackVerified:false,
 caveat:'使用参考 TV 参数与研究用 signer；签名 SDK 和独立漫剧 APP 的正式适配尚未确认。资源描述不等于播放验收。',series:[]};
try{
 for(const s of [{seriesId:'7695370827507698713',title:'到末世十年后竟然遇到四个尸王第一季',expectedCount:155},{seriesId:'7692043430955863102',title:'反向拿捏：和闺蜜穿七零带着婆婆一起离',expectedCount:126}]){
  const response=await call(detailsRequest(s.seriesId));const episodes=summarizeEpisodes(response.json,s.seriesId);
  const orders=[1,2,3,Math.floor(episodes.length/2)+1,episodes.length];const samples=[];
  for(const order of orders){const e=episodes.find(e=>e.order===order);if(!e)throw new Error('EXPECTED_EPISODE_MISSING');const media=await call(buildResourceRequest(e.id));samples.push({...e,...summarizeVideoModel(media.json)});}
  report.series.push({...s,actualCount:episodes.length,countMatches:episodes.length===s.expectedCount,episodes,samples});
  console.log(`${s.title}：${episodes.length} 集，抽查 ${samples.length} 集；实际完整播放未由本命令验证。`);
 }
 await writeFile(new URL('../research/signed-result.json',import.meta.url),JSON.stringify(report,null,2));
 process.exitCode=2;
}catch(error){
 // 不打印原始网络异常（可能携带请求 URL），不输出签名、model 或密钥。
 const known=['SIGNER_HTTP_ERROR','SIGNATURE_MISSING','API_HTTP_ERROR','API_EMPTY_RESPONSE','EXPECTED_EPISODE_MISSING'];
 console.error(known.includes(error.message)?error.message:'SIGNED_PROBE_FAILED');process.exitCode=1;
}
