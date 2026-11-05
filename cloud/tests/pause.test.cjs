const test=require('node:test'),assert=require('node:assert/strict');
const {createMemory}=require('../memory.cjs'),{createService}=require('../core.cjs');const M=globalThis.TaskModel,at=v=>M.parse(v);
test('老师暂停本日、本周、本月，只影响该轮，下一轮自动恢复；学生不能设置',async()=>{
 for(const [rule,nextTime] of [['day','2026-10-08T00:00'],['week','2026-10-12T00:00'],['month','2026-11-01T00:00']]){
  const m=createMemory();let time=at('2026-10-07T10:00');const api=createService(m.store,m.objects,()=>time);
  let t=await api.saveTask({task:{id:rule,name:'周期练习',semester:'七年级上学期',subject:'数学',kind:'recurring',rule,format:'text',enabled:true}},'student');const round=M.period(t,time).key;
  await assert.rejects(api.pauseRound({taskId:t.id,round,paused:true,expected:t.revision},'student'),e=>e.status===403);
  await assert.rejects(api.pauseRound({taskId:t.id,round:'2020-W01',paused:true,expected:t.revision},'teacher'),e=>e.status===409);
  t=await api.pauseRound({taskId:t.id,round,paused:true,expected:t.revision},'teacher');assert.equal(t.enabled,true);assert.ok(M.paused(t,round));assert.equal(M.status(t,M.period(t,time),null,time).color,'gray');assert.throws(()=>M.submission(t,round,time,'练习',[],8),/暂停/);
  await assert.rejects(api.pauseRound({taskId:t.id,round,paused:false,expected:t.revision-1},'teacher'),e=>e.status===409);
  const edit=await api.saveTask({task:{...t,name:'修改名称',pausedRounds:[]},expected:t.revision},'student');assert.ok(M.paused(edit,round));
  time=at(nextTime);assert.equal(M.paused(edit,M.period(edit,time)),false);assert.equal(M.status(edit,M.period(edit,time),null,time).color,'blue');assert.throws(()=>M.submission(edit,round,time,'补交',[],8),/暂停/);
  assert.ok(M.history(edit,time).some(p=>p.key===round));assert.ok((await api.snapshot()).features.roundPause);
 }
});
test('恢复本轮重新待办；已完成、停用、单次任务不可暂停',async()=>{
 const m=createMemory(),api=createService(m.store,m.objects,()=>at('2026-10-07T10:00'));
 const base={id:'t',name:'任务',semester:'七年级上学期',subject:'数学',kind:'recurring',rule:'day',format:'text',enabled:true};let t=await api.saveTask({task:base},'teacher');
 t=await api.pauseRound({taskId:t.id,round:'2026-10-07',paused:true,expected:t.revision},'teacher');t=await api.pauseRound({taskId:t.id,round:'2026-10-07',paused:false,expected:t.revision},'teacher');assert.equal(M.paused(t,'2026-10-07'),false);
 assert.equal(M.calendarPending([t],[],at('2026-10-07T00:00')).length,1);
 m.tasks.set(t.id,{...m.tasks.get(t.id),_rounds:{'2026-10-07':{key:'unused'}}});await assert.rejects(api.pauseRound({taskId:t.id,round:'2026-10-07',paused:true,expected:t.revision},'teacher'),/已完成/);
 await api.saveTask({task:{...base,id:'once',kind:'once',deadline:at('2026-10-08T00:00')}},'teacher');await assert.rejects(api.pauseRound({taskId:'once',round:'单次',paused:true,expected:1},'teacher'),/周期任务/);
});
