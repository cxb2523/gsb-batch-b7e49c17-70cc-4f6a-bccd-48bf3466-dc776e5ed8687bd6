import type {BufferState,Episode} from '../shared/types';

export function cacheProgressText(state:BufferState|null,episodes:Episode[],error=''){
 if(error)return error;
 if(!state)return '正在读取缓存状态…';
 if(state.status==='complete')return '全剧已缓存';
 if(state.status==='paused'||state.status==='partial')return state.message;
 if(!state.activeId)return '等待当前集就绪后继续缓存';
 const order=episodes.find(item=>item.id===state.activeId)?.order;
 const label=order?`第 ${order} 集`:'当前任务';
 const activity=state.active;
 if(activity?.stage==='downloading')return `${label} · 下载 ${activity.percent??0}%（${((activity.transferred??0)/1048576).toFixed(1)} / ${((activity.total??0)/1048576).toFixed(1)} MiB）`;
 if(activity?.stage==='processing')return `${label} · 处理 ${activity.percent??0}%`;
 if(activity?.stage==='waiting')return `${label} · 下载完成，等待视频处理`;
 if(activity?.stage==='finalizing')return `${label} · 正在保存`;
 return `${label} · 正在获取资源`;
}

export function CacheProgress({state,episodes,error,onRetry}:{state:BufferState|null;episodes:Episode[];error:string;onRetry:()=>void}){
 const percent=state&&state.total>0?Math.floor(state.ready/state.total*100):0;
 return <section className="series-buffer" aria-label="整剧缓存进度">
  <div className="cache-heading"><strong>整剧缓存</strong><span>{state?`已缓存 ${state.ready}/${state.total} 集`:'正在读取缓存状态…'}</span><b>{percent}%</b>
   {(error||state?.status==='paused'||!!state?.failed)&&<button className="secondary-button" onClick={onRetry}>重试缓存</button>}
  </div>
  <progress className="cache-progress" value={state?.ready??0} max={state?.total||1} aria-label="整剧已缓存集数" />
  <div className="cache-detail"><span>{cacheProgressText(state,episodes,error)}</span>{!!state?.failed&&state.status!=='partial'&&<span>{state.failed} 集准备失败</span>}</div>
 </section>;
}
