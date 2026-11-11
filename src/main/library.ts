import {mkdir,readFile,writeFile,rename,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {Library,Work,Progress} from '../shared/types';
import {AppError} from './errors';
export const validId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9]{8,24}$/.test(value);
function safeWork(input:Work):Work{
 if(!input||!validId(input.id)||typeof input.title!=='string')throw new AppError('INVALID_INPUT','作品信息无效');
 return {id:input.id,title:input.title.slice(0,200),cover:typeof input.cover==='string'&&/^https?:\/\//.test(input.cover)?input.cover.slice(0,2048):'',description:String(input.description||'').slice(0,6000),total:Number.isInteger(input.total)&&input.total>=0?input.total:0,categories:Array.isArray(input.categories)?input.categories.filter(c=>typeof c==='string').slice(0,12):[]};
}
export class LibraryStore {
 private value:Library={favorites:[],history:[]};private pending:Promise<unknown>=Promise.resolve();private initialized=false;
 constructor(private dir:string){}
 async init(){
  this.initialized=false;const file=path.join(this.dir,'library.json');let source:string;
  try{await mkdir(this.dir,{recursive:true});source=await readFile(file,'utf8')}
  catch(error){
   if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'){this.value={favorites:[],history:[]};this.initialized=true;return}
   throw new AppError('LIBRARY_READ','收藏和观看记录读取失败，已保留原文件，请检查应用数据目录权限后重试');
  }
  let raw:any;
  try{
   raw=JSON.parse(source);
   if(!raw||typeof raw!=='object'||!Array.isArray(raw.favorites)||!Array.isArray(raw.history))throw new Error('INVALID_LIBRARY');
  }catch{
   // Preserve the original bytes before allowing a new library to replace damaged data.
   try{await copyFile(file,file+'.corrupt-'+Date.now()+'-'+randomUUID(),constants.COPYFILE_EXCL)}
   catch{throw new AppError('LIBRARY_BACKUP','记录文件已损坏，但备份失败；已停止写入以保护原文件')}
   this.value={favorites:[],history:[]};this.initialized=true;return;
  }
  const favorites:Work[]=[],history:Progress[]=[];
  for(const item of raw.favorites){try{favorites.push(safeWork(item))}catch{}}
  for(const item of raw.history){
   try{
    if(!item||!validId(item.seriesId)||!validId(item.episodeId)||!Number.isInteger(item.order)||item.order<1||!Number.isFinite(item.time)||item.time<0||!Number.isFinite(item.duration)||item.duration<=0||item.time>item.duration+2||!Number.isFinite(item.updatedAt))continue;
    const work=safeWork(item.work);if(work.id!==item.seriesId)continue;
    history.push({seriesId:item.seriesId,episodeId:item.episodeId,order:item.order,time:Math.min(item.time,item.duration),duration:item.duration,updatedAt:item.updatedAt,work});
   }catch{}
  }
  this.value={favorites:favorites.slice(0,500),history:history.slice(0,200)};this.initialized=true;
 }
 snapshot():Library{return structuredClone(this.value)}
 private mutate(action:(draft:Library)=>void):Promise<Library>{
  const operation=this.pending.then(async()=>{
   if(!this.initialized)throw new AppError('LIBRARY_NOT_READY','收藏和观看记录尚未安全加载，已停止写入');
   const draft=structuredClone(this.value);action(draft);const file=path.join(this.dir,'library.json');
   try{await writeFile(file+'.tmp',JSON.stringify(draft),'utf8');await rename(file+'.tmp',file)}
   catch{throw new AppError('LIBRARY_WRITE','收藏或观看记录保存失败，请检查磁盘空间和应用数据目录权限')}
   this.value=draft;return this.snapshot();
  });this.pending=operation.catch(()=>{});return operation;
 }
 favorite(work:Work,enabled:boolean){const clean=safeWork(work);return this.mutate(draft=>{draft.favorites=draft.favorites.filter(w=>w.id!==clean.id);if(enabled)draft.favorites.unshift(clean);draft.favorites=draft.favorites.slice(0,500)})}
 async progress(input:Omit<Progress,'updatedAt'>){
  if(!validId(input?.seriesId)||!validId(input?.episodeId)||!Number.isInteger(input.order)||input.order<1||!Number.isFinite(input.time)||input.time<0||!Number.isFinite(input.duration)||input.duration<=0||input.time>input.duration+2)throw new AppError('INVALID_INPUT','观看进度无效');
  const work=safeWork(input.work);if(work.id!==input.seriesId)throw new AppError('INVALID_INPUT','观看进度与作品不一致');
  const progress:Progress={seriesId:input.seriesId,episodeId:input.episodeId,order:input.order,time:Math.min(input.time,input.duration),duration:input.duration,work,updatedAt:Date.now()};
  return this.mutate(draft=>{draft.history=draft.history.filter(p=>p.seriesId!==progress.seriesId);draft.history.unshift(progress);draft.history=draft.history.slice(0,200)})
 }
 async flush(){await this.pending}
}
