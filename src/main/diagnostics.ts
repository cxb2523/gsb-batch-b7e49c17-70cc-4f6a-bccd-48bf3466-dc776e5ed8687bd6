const STAGES=new Set(['resolve','download','waiting','processing','save','playback','ipc']);
export class Diagnostics{
 private events:{at:string;stage:string;code:string;ms?:number}[]=[];
 record(value:unknown){
  const data=value as Record<string,unknown>;if(!data||!STAGES.has(String(data.stage)))return;
  const code=typeof data.code==='string'&&/^[A-Z0-9_]{1,50}$/.test(data.code)?data.code:'UNKNOWN';
  this.events.push({at:new Date().toISOString(),stage:String(data.stage),code,...(typeof data.ms==='number'&&Number.isFinite(data.ms)&&data.ms>=0?{ms:Math.round(data.ms)}:{})});if(this.events.length>200)this.events.shift();
 }
 snapshot(version:string){return {schema:1,version:/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)?version:'unknown',platform:process.platform,arch:process.arch,events:structuredClone(this.events)}}
}
