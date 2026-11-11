import type {UpdateState} from '../shared/types';

// Only the main process owns this port; renderer cannot choose update URLs or paths.
interface UpdateEngine {
 autoDownload:boolean; autoInstallOnAppQuit:boolean; allowPrerelease:boolean; allowDowngrade:boolean; disableDifferentialDownload:boolean;
 on(event:string,listener:(...args:any[])=>void):unknown;
 checkForUpdates():Promise<unknown>;
 downloadUpdate():Promise<unknown>;
 quitAndInstall(isSilent?:boolean,isForceRunAfter?:boolean):void;
}
export class UpdateService {
 private state:UpdateState;
 private checking?:Promise<UpdateState>;
 private downloading?:Promise<UpdateState>;
 private installPending=false;
 constructor(private engine:UpdateEngine,version:string,private enabled:boolean,private changed:(state:UpdateState)=>void,private shutdown:()=>void){
  this.state={status:enabled?'idle':'unsupported',currentVersion:version,message:enabled?'启动后会自动检查更新。':'开发模式不执行更新，请使用已安装的 Windows 版本。'};
  engine.autoDownload=false;engine.autoInstallOnAppQuit=false;engine.allowPrerelease=false;engine.allowDowngrade=false;
  // This project publishes full installers (NSIS differentialPackage=false).
  engine.disableDifferentialDownload=true;
  engine.on('update-available',info=>{this.set({status:'available',nextVersion:info.version,message:`发现新版本 ${info.version}，点击“立即更新”开始下载；暂不更新可继续使用当前版本。`});});
  engine.on('update-not-available',()=>this.set({status:'current',nextVersion:undefined,message:'当前已是最新版本。'}));
  engine.on('download-progress',progress=>this.set({status:'downloading',percent:Math.max(0,Math.min(100,progress.percent)),transferred:progress.transferred,total:progress.total,message:'正在下载更新，你可以继续观看。'}));
  engine.on('update-downloaded',info=>this.set({status:'downloaded',nextVersion:info.version,percent:100,message:'更新已下载并校验，点击重启安装。收藏和观看记录会保留。'}));
  // Check/download reject their promise as well as emitting error. Publish failure
  // only after that operation settles so a retry cannot reuse a dying promise.
  engine.on('error',()=>{if(!this.checking&&!this.downloading)this.failed();});
 }
 snapshot():UpdateState{return {...this.state};}
 private set(change:Partial<UpdateState>){this.state={...this.state,...change};this.changed(this.snapshot());}
 private failed(){
  const downloading=!!this.state.nextVersion&&this.state.status!=='installing';
  this.installPending=false;
  this.set({status:'error',message:downloading?'更新下载或校验失败，请检查网络与磁盘空间后重试。':'更新检查或安装未完成，请重试；也可从本仓库 Releases 手动下载安装。'});
 }
 check():Promise<UpdateState>{
  if(!this.enabled||['available','downloading','downloaded','installing'].includes(this.state.status))return Promise.resolve(this.snapshot());
  if(this.checking)return this.checking;
  this.set({status:'checking',nextVersion:undefined,percent:undefined,message:'正在检查新版本…'});
  this.checking=Promise.resolve().then(()=>this.engine.checkForUpdates()).catch(()=>this.failed()).then(()=>this.snapshot()).finally(()=>{this.checking=undefined;});
  return this.checking;
 }
 download():Promise<UpdateState>{
  if(this.downloading)return this.downloading;
  if(!this.enabled||!this.state.nextVersion||!['available','error'].includes(this.state.status))return Promise.resolve(this.snapshot());
  this.set({status:'downloading',percent:0,transferred:0,total:undefined,message:'正在下载更新，你可以继续观看。'});
  this.downloading=Promise.resolve().then(()=>this.engine.downloadUpdate()).catch(()=>this.failed()).then(()=>this.snapshot()).finally(()=>{this.downloading=undefined;});
  return this.downloading;
 }
 requestInstall():UpdateState{
  if(!this.enabled||this.state.status!=='downloaded'||this.installPending)return this.snapshot();
  this.installPending=true;this.set({status:'installing',message:'正在保存观看进度并准备重启安装…'});this.shutdown();return this.snapshot();
 }
 installAfterShutdown(){
  if(!this.installPending)return;
  this.installPending=false;try{this.engine.quitAndInstall(true,true);}catch{this.failed();}
 }
}
