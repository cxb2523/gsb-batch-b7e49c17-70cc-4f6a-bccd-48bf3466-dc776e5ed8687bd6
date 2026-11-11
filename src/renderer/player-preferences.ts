import type {VideoQuality} from '../shared/types';
export const PLAYBACK_RATES=[0.5,0.75,1,1.25,1.5,2];
const RATE_KEY='hongguo.playbackRate';
export function readPlaybackRate(storage?:Pick<Storage,'getItem'>):number{
 try{const value=Number((storage??globalThis.localStorage).getItem(RATE_KEY));return PLAYBACK_RATES.includes(value)?value:1;}catch{return 1}
}
export function savePlaybackRate(value:number,storage?:Pick<Storage,'setItem'>):boolean{
 if(!PLAYBACK_RATES.includes(value))return false;
 try{(storage??globalThis.localStorage).setItem(RATE_KEY,String(value));return true}catch{return false}
}
export interface PlayerPreferences {volume:number;muted:boolean;autoNext:boolean;quality:VideoQuality}
const defaults:PlayerPreferences={volume:0.8,muted:false,autoNext:true,quality:'auto'};
const qualities:VideoQuality[]=['1080p','720p','540p','480p','360p'];
export function qualityChoices(available:string[]=[]):VideoQuality[]{return qualities.filter(value=>available.includes(value));}
export function readPlayerPreferences(storage?:Pick<Storage,'getItem'>):PlayerPreferences{
 try{const raw=JSON.parse((storage??globalThis.localStorage).getItem('hongguo.playerPreferences')||'{}');return {
 volume:typeof raw.volume==='number'&&Number.isFinite(raw.volume)&&raw.volume>=0&&raw.volume<=1?raw.volume:defaults.volume,
 muted:typeof raw.muted==='boolean'?raw.muted:defaults.muted,
 autoNext:typeof raw.autoNext==='boolean'?raw.autoNext:defaults.autoNext,
 quality:raw.quality==='auto'||qualities.includes(raw.quality)?raw.quality:defaults.quality,
 };}catch{return {...defaults}}
}
export function savePlayerPreferences(value:PlayerPreferences,storage?:Pick<Storage,'setItem'>):boolean{
 try{(storage??globalThis.localStorage).setItem('hongguo.playerPreferences',JSON.stringify(value));return true}catch{return false}
}
