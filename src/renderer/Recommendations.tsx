import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import type {Recommendations as RecommendationData,RelatedWork,Work} from '../shared/types';

export function Recommendations({id,onOpen,renderCard,supplied}:{supplied?:{data:RecommendationData|null;error:string;loading:boolean;retry:()=>void};id:string;onOpen:(id:string)=>void;renderCard:(work:Work,onOpen:()=>void)=>ReactNode}){
 const [ownData,setData]=useState<RecommendationData|null>(null),[ownError,setError]=useState(''),[ownLoading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const data=supplied?supplied.data:ownData,error=supplied?supplied.error:ownError,loading=supplied?supplied.loading:ownLoading;
 useEffect(()=>{
  if(supplied)return;
  let live=true;setLoading(true);setError('');setData(null);
  const timer=window.setTimeout(()=>{void window.desktop.recommendations(id,retry>0).then(result=>{
   if(!live)return;if(!result.ok||!result.data)throw Error(result.error?.message||'推荐暂时不可用，请重试');setData(result.data);
  }).catch(error=>{if(live)setError(error instanceof Error?error.message:'推荐暂时不可用，请重试')}).finally(()=>{if(live)setLoading(false)})},600);
  return()=>{live=false;window.clearTimeout(timer)};
 },[id,retry,!!supplied]);
 const cards=(items:RelatedWork[])=>items.map(item=><div className="related-card" key={item.work.id}>{renderCard(item.work,()=>onOpen(item.work.id))}<p className="related-reason">{item.reason}</p></div>);
 return <section className="playback-recommendations" aria-label="漫剧相关推荐">
  <div className="related-heading"><div><span className="eyebrow">KEEP WATCHING</span><h2>故事还在继续</h2></div><button className="secondary-button" disabled={loading} onClick={()=>supplied?supplied.retry():setRetry(value=>value+1)}>{loading?'查找中…':'重新获取推荐'}</button></div>
  {loading?<p className="related-empty" role="status">正在查找其他季和相似题材，不影响当前播放…</p>:error?<p className="related-empty" role="alert">{error}</p>:data&&<>
   <h3>同名其他季</h3><p className="related-note">根据作品标题匹配，优先展示后续季数；请核对标题和简介。</p>
   {data.seasons.length?<div className="related-grid">{cards(data.seasons)}</div>:<p className="related-empty">暂未找到可核对的同名其他季。</p>}
   <h3>相似题材</h3>{data.similar.length?<div className="related-grid">{cards(data.similar)}</div>:<p className="related-empty">暂未找到有明确题材关联的作品。</p>}
   {data.message&&<p className="related-note" role="status">{data.message}</p>}
  </>}
 </section>;
}
