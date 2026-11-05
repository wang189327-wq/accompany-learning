'use strict';
const {AppError}=require('./core.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function createMemory(){
 const tasks=new Map(),records=new Map(),files=new Map(),uploads=new Map(),library=new Map();let seq=0;
 const put=(map,key,value,expected,rev)=>{const old=map.get(key);if(expected==null?!!old:!old||old[rev]!==expected)throw new AppError(409,'数据已变更');map.set(key,clone(value));};
 const store={getTask:async id=>clone(tasks.get(id)||null),putTask:async(t,e)=>put(tasks,t.id,t,e,'revision'),listTasks:async()=>clone([...tasks.values()]),getRecord:async(t,r)=>clone(records.get(t+'|'+r)||null),putRecord:async(r,e)=>put(records,r.taskId+'|'+r.round,r,e,'gradeRevision')};
 store.getLibrary=async id=>clone(library.get(id)||null);store.putLibrary=async(v,e)=>put(library,v.id,v,e,'revision');store.listLibrary=async()=>clone([...library.values()]);
 const objects={get:async key=>{if(!files.has(key))throw new AppError(404,'文件不存在');return Buffer.from(files.get(key));},put:async(k,v)=>{files.set(k,Buffer.from(v));},begin:async()=>{const id=String(++seq);uploads.set(id,new Map());return id;},part:async(k,id,n,b)=>{uploads.get(id).set(n,Buffer.from(b));return 'etag-'+n;},complete:async(k,id,parts)=>{files.set(k,Buffer.concat(parts.map(p=>uploads.get(id).get(p.number))));uploads.delete(id);},size:async k=>files.get(k).length,url:async k=>'/memory-image/'+encodeURIComponent(k)};
 return {store,objects,tasks,records,files,library};
}
module.exports={createMemory};
