'use strict';
const X=require('./my-model.js'),{randomUUID}=require('node:crypto');
function createExtras(store,objects,clock,M,fail){
 const validRole=who=>{if(!['teacher','student'].includes(who))fail(403,'请选择老师或学生身份');};
 const ids=['shared','profile:teacher','profile:student'];
 async function preference(id){const meta=await store.getRecord('__c9_my__',id);if(!meta)return null;return {...JSON.parse((await objects.get(meta.payloadKey)).toString('utf8')),id,revision:meta.gradeRevision};}
 async function preferences(){return (await Promise.all(ids.map(preference))).filter(Boolean);}
 function teacherFields(input,old,who){
  if(who!=='teacher'&&(input.roundNote||JSON.stringify(input.roundNotes||{})!==JSON.stringify(old?.roundNotes||{})))fail(403,'只有老师可以修改本周期备注');
  if(who!=='teacher'&&((input.note??old?.note??'')!==(old?.note||'')||JSON.stringify(input.reminder===undefined?old?.reminder||null:input.reminder)!==JSON.stringify(old?.reminder||null)))fail(403,'只有老师可以修改备注和提醒');
  const note=input.note??old?.note??'';if(typeof note!=='string')fail(400,'备注格式无效');let reminder;try{reminder=X.reminder(input.reminder===undefined?old?.reminder||null:input.reminder);}catch(e){fail(400,e.message);}return {note,reminder,roundNotes:{...(old?.roundNotes||{})}};
 }
 function taskEvent(task,old,who){if(who!=='teacher'||task.deletedAt)return;task._events=[...(old?._events||[]),{id:'task:'+task.id+':'+task.revision,targetRole:'student',kind:old?'taskUpdated':'taskPublished',taskId:task.id,title:old?'老师修改了任务':'老师发布了任务',body:task.name+' · '+task.semester,created:clock()}];}
 async function remind(tasks=undefined){
  tasks=tasks||await store.listTasks();
  for(const [index,initial] of tasks.entries()){
   let current=initial;for(let attempt=0;attempt<4;attempt++){
    const records=Object.keys(current._rounds||{}).map(round=>({taskId:current.id,round:round.split('~')[0]}));const msg=X.due(current,records,clock(),M);if(!msg||(current._events||[]).some(e=>e.id===msg.id))break;
    const next={...current,revision:current.revision+1,_events:[...(current._events||[]),msg]};
    try{await store.putTask(next,current.revision);current=next;break;}catch(err){if(err.status!==409)throw err;current=await store.getTask(current.id);if(!current)break;if(attempt===3)fail(409,'任务正在更新，请刷新重试');}
   }
   tasks[index]=current;
  }
  return tasks.filter(Boolean);
 }
 async function snapshot(ts,rs){const bySubmission=new Map(rs.map(r=>[r.taskId+'|'+(r.recordKey||r.round),r]));const read={};for(const who of ['teacher','student'])read[who]=new Set((await store.getRecord('__c9_read__',who))?.ids||[]);const messages=ts.flatMap(t=>(t._events||[]));for(const task of ts)for(const [round,ref]of Object.entries(task._rounds||{}))if(ref.notify){const r=bySubmission.get(task.id+'|'+round),roundLabel=r?.round||round.split('~')[0];messages.push({id:'completion:'+task.id+'|'+round,targetRole:'teacher',kind:'completion',taskId:task.id,round:roundLabel,title:'学生完成了作业',body:(r?.taskName||ref.taskName||task.name)+' · '+roundLabel+'\n作业自评分：'+(r?.selfScore??ref.selfScore??'—')+' / 10 分',created:ref.completed});}return {preferences:await preferences(),messages:messages.map(m=>({...m,read:read[m.targetRole].has(m.id)}))};}
 async function savePreference(body,who){validRole(who);const input=body.value;if(!input||!ids.includes(input.id)||input.id.startsWith('profile:')&&input.id!=='profile:'+who)fail(403,'只能修改自己的头像和昵称');let value={id:input.id};
  if(input.id==='shared'){if(typeof input.school!=='string'&&input.school!==undefined)fail(400,'院校名称无效');value.school=input.school||'';try{const prior=await preference('shared'),goals={...(input.goals||{})};for(const sub of X.GOAL_EXTRAS)if(!Object.hasOwn(goals,sub)&&prior?.goals?.[sub])goals[sub]=prior.goals[sub];value.goals=X.goals(goals,M.SUBJECTS);value.table=X.validateTable(input.table||X.table());}catch(e){fail(e.status||400,e.message);}}
  else{if(typeof input.nickname!=='string'||!input.nickname.trim())fail(400,'请输入昵称');value.nickname=input.nickname.trim();if(input.avatar!==undefined&&input.avatar!==''&&(typeof input.avatar!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.avatar)||Buffer.byteLength(input.avatar)>700000))fail(400,'头像格式无效或过大，请重新选择');value.avatar=input.avatar||'';}
  const old=await store.getRecord('__c9_my__',input.id);if((old?.gradeRevision||0)!==body.expected)fail(409,'信息已在另一设备更新，请关闭并重新打开编辑');
  const revision=(old?.gradeRevision||0)+1,payloadKey='my/'+randomUUID()+'.json';await objects.put(payloadKey,Buffer.from(JSON.stringify(value)),'application/json');await store.putRecord({taskId:'__c9_my__',round:input.id,gradeRevision:revision,payloadKey},old?.gradeRevision??null);return {...value,revision};
 }
 async function markRead(body,who){validRole(who);if(!Array.isArray(body.ids)||body.ids.some(id=>typeof id!=='string'))fail(400,'消息编号无效');
  const ts=await store.listTasks(),allowed=new Set(ts.flatMap(t=>[...(t._events||[]).filter(m=>m.targetRole===who).map(m=>m.id),...(who==='teacher'?Object.entries(t._rounds||{}).filter(([k,r])=>r.notify).map(([round])=>'completion:'+t.id+'|'+round):[])]));if(body.ids.some(id=>!allowed.has(id)))fail(403,'只能标记自己的消息');
  for(let attempt=0;attempt<5;attempt++){const old=await store.getRecord('__c9_read__',who),ids=[...new Set([...(old?.ids||[]),...body.ids])];try{await store.putRecord({taskId:'__c9_read__',round:who,ids,gradeRevision:(old?.gradeRevision||0)+1},old?.gradeRevision??null);return {ok:true};}catch(e){if(e.status!==409||attempt===4)throw e;}}
 }
 async function backup(){const meta=[];for(const id of ids){const r=await store.getRecord('__c9_my__',id);if(r)meta.push(r);}for(const who of ['teacher','student']){const r=await store.getRecord('__c9_read__',who);if(r)meta.push(r);}return {preferences:await preferences(),metadata:meta};}
 return {teacherFields,taskEvent,remind,snapshot,savePreference,markRead,backup};
}
module.exports={createExtras};
