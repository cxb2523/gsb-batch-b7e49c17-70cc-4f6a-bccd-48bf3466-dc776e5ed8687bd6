import type {Work} from '../shared/types';
export type SleepPlan={kind:'off'}|{kind:'deadline';deadline:number}|{kind:'episodes';remaining:number}|{kind:'stopped'};
export function sleepExpired(plan:SleepPlan,now=Date.now()):boolean{return plan.kind==='stopped'||plan.kind==='deadline'&&now>=plan.deadline;}
export function episodeFinished(plan:SleepPlan,now=Date.now()):SleepPlan{
 if(sleepExpired(plan,now))return {kind:'stopped'};
 if(plan.kind==='episodes')return plan.remaining<=1?{kind:'stopped'}:{kind:'episodes',remaining:plan.remaining-1};
 return plan;
}
function parts(title:string):{base:string;season:number}|undefined{
 const match=title.normalize('NFKC').trim().match(/^(.*?)第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[季部]$/u);
 if(!match)return;
 const digits:Record<string,number>={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 let season=0,pending=0;
 if(/^\d+$/.test(match[2]))season=Number(match[2]);else{for(const char of match[2]){if(char in digits)pending=digits[char];else{season+=(pending||1)*(char==='十'?10:100);pending=0}}season+=pending;}
 const base=match[1].replace(/\s/gu,'').toLowerCase();
 if(base&&Number.isSafeInteger(season)&&season>0)return {base,season};
}
export function nextSeason(current:Work,candidates:Work[]):Work|undefined{
 const own=parts(current.title);if(!own)return;
 const matches=[...new Map(candidates.filter(item=>{const parsed=parts(item.title);return item.id!==current.id&&parsed?.base===own.base&&parsed.season===own.season+1}).map(item=>[item.id,item])).values()];
 return matches.length===1?matches[0]:undefined;
}
