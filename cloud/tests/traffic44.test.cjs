'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('OSS文件读写走内网，浏览器原图和缩略图签名仍走公网，可显式回退',async()=>{
 for(const fallback of [false,true]){
  const calls=[];class FakeOSS{constructor(options){this.options=options;}async get(key){calls.push(['get',this.options.internal]);return {content:Buffer.from('ok')};}signatureUrl(key,options){calls.push(['sign',this.options.internal,options]);return 'https://public/'+key;}}
  class Client{}
  const actual=require('node:module').createRequire(path.join(__dirname,'../aliyun.cjs')),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../aliyun.cjs'),'utf8'),{module,require:n=>n==='ali-oss'?FakeOSS:n==='tablestore'?{Client}:actual(n),process:{env:{C9_TABLESTORE_ENDPOINT:'https://example.com',C9_TABLESTORE_INSTANCE:'test',C9_OSS_REGION:'oss-cn-hangzhou',C9_OSS_BUCKET:'test',...(fallback?{C9_OSS_INTERNAL:'false'}:{})}},Buffer});
  const {objects}=module.exports.createAliyun({headers:{'x-fc-access-key-id':'test','x-fc-access-key-secret':'test','x-fc-security-token':'test'}});
  await objects.get('a');await objects.url('a');await objects.thumbnailURL('a','photo.jpg');await objects.thumbnailURL('a','photo.svg');
  assert.equal(calls[0][1],fallback?undefined:true);assert.equal(calls[1][1],undefined);assert.equal(calls[1][2].process,undefined);assert.match(calls[2][2].process,/w_320,h_320/);assert.equal(calls[3][2].process,undefined);
 }
});
