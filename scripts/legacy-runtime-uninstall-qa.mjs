// Reproduce the old uninstaller's :2 failure with a deliberately orphaned Java
// worker and the stock installer's restricted-PowerShell fallback. QA identity only.
// The stock installer displays its expected error even with /S: acknowledge OK
// in the "Hongguo Manju Update QA" error dialog so its exit code can be recorded.
import {spawn,execFileSync} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('outputs/update-cache-shutdown-qa'),install=path.join(root,'installed');
assert.ok(install.startsWith(path.resolve('outputs')+path.sep));
const report=JSON.parse(await readFile(path.join(root,'report.json'),'utf8'));assert.equal(report.passed,true,'run the full upgrade regression first');
const profile=path.join(root,'profile'),cache=path.join(profile,'media-cache');
const snapshot=async()=>{const result={};for(const name of await readdir(cache))if(/\.mp4$/.test(name))result[name]=createHash('sha256').update(await readFile(path.join(cache,name))).digest('hex');return result};
const run=(file,env={})=>new Promise((resolve,reject)=>{const child=spawn(file,['/S','/currentuser',`/D=${install}`],{env:{...process.env,...env},windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('close',resolve)});
const baseline=path.join(root,'baseline/qa-0.5.0.exe'),target=path.join(root,'target/qa-0.5.1.exe');
assert.equal(await run(baseline),0);
const orphan=spawn(path.join(install,'resources/runtime-bundle/java/bin/java.exe'),['-Xmx128m','-cp',path.join(install,'resources/runtime-bundle/classes')+';'+path.join(install,'resources/runtime-bundle/dependencies.jar'),'app.hongguo.runtime.SignerBridge',path.join(install,'resources/runtime-bundle/sdk')],{cwd:profile,windowsHide:true,stdio:['pipe','ignore','ignore']});
await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(orphan.exitCode,null);
const before=await snapshot();
try{
 const oldExitCode=await run(baseline,{PSExecutionPolicyPreference:'Restricted'});
 console.log(JSON.stringify({step:'old installer with orphaned runtime',oldExitCode,orphanStillRunning:orphan.exitCode===null}));
 assert.equal(oldExitCode,2,'reproduce the reported uninstall failure, not just an arbitrary installer error');
 assert.equal(orphan.exitCode,null);
 const fixedExitCode=await run(target,{PSExecutionPolicyPreference:'Restricted'});assert.equal(fixedExitCode,0);
 assert.notEqual(orphan.exitCode,null,'new installer must release this installation\'s orphan');
 assert.deepEqual(await snapshot(),before,'complete cached videos are byte-identical through failed and successful installs');
 const result={passed:true,oldExitCode,fixedExitCode,completeCachePreserved:true,controlledPowerShellFallback:true,remoteCauseNotProven:true};
 await writeFile(path.join(root,'legacy-orphan-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(orphan.exitCode===null)orphan.kill()}
