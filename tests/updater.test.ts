import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {UpdateService} from '../src/main/updater';

class Engine extends EventEmitter {
  autoDownload=true; autoInstallOnAppQuit=true; allowPrerelease=false; allowDowngrade=true; disableDifferentialDownload=false;
  checks=0; downloads=0; installs=0; failCheck=false; failDownload=false;
  async checkForUpdates(){this.checks++;if(this.failCheck)throw new Error('secret URL');this.emit('update-available',{version:'0.2.4'});return {};}
  async downloadUpdate(){this.downloads++;if(this.failDownload)throw new Error('secret URL');this.emit('download-progress',{percent:46.2,transferred:46,total:100});return [];}
  quitAndInstall(){this.installs++;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('checks only notify; an explicit download request downloads once and installation waits for confirmation',async()=>{
  const engine=new Engine();let requests=0;const states:string[]=[];
  const service=new UpdateService(engine,'0.2.3',true,s=>states.push(s.status),()=>{requests++;});
  assert.equal(engine.autoDownload,false);assert.equal(engine.autoInstallOnAppQuit,false);
  assert.equal(engine.allowPrerelease,false);assert.equal(engine.allowDowngrade,false);
  await Promise.all([service.check(),service.check()]);await tick();
  assert.equal(engine.checks,1);assert.equal(engine.downloads,0);
  assert.equal(service.snapshot().status,'available');
  await service.check();await tick();assert.equal(engine.downloads,0);
  assert.equal(requests,0);assert.equal(engine.installs,0);
  await Promise.all([service.download(),service.download()]);assert.equal(engine.downloads,1);
  assert.equal(service.snapshot().status,'downloading');assert.equal(service.snapshot().percent,46.2);
  assert.equal(requests,0);assert.equal(engine.installs,0);
  engine.emit('update-downloaded',{version:'0.2.4'});
  await service.check();assert.equal(engine.checks,1);
  service.requestInstall();service.requestInstall();assert.equal(requests,1);assert.equal(engine.installs,0);
  service.installAfterShutdown();assert.equal(engine.installs,1);
  assert.ok(states.includes('downloaded'));
});
test('failed check and download expose retry without leaking internal errors',async()=>{
  const engine=new Engine();engine.failCheck=true;const service=new UpdateService(engine,'0.2.3',true,()=>{},()=>{});
  await service.check();assert.equal(service.snapshot().status,'error');assert.doesNotMatch(service.snapshot().message,/secret/);
  engine.failCheck=false;engine.failDownload=true;await service.check();await service.download();
  assert.equal(service.snapshot().status,'error');assert.match(service.snapshot().message,/下载/);
  engine.failDownload=false;await service.download();assert.equal(engine.downloads,2);
  engine.emit('update-downloaded',{version:'0.2.4'});assert.equal(service.snapshot().status,'downloaded');
});
test('development mode never accesses releases or installs; installation requires downloaded state',async()=>{
  const engine=new Engine();const service=new UpdateService(engine,'0.2.3',false,()=>{},()=>{});
  await service.check();await service.download();service.requestInstall();service.installAfterShutdown();
  assert.equal(service.snapshot().status,'unsupported');assert.equal(engine.checks+engine.downloads+engine.installs,0);
  const packaged=new UpdateService(new Engine(),'0.2.3',true,()=>{},()=>{});
  packaged.requestInstall();assert.equal(packaged.snapshot().status,'idle');
});
test('no-update is current and error events do not crash the process',async()=>{
  const engine=new Engine();engine.checkForUpdates=async()=>{engine.emit('update-not-available');return {};};
  const service=new UpdateService(engine,'0.2.3',true,()=>{},()=>{});await service.check();assert.equal(service.snapshot().status,'current');
  engine.emit('error',new Error('network token'));assert.equal(service.snapshot().status,'error');assert.doesNotMatch(service.snapshot().message,/token/);
});
test('an installer launch failure is reported rather than thrown after shutdown',()=>{
 const engine=new Engine();engine.quitAndInstall=()=>{throw new Error('spawn EACCES');};
 const service=new UpdateService(engine,'0.2.3',true,()=>{},()=>{});
 engine.emit('update-downloaded',{version:'0.2.4'});service.requestInstall();
 assert.doesNotThrow(()=>service.installAfterShutdown());assert.equal(service.snapshot().status,'error');
});
test('download errors become retryable only after the pending download has settled',async()=>{
 const engine=new Engine();let finish!:()=>void;
 engine.downloadUpdate=async()=>{engine.emit('error',new Error('checksum mismatch'));await new Promise<void>(resolve=>{finish=resolve;});throw new Error('checksum mismatch');};
 const service=new UpdateService(engine,'0.2.3',true,()=>{},()=>{});await service.check();void service.download();await tick();
 assert.equal(service.snapshot().status,'downloading');finish();await tick();assert.equal(service.snapshot().status,'error');
});
