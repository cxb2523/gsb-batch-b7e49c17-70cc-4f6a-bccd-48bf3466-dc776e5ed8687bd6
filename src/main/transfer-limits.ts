import {AppError} from './errors';
interface Waiter{bytes:number;signal:AbortSignal;resolve:()=>void;reject:(error:unknown)=>void;abort:()=>void}
export class TransferLimiter{
 private rate=0;private tokens=0;private at=Date.now();private queue:Waiter[]=[];private timer:ReturnType<typeof setTimeout>|undefined;
 setRate(rate:number){if(rate===this.rate)return;this.refill();this.rate=rate;this.tokens=Math.min(this.tokens,Math.max(65536,rate/4));if(rate>0&&!this.tokens)this.tokens=Math.max(65536,rate/4);this.pump()}
 private refill(){const now=Date.now();if(this.rate)this.tokens=Math.min(Math.max(65536,this.rate/4),this.tokens+(now-this.at)*this.rate/1000);this.at=now}
 async consume(bytes:number,signal:AbortSignal){for(let left=bytes;left>0;left-=65536)await this.take(Math.min(65536,left),signal)}
 private take(bytes:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted)return Promise.reject(new AppError('CANCELLED','播放准备已取消'));if(!this.rate)return Promise.resolve();
  return new Promise((resolve,reject)=>{const waiter:Waiter={bytes,signal,resolve,reject,abort:()=>{this.queue=this.queue.filter(item=>item!==waiter);signal.removeEventListener('abort',waiter.abort);reject(new AppError('CANCELLED','播放准备已取消'));this.pump()}};signal.addEventListener('abort',waiter.abort,{once:true});this.queue.push(waiter);this.pump()});
 }
 private pump(){
  clearTimeout(this.timer);this.refill();
  while(this.queue.length&&(!this.rate||this.tokens>=this.queue[0].bytes)){const item=this.queue.shift()!;item.signal.removeEventListener('abort',item.abort);if(this.rate)this.tokens-=item.bytes;item.resolve()}
  if(this.queue.length&&this.rate)this.timer=setTimeout(()=>this.pump(),Math.max(1,Math.min(1000,Math.ceil((this.queue[0].bytes-this.tokens)/this.rate*1000))));
 }
 close(){clearTimeout(this.timer);for(const item of [...this.queue])item.abort();clearTimeout(this.timer)}
}
