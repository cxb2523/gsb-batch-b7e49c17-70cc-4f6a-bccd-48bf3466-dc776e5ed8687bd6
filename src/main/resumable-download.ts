import {AppError} from './errors';
import {open, readFile, writeFile, rename, unlink, type FileHandle} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export interface DownloadMediaOptions {
 url:string;path:string;metadataPath:string;size:number;fingerprint:string;signal:AbortSignal;
 onProgress?:(transferred:number,total:number)=>void;
 onChunk?:(chunk:Uint8Array,offset:number)=>Promise<void>|void;
 throttle?:(bytes:number,signal:AbortSignal)=>Promise<void>;
 idleTimeoutMs?:number;
}

interface PartialMetadata {
 version:1;size:number;fingerprint:string;etag?:string;lastModified?:string;bytes:number;
}
const cancelled=()=>new AppError('CANCELLED','播放准备已取消');
const incomplete=()=>new AppError('INCOMPLETE_RESOURCE','视频资源大小或续传响应不一致，请重试');
const network=()=>new AppError('NETWORK','视频连接中断或读取超时，请检查网络后重试');
const check=(signal:AbortSignal)=>{if(signal.aborted)throw cancelled()};
const strongEtag=(value:unknown):value is string=>typeof value==='string'&&/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);

// Only these fields cross the persistence boundary. In particular URLs and keys never do.
async function persist(file:string, metadata:PartialMetadata){
 const temporary=`${file}.${randomUUID()}.tmp`;
 try{
  await writeFile(temporary,JSON.stringify({version:1,size:metadata.size,fingerprint:metadata.fingerprint,
   ...(metadata.etag?{etag:metadata.etag}:{}),...(metadata.lastModified?{lastModified:metadata.lastModified}:{}),bytes:metadata.bytes}));
  await rename(temporary,file);
 }finally{await unlink(temporary).catch(()=>{})}
}
async function writeAll(handle:FileHandle, chunk:Uint8Array, position:number, signal:AbortSignal){
 let written=0;
 while(written<chunk.length){
  check(signal);
  const result=await handle.write(chunk,written,chunk.length-written,position+written);
  if(!result.bytesWritten)throw new AppError('MEDIA_CACHE','磁盘写入未完成');
  written+=result.bytesWritten;
 }
}
function backoff(ms:number,signal:AbortSignal):Promise<void>{
 check(signal);
 return new Promise((resolve,reject)=>{
  const cleanup=()=>signal.removeEventListener('abort',abort);
  const timer=setTimeout(()=>{cleanup();resolve()},ms);
  const abort=()=>{clearTimeout(timer);cleanup();reject(cancelled())};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
 });
}

