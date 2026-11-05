'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const TableStore=require('tablestore');
test('阿里云适配器：临时Token字段、读取解析、分页与CAS条件使用官方SDK结构',async()=>{
 const calls=[];let config;
 class FakeClient{constructor(c){config=c;}getRow(p,callback){calls.push(p);callback(null,{row:{attributes:[{columnName:'payload',columnValue:JSON.stringify({id:'t',revision:1})}]}});}putRow(p,callback){calls.push(p);callback(null,{});}getRange(p,callback){calls.push(p);const first=p.inclusiveStartPrimaryKey[0].task_id===TableStore.INF_MIN;callback(null,{rows:[{attributes:[{columnName:'payload',columnValue:JSON.stringify({id:first?'t1':'t2'})}]}],nextStartPrimaryKey:first?[{name:'task_id',value:'t2'}]:null});}}
 class FakeOSS{constructor(c){assert.equal(c.stsToken,'test-session');}}
 const actualRequire=require('node:module').createRequire(path.join(__dirname,'../aliyun.cjs'));const module={exports:{}};const context={require:n=>n==='tablestore'?{...TableStore,Client:FakeClient}:n==='ali-oss'?FakeOSS:actualRequire(n),module,process:{env:{C9_TABLESTORE_ENDPOINT:'https://test.cn-hangzhou.ots.aliyuncs.com',C9_TABLESTORE_INSTANCE:'test',C9_OSS_REGION:'oss-cn-hangzhou',C9_OSS_BUCKET:'test-bucket'}},Buffer};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../aliyun.cjs'),'utf8'),context);
 const {store}=module.exports.createAliyun({headers:{'x-fc-access-key-id':'test-ak','x-fc-access-key-secret':'test-secret','x-fc-security-token':'test-session'}});
 assert.equal(config.stsToken,'test-session');assert.equal(config.securityToken,undefined);
 assert.equal((await store.getTask('t')).revision,1);assert.equal((await store.listTasks()).length,2);
 await store.putTask({id:'t',revision:2},1);const condition=calls.at(-1).condition.columnCondition;assert.equal(condition.passIfMissing,false);assert.equal(condition.columnName,'revision');
 await store.putRecord({taskId:'t',round:'单次',gradeRevision:0},null);assert.equal(calls.at(-1).condition.rowExistenceExpectation,TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST);
});
