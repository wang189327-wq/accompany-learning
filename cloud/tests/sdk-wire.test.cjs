const test=require('node:test'),assert=require('node:assert/strict'),T=require('tablestore'),P=require('tablestore/lib/protocol/tablestore_compiled_proto.js').main.proto;
const vectors=require('../../tests/fixtures/sdk-wire-vectors.json'),params=require('../../tests/fixtures/sdk-wire-params.cjs')(T);
test('安全补丁后的真实Tablestore SDK与原SDK的查询/条件写入/分页二进制完全一致',()=>{
 for(const [operation,value]of Object.entries(params)){
  const message=T.encoder['encode'+operation](value),type=P[operation+'Request'],bytes=Buffer.from(type.encode(message).finish());assert.equal(bytes.toString('hex'),vectors[operation],operation);
  const decoded=type.decode(bytes);assert.equal(decoded.tableName,value.tableName);assert.equal(Buffer.from(type.encode(decoded).finish()).toString('hex'),vectors[operation]);
 }
});
