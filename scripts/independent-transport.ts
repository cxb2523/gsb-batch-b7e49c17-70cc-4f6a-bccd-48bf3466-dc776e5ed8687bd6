import {createHash} from 'node:crypto';
import {Signer} from '../src/main/transport';
import {safeJson} from '../src/main/json';
import type {ApiTransport} from '../src/shared/types';

// Experimental only: no changes to the installed client's transport.
export const independentIdentity={aid:'8704',app_name:'kylin_read',version_code:'74032',version_name:'7.4.0.32',update_version_code:'74032'};
export class IndependentTransport implements ApiTransport {
 constructor(private signer:Signer){}
 async request(endpoint:string,body?:unknown,extra:Record<string,string|number|boolean>={}){
  if(!/^\/(?:novel\/player\/|reading\/bookapi\/)/.test(endpoint))throw Error('INVALID_ENDPOINT');
  const url=new URL(endpoint,'https://api5-normal-sinfonlinea.fqnovel.com');
  for(const [key,value] of Object.entries({...independentIdentity,channel:'audit',device_platform:'android',os_version:'12',_rticket:Date.now(),...extra}))url.searchParams.set(key,String(value));
  const payload=body===undefined?undefined:JSON.stringify(body);
  const headers={'user-agent':'com.kylin.read/74032 (Linux; Android 12)','content-type':'application/json; charset=utf-8',...(payload?{'x-ss-stub':createHash('md5').update(payload).digest('hex').toUpperCase()}: {})};
  const signatures=await this.signer.sign(url.href,headers);
  const response=await fetch(url,{method:payload?'POST':'GET',headers:{...headers,...signatures},body:payload,signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error(`HTTP_${response.status}`);
  const value=await response.text();if(!value.trim())throw Error('EMPTY_RESPONSE');
  return safeJson(value);
 }
}
