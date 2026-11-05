'use strict';
const {createHash}=require('node:crypto');
function createBatches(store,clock,fail){
 const partition='__c9_ai_batches__';
 const digest=text=>createHash('sha256').update(text).digest('hex');
 const get=id=>store.getRecord(partition,id);
 async function claim(job){const old=await get(job.id);if(old)return old;const value={taskId:partition,round:job.id,job,batches:[],gradeRevision:0};try{await store.putRecord(value,null);return value;}catch(e){if(e.status!==409)throw e;return get(job.id);}}
 async function authorized(body){if(typeof body.jobId!=='string'||!/^[-a-zA-Z0-9_]{8,100}$/.test(body.jobId))fail(400,'点评任务编号无效');const value=await get(body.jobId);if(!value||value.job.claim!==body.claim||value.job.workerId!==body.workerId||body.generationId!==body.jobId)fail(409,'点评任务身份不匹配');return value;}
 async function save(body){if(!Number.isInteger(body.batchIndex)||!Number.isInteger(body.batchCount)||body.batchCount<1||body.batchCount>100||body.batchIndex<0||body.batchIndex>=body.batchCount||typeof body.text!=='string'||!body.text.trim()||body.text.length>16000||body.sha256!==digest(body.text))fail(400,'点评批次校验失败');for(let n=0;n<6;n++){const old=await authorized(body);if(body.taskId!==old.job.taskId||body.recordKey!==old.job.slot)fail(409,'作业身份不匹配');const known=old.batches.find(x=>x.batchIndex===body.batchIndex);if(known){if(known.sha256!==body.sha256||known.batchCount!==body.batchCount)fail(409,'已保存的点评批次内容不同');return {ok:true,alreadySaved:true};}if(old.batches.some(x=>x.batchCount!==body.batchCount)||old.batches.reduce((n,x)=>n+x.text.length,0)+body.text.length>16000)fail(400,'点评总长度或批次数无效');const next={...old,batches:[...old.batches,{batchIndex:body.batchIndex,batchCount:body.batchCount,sha256:body.sha256,text:body.text}],gradeRevision:old.gradeRevision+1};try{await store.putRecord(next,old.gradeRevision);return {ok:true};}catch(e){if(e.status!==409||n===5)throw e;}}}
 async function complete(body){const value=await authorized(body),parts=[...value.batches].sort((a,b)=>a.batchIndex-b.batchIndex);if(!Number.isInteger(body.batchCount)||parts.length!==body.batchCount||parts.some((x,i)=>x.batchIndex!==i||x.batchCount!==body.batchCount||x.sha256!==digest(x.text)))fail(409,'点评批次尚未完整保存');return {job:value.job,text:parts.map(x=>x.text).join('\n\n')};}
 return {claim,save,complete};
}
module.exports={createBatches};