/** Download one representation. Callers must serialize access to the two cache paths. */
export async function downloadMedia(options:DownloadMediaOptions):Promise<void>{
 const {url,path,metadataPath,size,fingerprint,signal,onChunk,onProgress,throttle}=options;
 const idleTimeoutMs=options.idleTimeoutMs??45000;
 check(signal);
 if(!Number.isSafeInteger(size)||size<=0||!fingerprint||!Number.isFinite(idleTimeoutMs)||idleTimeoutMs<=0||path===metadataPath)
  throw new AppError('INVALID_INPUT','视频下载参数无效');
 let handle:FileHandle|undefined;
 let metadata:PartialMetadata={version:1,size,fingerprint,bytes:0};
 let delivered=false;
 const progress=()=>{
  try{onProgress?.(metadata.bytes,size)}catch{check(signal);throw new AppError('MEDIA_STREAM','视频进度处理失败，请重试')}
  check(signal);
 };
 const emit=async(chunk:Uint8Array,offset:number)=>{
  check(signal);if(!onChunk)return;
  delivered=true;
  try{await onChunk(chunk,offset)}catch{check(signal);throw new AppError('MEDIA_STREAM','视频流处理失败，请重试')}
  check(signal);
 };
 try{
  handle=await open(path,'r+').catch(async(error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return open(path,'w+');throw error});
  const length=(await handle.stat()).size;
  let saved:Partial<PartialMetadata>|undefined;
  try{saved=JSON.parse(await readFile(metadataPath,'utf8'))}catch{/* A missing or corrupt checkpoint cannot authorize reuse. */}
  // Last-Modified has one-second granularity and is not always a strong validator.
  // Without a strong ETag, restart instead of trusting bytes from an older request.
  if(saved&&saved.version===1&&saved.size===size&&saved.fingerprint===fingerprint&&
   Number.isSafeInteger(saved.bytes)&&saved.bytes!>=0&&saved.bytes!<size&&saved.bytes!<=length&&strongEtag(saved.etag)){
   metadata={version:1,size,fingerprint,bytes:saved.bytes!,etag:saved.etag,
    ...(typeof saved.lastModified==='string'?{lastModified:saved.lastModified}:{})};
  }
  // bytes === size alone does not prove EOF: cancellation/overflow may follow the
  // final data chunk. The checkpoint schema intentionally has no completion flag.
  // Completed inputs belong to the caller; reopening one starts a fresh transfer.
  await handle.truncate(metadata.bytes);
  await persist(metadataPath,metadata);
  const reset=async()=>{
   await handle!.truncate(0);
   metadata={version:1,size,fingerprint,bytes:0};await persist(metadataPath,metadata);
   if(delivered)throw new AppError('DOWNLOAD_RESTART_REQUIRED','视频资源已变化，请关闭流式处理后重新准备');
  };
  if(onChunk&&metadata.bytes){
   const buffer=Buffer.alloc(Math.min(256*1024,metadata.bytes));let offset=0;
   while(offset<metadata.bytes){
    check(signal);const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,metadata.bytes-offset),offset);
    if(!bytesRead)throw incomplete();await emit(Buffer.from(buffer.subarray(0,bytesRead)),offset);offset+=bytesRead;
   }
  }
  progress();
  for(let attempt=0;attempt<3;attempt++){
   check(signal);
   // A retry without a validator cannot establish that the saved prefix still matches.
   if(metadata.bytes&&(metadata.bytes===size||!strongEtag(metadata.etag)))await reset();
   const requestStart=metadata.bytes;
   const controller=new AbortController();
   const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)abort();
   let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,completed=false;
   const timed=async<T>(operation:()=>Promise<T>):Promise<T>=>{
    const timer=setTimeout(()=>controller.abort(),idleTimeoutMs);
    try{return await operation()}finally{clearTimeout(timer)}
   };
   try{
    try{
     response=await timed(()=>fetch(url,{signal:controller.signal,headers:{'Accept-Encoding':'identity',
      ...(requestStart?{'Range':`bytes=${requestStart}-`,'If-Range':metadata.etag!}:{})}}));
    }catch{check(signal);throw network()}
    check(signal);
    if(response.status!==200&&response.status!==206){
     if(response.status===408||response.status===429||response.status>=500)throw network();
     throw new AppError('RESOURCE_EXPIRED','视频资源已失效，请重试当前集');
    }
    if(!response.body)throw incomplete();
    if(requestStart&&response.status===200)await reset();
    const start=metadata.bytes;
    const etag=response.headers.get('etag');
    if(start&&etag&&etag!==metadata.etag){await reset();throw network()}
    if(response.status===206){
     const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')??'');
     if(!match||Number(match[1])!==start||Number(match[2])!==size-1||Number(match[3])!==size)throw incomplete();
    }
    const encoding=response.headers.get('content-encoding');
    if(encoding&&encoding.toLowerCase()!=='identity')throw incomplete();
    const expected=size-start,headerLength=response.headers.get('content-length');
    if(headerLength!==null&&(!/^\d+$/.test(headerLength)||Number(headerLength)!==expected))throw incomplete();
    metadata={version:1,size,fingerprint,bytes:start,
     ...(strongEtag(etag)?{etag}:start&&metadata.etag?{etag:metadata.etag}:{}),
     ...(response.headers.get('last-modified')?{lastModified:response.headers.get('last-modified')!}:{})};
    await persist(metadataPath,metadata);
    reader=response.body.getReader();
    while(true){
     check(signal);
     let next:ReadableStreamReadResult<Uint8Array>;
     try{next=await timed(()=>reader!.read())}catch{check(signal);throw network()}
     const {done,value}=next;
     check(signal);if(done)break;
     if(!value.length)continue;
     const offset=metadata.bytes;
     if(offset+value.length>size)throw incomplete();
     if(throttle){try{await throttle(value.length,signal)}catch{check(signal);throw new AppError('MEDIA_STREAM','视频下载调度失败，请重试')}}
     check(signal);
     await writeAll(handle,value,offset,signal);
     await handle.sync();
     const checkpoint={...metadata,bytes:offset+value.length};
     await persist(metadataPath,checkpoint);metadata=checkpoint;
     await emit(value,offset);progress();
    }
    if(metadata.bytes!==size)throw incomplete();
    check(signal);completed=true;return;
   }catch(error){
    check(signal);
    // Protocol/caller/disk failures are terminal. Only transport failures retry.
    if(error instanceof AppError&&error.code!=='NETWORK')throw error;
    if(error instanceof AppError&&error.code==='NETWORK'){
     if(attempt===2)throw network();
    }else throw new AppError('MEDIA_CACHE','无法写入视频缓存，请检查磁盘后重试');
   }finally{
    if(!completed)controller.abort();signal.removeEventListener('abort',abort);
    if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}
    else if(response?.body)await response.body.cancel().catch(()=>{});
   }
   await backoff(200*2**attempt,signal);
  }
 }catch(error){
  if(signal.aborted)throw cancelled();
  if(error instanceof AppError)throw error;
  throw new AppError('MEDIA_CACHE','无法读写视频缓存，请检查磁盘后重试');
 }finally{
  // A failed/partial write never extends the committed prefix recorded in metadata.
  if(handle){
   let failed=false;
   try{await handle.truncate(metadata.bytes)}catch{failed=true}
   try{await handle.close()}catch{failed=true}
   if(failed)throw new AppError('MEDIA_CACHE','无法保存视频缓存，请检查磁盘后重试');
  }
 }
}
