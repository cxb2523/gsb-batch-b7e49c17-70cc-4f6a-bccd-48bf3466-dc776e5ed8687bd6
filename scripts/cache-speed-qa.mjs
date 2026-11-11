// Measure the two real FFmpeg preparation paths on one generated H.264 source.
import {execFileSync} from 'node:child_process';
import {mkdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve(`outputs/cache-speed-qa-${Date.now()}`);await mkdir(output,{recursive:true});
const ffmpeg=path.resolve('runtime-bundle/ffmpeg.exe'),input=path.join(output,'source.mp4');
const run=args=>execFileSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
run(['-y','-f','lavfi','-i','testsrc2=s=1920x1080:r=24','-f','lavfi','-i','sine=frequency=440','-t','20','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-c:a','aac',input]);
const timings={};
for(const mode of ['encode','copy']){
 const file=path.join(output,mode+'.mp4'),start=performance.now();
 run(['-i',input,...(mode==='copy'?['-c:v','copy']:['-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','veryfast','-threads','2','-crf','20']),'-c:a','aac','-movflags','+faststart','-y',file]);
 timings[mode]={ms:Math.round(performance.now()-start),bytes:(await stat(file)).size};
 // Decode all output video and audio to the end; command exit alone from remux is insufficient.
 const progress=run(['-nostats','-progress','pipe:1','-i',file,'-f','null','-']).toString();
 const seconds=Number([...progress.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1])/1e6;assert.ok(seconds>=19.9&&seconds<21);
}
const report={passed:true,fixture:'generated H.264/AAC, 1920x1080, 24fps, 20 seconds',timings,limits:'Local single-source comparison. HEVC still requires encoding; network and hardware change observed times.'};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,output},null,2));
