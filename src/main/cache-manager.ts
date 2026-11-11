import {mkdir,readFile,writeFile,rename,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import type {Series,CacheOverview,Progress,CacheLimits,CachePriority} from '../shared/types';import {MediaCache} from './media';import {validId} from './library';import {AppError} from './errors';

interface Task {series:Series;paused:boolean;createdAt:number;priority:CachePriority}
interface Settings {version:1;directory:string;closeToTray:boolean;tasks:Task[];concurrency:number;knownSeries:Series[];limits:CacheLimits}
const defaultLimits=():CacheLimits=>({maxGiB:20,bandwidthMiB:0});
function cleanLimits(value:CacheLimits):CacheLimits{
 if(!value||!Number.isFinite(value.maxGiB)||value.maxGiB<0||value.maxGiB>10000||!Number.isFinite(value.bandwidthMiB)||value.bandwidthMiB<0||value.bandwidthMiB>1000)throw new AppError('INVALID_INPUT','缓存总额度须为 0–10000 GiB，总下载限速须为 0–1000 MiB/s；0 表示不限制');
 return {maxGiB:value.maxGiB,bandwidthMiB:value.bandwidthMiB};
}
const validPriority=(value:unknown):value is CachePriority=>value==='high'||value==='normal'||value==='low';
const toBytes=(value:number,unit:number)=>value===0?0:Math.max(1,Math.floor(value*unit));
function cleanSeries(series:Series):Series{
 if(!series||!validId(series.id)||typeof series.title!=='string'||!series.title.trim()||!Array.isArray(series.episodes)||!series.episodes.length||series.episodes.length>5000||series.episodes.some((e,i)=>!validId(e.id)||e.order!==i+1)||new Set(series.episodes.map(e=>e.id)).size!==series.episodes.length)throw new AppError('CACHE_SERIES','缓存作品信息或剧集列表无效');
 return {id:series.id,title:series.title.slice(0,200),cover:typeof series.cover==='string'&&/^https?:\/\//.test(series.cover)?series.cover.slice(0,2048):'',description:'',total:series.episodes.length,episodes:series.episodes.map(e=>({id:e.id,order:e.order}))};
}
function parse(source:string,profile:string):Settings{
 const raw=JSON.parse(source);if(raw?.version!==1||typeof raw.directory!=='string'||!path.isAbsolute(raw.directory)||typeof raw.closeToTray!=='boolean'||!Array.isArray(raw.tasks)||raw.tasks.length>100)throw Error('INVALID_SETTINGS');
 const directory=path.resolve(raw.directory),original=path.resolve(profile,'media-cache');
 if(directory!==original&&path.basename(directory)!=='HongguoManjuCache')throw Error('INVALID_DIRECTORY');
 const tasks:Task[]=raw.tasks.map((task:any)=>{if(typeof task.paused!=='boolean'||!Number.isFinite(task.createdAt)||task.priority!==undefined&&!validPriority(task.priority))throw Error('INVALID_TASK');return {series:cleanSeries(task.series),paused:task.paused,createdAt:task.createdAt,priority:task.priority??'normal'}});
 if(new Set(tasks.map(task=>task.series.id)).size!==tasks.length)throw Error('DUPLICATE_TASK');
 const concurrency=raw.concurrency??4;if(![2,4,6].includes(concurrency))throw Error('INVALID_CONCURRENCY');
 if(raw.knownSeries!==undefined&&(!Array.isArray(raw.knownSeries)||raw.knownSeries.length>100))throw Error('INVALID_CACHE_INDEX');
 const knownSeries=(raw.knownSeries??[]).map(cleanSeries);if(new Set(knownSeries.map((item:Series)=>item.id)).size!==knownSeries.length)throw Error('DUPLICATE_CACHE_INDEX');
 const limits=raw.limits===undefined?defaultLimits():cleanLimits(raw.limits);
 return {version:1,directory,closeToTray:raw.closeToTray,tasks,concurrency,knownSeries,limits};
}
export class CacheManager {
 private value:Settings;private pending:Promise<unknown>=Promise.resolve();private message='';private migrating=false;
 constructor(private profile:string,private media:MediaCache,private history:()=>Progress[]=()=>[]){this.value={version:1,directory:media.location,closeToTray:true,tasks:[],concurrency:4,knownSeries:[],limits:defaultLimits()}}
 static async directory(profile:string){try{return parse(await readFile(path.join(profile,'cache-settings.json'),'utf8'),profile).directory}catch{return path.join(profile,'media-cache')}}
 async init(){
  const file=path.join(this.profile,'cache-settings.json');await mkdir(this.profile,{recursive:true});
  try{this.value=parse(await readFile(file,'utf8'),this.profile)}catch(error:any){
   if(error.code!=='ENOENT'){
    try{await copyFile(file,file+'.corrupt-'+randomUUID(),constants.COPYFILE_EXCL);this.message='缓存设置已损坏，已备份原文件。请重新添加缓存任务；已完成媒体保留。'}
    catch{throw new AppError('CACHE_SETTINGS','缓存设置无法读取或备份，请检查应用数据目录权限')}
   }
  }
  this.sync();
 }
 get closeToTray(){return this.value.closeToTray}
 private sync(){this.media.setLimits({maxBytes:toBytes(this.value.limits.maxGiB,1024**3),bytesPerSecond:toBytes(this.value.limits.bandwidthMiB,1024**2)});this.media.setBackgroundGroups(this.value.tasks.map(task=>({id:task.series.id,ids:task.series.episodes.map(e=>e.id),paused:task.paused,priority:task.priority})));this.media.setConcurrency(this.value.concurrency)}
 private async save(value:Settings){const file=path.join(this.profile,'cache-settings.json');try{await writeFile(file+'.tmp',JSON.stringify(value),'utf8');await rename(file+'.tmp',file)}catch{throw new AppError('CACHE_SETTINGS','缓存任务保存失败，请检查磁盘空间及目录权限')}}
 private mutate(fn:(draft:Settings)=>void){const operation=this.pending.then(async()=>{const draft=structuredClone(this.value);fn(draft);await this.save(draft);this.value=draft;this.sync();return this.snapshot()});this.pending=operation.catch(()=>{});return operation}
 async snapshot():Promise<CacheOverview>{
  let freeBytes=0;try{freeBytes=await this.media.freeBytes()}catch{}
  const history=new Map(this.history().map(item=>[item.seriesId,item]));
  return {directory:this.media.location,freeBytes,usedBytes:this.media.usedBytes,migrating:this.migrating,closeToTray:this.closeToTray,message:this.message,concurrency:this.value.concurrency,limits:{...this.value.limits},bytesPerSecond:this.media.downloadBytesPerSecond,tasks:this.listedTasks().map(task=>({...structuredClone(task),watched:this.watched(task,history),state:this.media.stateFor(task.series.episodes.map(e=>e.id))}))};
 }
 private listedTasks(){return [...this.value.tasks.map(task=>({...task,registered:true})),...this.value.knownSeries.filter(series=>{if(this.value.tasks.some(task=>task.series.id===series.id))return false;const ids=series.episodes.map(e=>e.id),state=this.media.stateFor(ids);return state.ready>0||(state.cachedBytes||0)>0||this.media.hasDeletionPending?.(ids)}).map(series=>({series,paused:true,createdAt:0,registered:false}))]}
 remember(series:Series){const clean=cleanSeries(series);return this.mutate(draft=>{draft.knownSeries=[...draft.knownSeries.filter(item=>item.id!==clean.id),clean].slice(-100)})}
 add(series:Series){const clean=cleanSeries(series);return this.mutate(draft=>{const task=draft.tasks.find(task=>task.series.id===clean.id);if(task){task.series=clean;return}if(draft.tasks.length>=100)throw new AppError('CACHE_LIMIT','最多添加 100 部缓存作品，请先移除已不需要的任务');draft.tasks.push({series:clean,paused:false,createdAt:Date.now(),priority:'normal'})})}
 private watched(task:{series:Series},history:Map<string,Progress>){const last=task.series.episodes.at(-1),progress=history.get(task.series.id);return !!(last&&progress&&progress.episodeId===last.id&&progress.order===last.order&&progress.duration>0&&progress.time/progress.duration>=.95)}
 async action(id:string,action:'pause'|'resume'|'retry'|'remove'|'delete'){
  if(!validId(id)||!['pause','resume','retry','remove','delete'].includes(action))throw new AppError('INVALID_INPUT','缓存操作无效');
  if(action==='delete')return this.deleteTask(id);
  const result=await this.mutate(draft=>{let task=draft.tasks.find(task=>task.series.id===id);if(!task&&action!=='remove'){const series=draft.knownSeries.find(item=>item.id===id);if(series){if(draft.tasks.length>=100)throw new AppError('CACHE_LIMIT','最多添加 100 部后台缓存作品，请先移除不需要的任务');task={series,paused:true,createdAt:Date.now(),priority:'normal'};draft.tasks.push(task)}}if(!task)throw new AppError('CACHE_TASK','缓存任务不存在');if(action==='remove'){draft.knownSeries=[...draft.knownSeries.filter(series=>series.id!==id),task.series].slice(-100);draft.tasks=draft.tasks.filter(item=>item.series.id!==id)}else task.paused=action==='pause'});
  if(action==='retry'||action==='resume'){const task=this.value.tasks.find(task=>task.series.id===id);this.media.retryBuffer(task?.series.episodes.map(e=>e.id));return this.snapshot()}
  return result;
 }
 private deleteTask(id:string){
  const operation=this.pending.then(async()=>{
   if(this.migrating)throw new AppError('CACHE_BUSY','缓存正在迁移，请等待完成再删除');
   const draft=structuredClone(this.value);let task=draft.tasks.find(item=>item.series.id===id);if(!task){const series=draft.knownSeries.find(item=>item.id===id);if(series)task={series,paused:true,createdAt:Date.now(),priority:'normal'}}if(!task)throw new AppError('CACHE_TASK','缓存任务不存在');
   task.paused=true;await this.save(draft);this.value=draft;this.sync();
   // Persist the pause first. A failed unlink must never restart the download on relaunch.
   const shared=new Set([...draft.tasks.filter(item=>item.series.id!==id).map(item=>item.series),...draft.knownSeries.filter(item=>item.id!==id)].flatMap(item=>item.episodes.map(episode=>episode.id)));
   const result=await this.media.deleteEpisodes(task.series.episodes.map(episode=>episode.id).filter(id=>!shared.has(id)));
   const next={...draft,tasks:draft.tasks.filter(item=>item.series.id!==id),knownSeries:draft.knownSeries.filter(item=>item.id!==id)};await this.save(next);this.value=next;this.sync();
   this.message=`已删除《${task.series.title}》的缓存，释放 ${(result.freedBytes/1048576).toFixed(1)} MiB；收藏和观看记录保留。`;return this.snapshot();
  });this.pending=operation.catch(()=>{});return operation;
 }
 async deleteWatched(confirmedIds?:string[]){
  const history=new Map(this.history().map(item=>[item.seriesId,item]));const selected=this.listedTasks().filter(task=>this.watched(task,history)&&(!confirmedIds||confirmedIds.includes(task.series.id))).map(task=>task.series.id);
  let count=0;for(const id of selected){await this.action(id,'delete');count++}
  this.message=count?`已清理 ${count} 部已看完作品的缓存，收藏和观看记录保留。`:'暂无可清理的已看完作品缓存。';return this.snapshot();
 }
 async setConcurrency(value:number){if(![2,4,6].includes(value))throw new AppError('INVALID_INPUT','请选择 2、4 或 6 路并行准备');return this.mutate(draft=>{draft.concurrency=value})}
 async setLimits(value:CacheLimits){const limits=cleanLimits(value);return this.mutate(draft=>{draft.limits=limits})}
 async setPriority(id:string,priority:CachePriority){if(!validId(id)||!validPriority(priority))throw new AppError('INVALID_INPUT','缓存任务优先级无效');return this.mutate(draft=>{const task=draft.tasks.find(item=>item.series.id===id);if(!task)throw new AppError('CACHE_TASK','缓存任务不存在');task.priority=priority})}
 setCloseToTray(enabled:boolean){if(typeof enabled!=='boolean')throw new AppError('INVALID_INPUT','关闭窗口设置无效');return this.mutate(draft=>{draft.closeToTray=enabled})}
 migrate(destination:string){
  if(this.migrating)return Promise.reject(new AppError('CACHE_BUSY','缓存正在迁移，请等待完成'));this.migrating=true;
  const operation=this.pending.then(async()=>{
   const draft={...this.value,directory:path.resolve(destination)};
   if(path.basename(draft.directory)!=='HongguoManjuCache')throw new AppError('CACHE_PATH','请选择应用专用缓存文件夹');
   await this.media.relocate(draft.directory,()=>this.save(draft));this.value=draft;this.message='缓存目录已切换。原目录文件已保留，可确认新目录播放正常后自行清理。';return this.snapshot();
  }).finally(()=>{this.migrating=false});this.pending=operation.catch(()=>{});return operation;
 }
 async flush(){await this.pending}
}
