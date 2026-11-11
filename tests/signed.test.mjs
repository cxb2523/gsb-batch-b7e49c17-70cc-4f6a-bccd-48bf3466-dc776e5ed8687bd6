import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildResourceRequest, summarizeVideoModel, summarizeEpisodes} from '../src/probe/signed.mjs';

test('单集新接口必须签名实际发出的 JSON，并使用 TV 中核实的参数',()=>{
 const r=buildResourceRequest('7695386582622145561',{now:1234});
 const body=JSON.parse(r.body);
 assert.equal(new URL(r.url).pathname,'/novel/player/video_model/v1/');
 assert.equal(new URL(r.url).searchParams.get('aid'),'8704');
 assert.equal(new URL(r.url).searchParams.get('_rticket'),'1234');
 assert.deepEqual(body,{video_id:'7695386582622145561',content_type:1,biz_param:{need_all_video_definition:true,video_platform:3}});
 assert.equal(r.headers['x-ss-stub'],createHash('md5').update(r.body).digest('hex').toUpperCase());
 assert.throws(()=>buildResourceRequest('1?aid=8662'));
});

test('兼容 model 字符串/对象和轨道列表/字典，报告不保留播放凭据',()=>{
 const track={main_url:'SECRET_URL',spade_a:'SECRET_KEY',kid:'SECRET_KID',encrypt:true,encryption_method:'cenc-aes-ctr',codec_type:'bytevc1',definition:'360p'};
 const expected={duration:45.034,modelFound:true,fullPlaybackVerified:false,tracks:[{definition:'360p',codec:'bytevc1',encryption:'encrypted',encryptionMethod:'cenc-aes-ctr',hasResource:true}]};
 for(const list of [[track],{video_1:track}])for(const stringify of [false,true]){
  const model={video_duration:45.034,video_list:list,key_seed:'SECRET_SEED'};
  const report=summarizeVideoModel({code:0,data:{video_model:stringify?JSON.stringify(model):model}});
  assert.deepEqual(report,expected);assert.doesNotMatch(JSON.stringify(report),/SECRET/);
 }
});

test('缺少加密标记的资源不能被当成未加密，业务失败和坏 JSON 不能通过',()=>{
 assert.equal(summarizeVideoModel({code:0,data:{video_model:{video_list:[{main_url:'URL'}]}}}).tracks[0].encryption,'unknown');
 for(const r of [{code:6000,data:{video_model:{video_duration:120}}},{code:0,data:{video_model:'{broken'}},{code:0,data:{}}])assert.equal(summarizeVideoModel(r).modelFound,false);
});

test('剧集编号保留字符串精度，按索引排序并拒绝不可信数字 ID',()=>{
 const result=summarizeEpisodes({code:0,data:{'7695370827507698713':{video_data:{video_list:[{vid:'7695386582622145561',vid_index:78,duration:45},{vid:'7695386527160863769',vid_index:1,duration:60}]}}}},'7695370827507698713');
 assert.deepEqual(result.map(e=>e.order),[1,78]);assert.equal(result[1].id,'7695386582622145561');
 assert.throws(()=>summarizeEpisodes({code:0,data:{'7695370827507698713':{video_data:{video_list:[{vid:7695386582622145561,vid_index:78}]}}}},'7695370827507698713'));
});
