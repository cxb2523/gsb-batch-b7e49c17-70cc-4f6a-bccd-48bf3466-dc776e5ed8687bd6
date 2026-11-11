export function seekPosition(value:number,duration:number):number|undefined{
 if(!Number.isFinite(value)||!Number.isFinite(duration)||duration<=0)return;
 // A manual near-end seek is distinct from reopening a finished episode.
 return Math.max(0,Math.min(value,Math.max(0,duration-.05)));
}

export function visiblePlaybackTime(actual:number,pending:number|null):number{
 return pending===null?actual:pending;
}
