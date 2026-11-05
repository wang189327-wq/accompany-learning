'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const {createMemory}=require('../memory.cjs'),{createService}=require('../core.cjs'),M=global.TaskModel;
const root=path.join(__dirname,'../..'),base=M.parse('2026-11-05T23:00'),wait=ms=>new Promise(r=>setTimeout(r,ms));
function baselineModule(name,override={}){const module={exports:{}},req=createRequire(path.join(root,'cloud',name+'.cjs'));vm.runInNewContext(fs.readFileSync(path.join(root,'tests/fixtures',name+'-before-sync31.cjs'),'utf8'),{module,exports:module.exports,require:n=>override[n]||req(n),Buffer,Date,Map,Set,Promise,console,TaskModel:M});return module.exports;}
const previous=baselineModule('core',{'./extras.cjs':baselineModule('extras')}).createService;
function copy(from){const to=createMemory();for(const key of ['tasks','records','library'])for(const [id,v]of from[key])to[key].set(id,structuredClone(v));for(const [id,b]of from.files)to.files.set(id,Buffer.from(b));return to;}
async function fixture(){const mem=createMemory(),api=createService(mem.store,mem.objects,()=>base);for(let i=0;i<18;i++){
 await api.saveTask({task:{id:'task'+i,name:'作业'+i,subject:'数学',semester:'七年级上学期',kind:'recurring',rule:'day',format:'text',enabled:true,reminder:{amount:2,unit:'hours'}}},'teacher');
 const t=mem.tasks.get('task'+i);t.created=base-4*M.DAY;
 for(let j=0;j<3;j++){const slot=M.dayLabel?M.dayLabel(base-(j+1)*M.DAY):M.input(base-(j+1)*M.DAY).slice(0,10),key='payload/'+i+'/'+j,textKey=key+'.txt',summary={taskId:t.id,taskName:t.name,subject:t.subject,semester:t.semester,kind:t.kind,format:'text',round:slot,images:[],textKey,selfScore:8};
  mem.files.set(key,Buffer.from(JSON.stringify(summary)));mem.files.set(textKey,Buffer.from('内容'+i+'-'+j));t._rounds[slot]={key,completed:base-(j+1)*M.DAY,late:false,notify:true};
  if(i%3)mem.records.set(t.id+'|'+slot,{taskId:t.id,round:slot,gradeRevision:0,teacherScore:i%11,summary:{...summary,cachedText:'内容'+i+'-'+j},gradedAt:base-i*1000});
 }
 }return mem;}
