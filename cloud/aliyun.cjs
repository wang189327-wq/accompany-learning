'use strict';
const TableStore=require('tablestore'),OSS=require('ali-oss');
const {AppError}=require('./core.cjs');
function env(name){const v=process.env[name];if(!v)throw new AppError(503,'云端配置缺少 '+name);return v;}
function createAliyun(request){
 // FC custom runtimes receive the execution role's temporary credentials per request.
 const accessKeyId=request.headers['x-fc-access-key-id']||process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
 const accessKeySecret=request.headers['x-fc-access-key-secret']||process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
 const securityToken=request.headers['x-fc-security-token']||process.env.ALIBABA_CLOUD_SECURITY_TOKEN;
 if(!accessKeyId||!accessKeySecret||!securityToken)throw new AppError(503,'请为函数配置访问 OSS 和 Tablestore 的函数角色');
 const client=new TableStore.Client({accessKeyId,secretAccessKey:accessKeySecret,stsToken:securityToken,endpoint:env('C9_TABLESTORE_ENDPOINT'),instancename:env('C9_TABLESTORE_INSTANCE'),maxRetries:2});
 const publicOptions={region:env('C9_OSS_REGION'),bucket:env('C9_OSS_BUCKET'),accessKeyId,accessKeySecret,stsToken:securityToken,secure:true,timeout:30000};
 const publicOSS=new OSS(publicOptions);
 const oss=process.env.C9_OSS_INTERNAL==='false'?publicOSS:new OSS({...publicOptions,internal:true});
 const taskTable=process.env.C9_TASK_TABLE||'c9_tasks',recordTable=process.env.C9_RECORD_TABLE||'c9_records';
 const call=(name,params)=>new Promise((resolve,reject)=>client[name](params,(e,d)=>{if(e?.code==='OTSConditionCheckFail')reject(new AppError(409,'数据已变更，请刷新后重试'));else if(e)reject(e);else resolve(d);}));
 const parse=row=>{const c=row?.attributes?.find(x=>x.columnName==='payload');return c?JSON.parse(c.columnValue):null;};
 async function get(tableName,primaryKey){return parse((await call('getRow',{tableName,primaryKey,maxVersions:1,columnsToGet:['payload']})).row);}
 async function put(tableName,primaryKey,value,expected,revision){
  const condition=new TableStore.Condition(expected==null?TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST:TableStore.RowExistenceExpectation.EXPECT_EXIST,expected==null?null:new TableStore.SingleColumnCondition('revision',TableStore.Long.fromNumber(expected),TableStore.ComparatorType.EQUAL,false,true));
  await call('putRow',{tableName,primaryKey,condition,attributeColumns:[{payload:JSON.stringify(value)},{revision:TableStore.Long.fromNumber(revision)}]});
 }
 const store={
  getTask:taskId=>get(taskTable,[{task_id:taskId}]),
  putTask:(task,expected)=>put(taskTable,[{task_id:task.id}],task,expected,task.revision),
  getRecord:(taskId,round)=>get(recordTable,[{task_id:taskId},{round_key:round}]),
  putRecord:(record,expected)=>put(recordTable,[{task_id:record.taskId},{round_key:record.round}],record,expected,record.gradeRevision),
  async listTasks(){const out=[];let start=[{task_id:TableStore.INF_MIN}];do{const data=await call('getRange',{tableName:taskTable,direction:TableStore.Direction.FORWARD,maxVersions:1,columnsToGet:['payload'],inclusiveStartPrimaryKey:start,exclusiveEndPrimaryKey:[{task_id:TableStore.INF_MAX}],limit:100});out.push(...data.rows.map(parse).filter(Boolean));start=data.nextStartPrimaryKey?.length?data.nextStartPrimaryKey.map(c=>({[c.name]:c.value})):null;}while(start);return out;},
 };
 const LIBRARY_ID='__c9_library__';
 store.getLibrary=id=>get(recordTable,[{task_id:LIBRARY_ID},{round_key:id}]);
 store.putLibrary=(value,expected)=>put(recordTable,[{task_id:LIBRARY_ID},{round_key:value.id}],value,expected,value.revision);
 store.listLibrary=async()=>{const out=[];let start=[{task_id:LIBRARY_ID},{round_key:TableStore.INF_MIN}];do{const data=await call('getRange',{tableName:recordTable,direction:TableStore.Direction.FORWARD,maxVersions:1,columnsToGet:['payload'],inclusiveStartPrimaryKey:start,exclusiveEndPrimaryKey:[{task_id:LIBRARY_ID},{round_key:TableStore.INF_MAX}],limit:100});out.push(...data.rows.map(parse).filter(Boolean));start=data.nextStartPrimaryKey?.length?data.nextStartPrimaryKey.map(c=>({[c.name]:c.value})):null;}while(start);return out;};
 const objects={
  async get(key){try{return (await oss.get(key)).content;}catch(e){if(e.status===404)throw new AppError(404,'文件不存在');throw e;}},
  async put(key,bytes,type){await oss.put(key,bytes,{headers:{'Content-Type':type}});},
  async begin(key,type){return (await oss.initMultipartUpload(key,{headers:{'Content-Type':type}})).uploadId;},
  async part(key,uploadId,number,bytes){return (await oss.uploadPart(key,uploadId,number,bytes,0,bytes.length)).etag;},
  async complete(key,uploadId,parts){await oss.completeMultipartUpload(key,uploadId,parts);},
  async size(key){return Number((await oss.head(key)).res.headers['content-length']);},
  async thumbnailURL(key,name){return publicOSS.signatureUrl(key,{expires:300,...(/\.(jpe?g|png|webp)$/i.test(name||'')?{process:'image/auto-orient,1/resize,m_lfit,w_320,h_320/quality,q_75'}:{})});},
  async url(key){return publicOSS.signatureUrl(key,{expires:300});},
 };
 return {store,objects};
}
module.exports={createAliyun};
