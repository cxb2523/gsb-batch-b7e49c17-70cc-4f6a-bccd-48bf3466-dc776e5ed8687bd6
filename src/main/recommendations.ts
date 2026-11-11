import type {ContentProvider} from './provider';
import type {Work} from '../shared/types';
import {validId} from './library';
import {AppError} from './errors';

export interface RecommendationResult {
 seasons:{work:Work;reason:string}[];
 similar:{work:Work;reason:string}[];
 message:string;
}
type Source=Pick<ContentProvider,'getSeries'|'search'|'catalog'>;
const TTL=300_000, CACHE_LIMIT=32, CANDIDATE_LIMIT=120;
// Deliberately bounded vocabulary: shared ordinary words alone are not genre evidence.
const TOPICS=['末世','重生','穿越','修仙','玄幻','都市','悬疑','科幻','恋爱','甜宠','古装','武侠','系统','复仇','校园','职场','灵异','搞笑','冒险','历史','异能','机甲','丧尸','探案'];
const normalize=(value:string)=>value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
const GENERIC_CATEGORIES=new Set(['漫剧','短剧','ai漫剧','ai短剧','全部','其他','其它','男频','女频','推荐','热门','热播','精选','动漫','动画']);
function numeral(text:string):number {
 if(/^\d+$/.test(text))return Number(text);
 const digits:Record<string,number>={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 let result=0,pending=0;
 for(const char of text){if(char in digits)pending=digits[char];else{result+=(pending||1)*(char==='十'?10:100);pending=0;}}
 return result+pending;
}
function titleParts(title:string):{base:string;season?:number} {
 const clean=title.normalize('NFKC').trim().replace(/[\s\p{P}\p{S}]+$/gu,'');
 const match=clean.match(/^(.*?)第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[季部]$/u);
 if(!match)return {base:normalize(clean)};
 const season=numeral(match[2]);
 return {base:normalize(match[1]),...(season>0&&Number.isSafeInteger(season)?{season}:{})};
}
function topics(work:Work):string[]{const text=(work.title+' '+work.description).slice(0,6000);return TOPICS.filter(tag=>text.includes(tag));}
function categories(work:Work):string[]{return [...new Set((work.categories??[]).filter(x=>typeof x==='string').slice(0,20).map(normalize).filter(x=>!!x&&!GENERIC_CATEGORIES.has(x)))];}

export class RecommendationService {
 private readonly cache=new Map<string,{expires:number;result:RecommendationResult}>();
 private readonly pending=new Map<string,Promise<RecommendationResult>>();
 constructor(private readonly source:Source){}
 async get(id:string,refresh=false):Promise<RecommendationResult>{
  if(!validId(id)||typeof refresh!=='boolean')throw new AppError('INVALID_INPUT','作品编号或刷新请求无效');
  if(refresh)this.cache.delete(id);
  const cached=this.cache.get(id);
  if(cached&&cached.expires>Date.now())return structuredClone(cached.result);
  this.cache.delete(id);
  const existing=this.pending.get(id);if(existing)return structuredClone(await existing);
  // Limit simultaneous distinct lookups as well as retained cache entries.
  if(this.pending.size>=CACHE_LIMIT)throw new AppError('RECOMMENDATIONS_BUSY','推荐查询较多，请稍后重试');
  const task=this.load(id);this.pending.set(id,task);
  try{return structuredClone(await task);}finally{this.pending.delete(id);}
 }
 private async load(id:string):Promise<RecommendationResult>{
  const current=await this.source.getSeries(id);
  const own=titleParts(current.title),ownTopics=topics(current),ownCategories=categories(current);
  const candidates=new Map<string,Work>();let failures=0,successes=0;
  const add=(items:Work[])=>{for(const work of items.slice(0,40))if(candidates.size<CANDIDATE_LIMIT&&validId(work.id)&&work.id!==id&&typeof work.title==='string'&&work.title.trim()&&!candidates.has(work.id))candidates.set(work.id,work);};
  const fetchPage=async(query?:string,offset=0)=>{
   try{const page=query===undefined?await this.source.catalog('recommend'):await this.source.search(query,offset);successes++;add(page.items);return page;}catch{failures++;return undefined;}
  };
  // At most six candidate requests, sequential to avoid burdening the upstream API.
  const baseQuery=own.base.slice(0,30);
  if(baseQuery){for(let page=0;page<3;page++){const result=await fetchPage(baseQuery,page*10);if(!result?.hasMore)break;}}
  const queries=[...new Set([...ownTopics,...ownCategories])].filter(x=>x!==baseQuery).slice(0,2);
  for(const query of queries)await fetchPage(query.slice(0,30));
  await fetchPage();
  if(!successes)throw new AppError('RECOMMENDATIONS_UNAVAILABLE','推荐来源暂时不可用，请稍后重试');
  const seasons:{work:Work;reason:string;season:number}[]=[],similar:{work:Work;reason:string;score:number}[]=[];
  for(const work of candidates.values()){
   const parsed=titleParts(work.title);
   if(own.base&&parsed.base===own.base&&parsed.season!==undefined){
    if(parsed.season!==own.season)seasons.push({work,reason:`同名第${parsed.season}季`,season:parsed.season});
    continue;
   }
   const sharedCategories=categories(work).filter(x=>ownCategories.includes(x));
   const sharedTopics=topics(work).filter(x=>ownTopics.includes(x));
   if(!sharedCategories.length&&!sharedTopics.length)continue;
   const sharedWords=normalize(work.title+' '+work.description).includes(own.base)&&own.base.length>=2?1:0;
   similar.push({work,reason:sharedCategories.length?`共同分类：${sharedCategories.join('、')}`:`含“${sharedTopics.join('、')}”题材关键词`,score:sharedCategories.length*4+sharedTopics.length*2+sharedWords});
  }
  const pivot=own.season??1;
  seasons.sort((a,b)=>Number(a.season<=pivot)-Number(b.season<=pivot)||a.season-b.season||a.work.id.localeCompare(b.work.id));
  similar.sort((a,b)=>b.score-a.score||a.work.id.localeCompare(b.work.id));
  const result:RecommendationResult={seasons:seasons.slice(0,8).map(({work,reason})=>({work,reason})),similar:similar.slice(0,12).map(({work,reason})=>({work,reason})),message:failures?'部分推荐来源暂不可用，已展示可核对的结果。':seasons.length||similar.length?'同名季数依据标题匹配；相似作品依据分类或题材关键词筛选。':'暂未找到可核对的同名季数或相似题材作品。'};
  // Partial failures remain retryable; only complete successful lookups get a TTL.
  if(!failures){for(const [key,value] of this.cache)if(value.expires<=Date.now())this.cache.delete(key);while(this.cache.size>=CACHE_LIMIT)this.cache.delete(this.cache.keys().next().value!);this.cache.set(id,{expires:Date.now()+TTL,result});}
  return result;
 }
}