const plain=x=>JSON.parse(JSON.stringify(x));
test('普通全量/增量同步各仅一次任务及资料读取，原版与新版快照逐项等价，记录最多6路并发且顺序不变',async()=>{
 for(const since of [undefined,base-2500,base-M.DAY]){
  const seed=await fixture(),old=copy(seed),next=copy(seed);let oldLists=0;const oldList=old.store.listTasks;old.store.listTasks=async()=>{oldLists++;return oldList();};const expected=await previous(old.store,old.objects,()=>base).snapshot(since);
  let lists=0,library=0,active=0,max=0;const reads=new Map(),list=next.store.listTasks,lib=next.store.listLibrary,get=next.store.getRecord;
  next.store.listTasks=async()=>{lists++;return list();};next.store.listLibrary=async()=>{library++;return lib();};next.store.getRecord=async(t,r)=>{if(!t.startsWith('task'))return get(t,r);const key=t+'|'+r;reads.set(key,(reads.get(key)||0)+1);active++;max=Math.max(max,active);try{await wait(Number(t.slice(4))%3+1);return await get(t,r);}finally{active--;}};
  const actual=await createService(next.store,next.objects,()=>base).snapshot(since);assert.deepEqual(plain(actual),plain(expected));assert.equal(lists,1);assert.equal(library,1);assert.ok(max>1&&max<=6);assert.equal(active,0);assert.ok([...reads.values()].every(n=>n===1));
  console.log(JSON.stringify({syncReadProof:{mode:since===undefined?'full':'partial',previousTaskLists:oldLists,taskLists:lists,libraryLists:library,records:reads.size,peakRecordReads:max}}));
 }
});
test('自动打卡/提醒/旧任务迁移同次可见，冲突后采用最新任务，不覆盖另设备修改',async()=>{
 for(const mode of ['auto','reminder','legacy']){
  const mem=createMemory(),api=createService(mem.store,mem.objects,()=>base);
  await api.saveTask({task:{id:'conflict',name:'原任务',kind:'recurring',rule:'day',format:mode==='auto'?'auto':'text',enabled:true,semester:'七年级上学期',reminder:mode==='reminder'?{amount:2,unit:'hours'}:null}},'teacher');
  if(mode==='legacy'){delete mem.tasks.get('conflict').semester;delete mem.tasks.get('conflict').createdBy;}
  let conflicted=false,lists=0;const put=mem.store.putTask,list=mem.store.listTasks;mem.store.listTasks=async()=>{lists++;return list();};mem.store.putTask=async(t,rev)=>{if(!conflicted){conflicted=true;const current=mem.tasks.get(t.id);mem.tasks.set(t.id,{...current,name:'另一台设备修改',revision:current.revision+1});const e=Error('conflict');e.status=409;throw e;}return put(t,rev);};
  const snap=await api.snapshot();assert.ok(conflicted);assert.equal(lists,1);assert.equal(snap.tasks[0].name,'另一台设备修改');assert.equal(mem.tasks.get('conflict').name,'另一台设备修改');
  if(mode==='auto')assert.equal(snap.records.length,1);if(mode==='reminder')assert.equal(snap.messages.filter(x=>x.kind==='reminder').length,1);if(mode==='legacy'){assert.ok([...mem.files.keys()].some(k=>k.startsWith('backups/upgrade')));assert.equal((await api.snapshot()).tasks[0].semester,'七年级上学期');}
 }
});
test('读取失败不返回部分快照，等待已经启动的记录操作完成，后续同步可恢复',async()=>{
 const mem=await fixture(),get=mem.store.getRecord;let active=0,failed=false;mem.store.getRecord=async(t,r)=>{if(!t.startsWith('task'))return get(t,r);active++;try{await wait(3);if(!failed){failed=true;throw Error('temporary read failure');}await wait(10);return await get(t,r);}finally{active--;}};
 const api=createService(mem.store,mem.objects,()=>base);await assert.rejects(api.snapshot(),/temporary read failure/);assert.equal(active,0);assert.equal((await api.snapshot()).records.length,54);
});
test('任务副本只在本次请求内复用，下次同步重新读取，新修改和新增立即可见',async()=>{
 const mem=createMemory(),api=createService(mem.store,mem.objects,()=>base);let reads=0;const list=mem.store.listTasks;mem.store.listTasks=async()=>{reads++;return list();};
 const task=await api.saveTask({task:{id:'fresh',name:'修改前'}},'teacher');assert.equal((await api.snapshot()).tasks[0].name,'修改前');
 await api.saveTask({task:{...task,name:'修改后'},expected:task.revision},'teacher');await api.saveTask({task:{id:'new',name:'新任务'}},'student');
 const second=await api.snapshot();assert.equal(reads,2);assert.equal(second.tasks.length,2);assert.equal(second.tasks.find(t=>t.id==='fresh').name,'修改后');
});
test('桌面组件快照也只读取一次任务，输出内容和排列与原版一致',async()=>{
 const seed=await fixture(),a=copy(seed),b=copy(seed);let lists=0;const list=b.store.listTasks;b.store.listTasks=async()=>{lists++;return list();};
 const expected=await previous(a.store,a.objects,()=>base).widgetSnapshot(),actual=await createService(b.store,b.objects,()=>base).widgetSnapshot();assert.deepEqual(plain(actual),plain(expected));assert.equal(lists,1);
});
function study(file){const nodes=new Map(),context=vm.createContext({document:{body:{insertAdjacentHTML(){}},addEventListener(){},getElementById:id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){}});return nodes.get(id);}},console});for(const source of ['model.js','study-model.js',file])vm.runInContext(fs.readFileSync(path.join(root,source),'utf8'),context);return vm.runInContext('StudyUI',context);}
test('目录计数/名称索引与原版HTML完全一致：多学期、名称/身份/学科、空目录、目录删除与跨页',()=>{
 const old=study('tests/fixtures/study-ui-before-sync31.js'),next=study('study-ui.js'),entries=[];
 for(const scope of ['materials','exams']){for(let i=0;i<12;i++)entries.push({id:scope+i,type:'folder',scope,name:'目录'+i,color:'#e8f0e9',semesters:[i%2?'七年级上学期':'八年级下学期']});for(let i=0;i<150;i++)entries.push({id:scope+'file'+i,type:scope==='exams'?'exam':'material',name:'资料'+i,subject:i%2?'数学':'英语',uploader:i%3?'student':'teacher',semester:'七年级上学期',semesters:[i%2?'七年级上学期':'八年级下学期'],folderId:i%5?scope+(i%10):null,files:[{}]});}
 for(const data of [entries,entries.filter(x=>x.id!=='materials1')])for(const scope of ['materials','exams'])for(const search of ['', '资料1','无匹配'])for(const subject of ['','数学'])for(const semesters of [[],['七年级上学期'],['七年级上学期','八年级下学期']])for(const folder of ['',scope+'1',scope+'11']){
  for(const ui of [old,next]){ui.set(data);Object.assign(ui.state[scope],{search,subject,semesters,folder,uploader:scope==='materials'&&search?'teacher':''});}
  assert.equal(next.page(scope),old.page(scope));
 }
});
test('日程仅一次角色排序，日历仅一次默认排序，结果与双重排序相同',()=>{
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8');assert.ok(!source.includes(')).sort(TaskOrdering.compare());'));assert.ok(source.includes("const sorted=taskView==='agenda'?TaskOrdering.ordered(active):active.sort(TaskOrdering.compare());"));
 const c=vm.createContext({document:{addEventListener(){}},localStorage:{getItem(){return null;}},Map,Date,setTimeout,clearTimeout,role:'student'});vm.runInContext(fs.readFileSync(path.join(root,'task-order.js'),'utf8'),c);const ordering=vm.runInContext('TaskOrdering',c),tasks=Array.from({length:200},(_,i)=>({id:'t'+i,created:i%11}));
 for(const who of ['teacher','student'])for(const ids of [[],['t99','t1','t0']]){c.role=who;ordering.set({[who]:{ids,revision:1}});const before=[...tasks].sort(ordering.compare());assert.deepEqual(plain(ordering.ordered(tasks)),plain(ordering.ordered(before)));assert.deepEqual(plain([...tasks].sort(ordering.compare())),plain(before));}
});


