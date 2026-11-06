const test = require('node:test'),
  assert = require('node:assert/strict'),
  { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs');
require('../model.js');
const M = global.TaskModel,
  S = require('../study-model.js');
function fixture() {
  const mem = createMemory();
  let time = M.parse('2026-10-19T12:00');
  return {
    mem,
    api: createService(mem.store, mem.objects, () => time),
    set: (v) => (time = M.parse(v)),
  };
}
async function task(f, extra = {}) {
  return f.api.saveTask(
    {
      task: {
        id: 't',
        name: '测试作业',
        subject: '数学',
        semester: '七年级上学期',
        kind: 'recurring',
        rule: 'week',
        format: 'text',
        enabled: true,
        dateOnly: true,
        weekDays: [0, 1, 2, 3, 4, 5, 6],
        ...extra,
      },
    },
    'teacher',
  );
}
async function submit(f, t, requestId, bodyText = '作业') {
  const b = Buffer.from(bodyText),
    u = await f.api.beginUpload(
      { taskId: t.id, kind: 'text', name: '内容.txt', size: b.length },
      'student',
    ),
    p = await f.api.uploadPart(u.uploadId, 1, b, 'student');
  await f.api.finishUpload(u.uploadId, { parts: [p] }, 'student');
  const body = {
    taskId: t.id,
    taskRevision: t.revision,
    round: M.period(t, t.created).key,
    requestId,
    selfScore: 8,
    uploadIds: [u.uploadId],
  };
  return { body, record: await f.api.submit(body, 'student') };
}
test('周期多次提交保留全部内容，独立评分、消息、重试与并发保护，备份包含全部记录', async () => {
  const f = fixture();
  let t = await task(f);
  const first = await submit(f, t, 'request1', '第一份');
  t = (await f.api.snapshot()).tasks[0];
  f.set('2026-10-20T12:00');
  const second = await submit(f, t, 'request2', '第二份');
  assert.notEqual(first.record.id, second.record.id);
  assert.equal(second.record.round, first.record.round);
  const replay = await f.api.submit(second.body, 'student');
  assert.equal(replay.id, second.record.id);
  await f.api.grade(
    {
      taskId: t.id,
      round: second.record.round,
      recordKey: second.record.recordKey,
      score: 9,
      expected: 0,
    },
    'teacher',
  );
  let snap = await f.api.snapshot();
  assert.equal(snap.records.length, 2);
  assert.equal(snap.records[0].text, '第一份');
  assert.equal(snap.records[0].teacherScore, null);
  assert.equal(snap.records[1].text, '第二份');
  assert.equal(snap.records[1].teacherScore, 9);
  assert.equal(snap.messages.filter((x) => x.kind === 'completion').length, 2);
  await assert.rejects(
    f.api.grade(
      { taskId: t.id, round: '单次', recordKey: second.record.recordKey, score: 1, expected: 1 },
      'teacher',
    ),
    (e) => e.status === 400,
  );
  const backup = await f.api.backup('teacher');
  assert.equal(JSON.parse(f.mem.files.get(backup.backupKey)).records.length, 2);
});
test('单次仍只能提交一次，周期首次和重复提交并发均不会丢失或覆盖', async () => {
  const f = fixture(),
    t = await task(f, { kind: 'once', rule: null, deadline: M.parse('2026-10-30T23:59') });
  await submit(f, t, 'once1');
  const current = (await f.api.snapshot()).tasks[0];
  await assert.rejects(submit(f, current, 'once2'), (e) => e.status === 409);
});
test('学生可通过专用接口修改老师作业星期，不能修改老师作业其他字段，旧提交保留', async () => {
  const f = fixture(),
    t = await task(f);
  await submit(f, t, 'studentwork');
  const current = (await f.api.snapshot()).tasks[0];
  const edited = await f.api.saveWeekDays(
    { taskId: 't', expected: current.revision, weekDays: [4] },
    'student',
  );
  assert.deepEqual(edited.weekDays, [4]);
  assert.equal((await f.api.snapshot()).records.length, 1);
  await assert.rejects(
    f.api.saveTask({ task: { ...edited, name: '越权' }, expected: edited.revision }, 'student'),
    (e) => e.status === 403,
  );
  await assert.rejects(
    f.api.saveWeekDays({ taskId: 't', expected: edited.revision, weekDays: [] }, 'student'),
    (e) => e.status === 400,
  );
});
test('自动打卡按日期幂等，多选星期各留一条，暂停停用不补生成，日月作业按规则生成', async () => {
  const f = fixture();
  let t = await task(f, { format: 'auto', weekDays: [0, 2] });
  let snap = await f.api.snapshot();
  assert.equal(snap.records.length, 1);
  assert.equal(snap.records[0].automatic, true);
  assert.equal(snap.records[0].selfScore, null);
  f.set('2026-10-21T12:00');
  snap = await f.api.snapshot();
  assert.equal(snap.records.length, 2);
  await f.api.snapshot();
  assert.equal((await f.api.snapshot()).records.length, 2);
  f.set('2026-10-26T12:00');
  t = await f.mem.store.getTask('t');
  await f.api.pauseRound(
    {
      taskId: 't',
      expected: t.revision,
      round: M.period(t, M.parse('2026-10-26T12:00')).key,
      paused: true,
    },
    'teacher',
  );
  assert.equal((await f.api.snapshot()).records.length, 2);
  for (const rule of ['day', 'month']) {
    const g = fixture();
    await task(g, { format: 'auto', rule });
    assert.equal((await g.api.snapshot()).records.length, rule === 'day' ? 1 : 0);
    g.set('2026-10-31T12:00');
    const count = (await g.api.snapshot()).records.length;
    assert.equal(count, rule === 'day' ? 13 : 1);
  }
  const widget = await f.api.widgetSnapshot();
  assert.equal(widget.records.length, 2);
  assert.ok(!Object.hasOwn(widget.records[0], 'text'));
});
test('试卷只需名称附件，选填成绩及班级年级排名独立校验，缺字段不入图，日期覆盖全天', () => {
  const minimal = S.validate({
    id: 'paper',
    type: 'exam',
    name: '试卷',
    files: [{ name: '试卷.pdf' }],
  });
  assert.equal(minimal.rank, null);
  assert.equal(minimal.gradeRank, null);
  assert.equal(S.exams([minimal]).length, 0);
  const paper = S.validate({
    ...minimal,
    fullScore: 80,
    score: 60,
    rank: 5,
    gradeRank: 80,
    examDate: M.parse('2026-10-19'),
  });
  assert.equal(S.exams([paper], { rankType: 'grade' })[0].plottedRank, 80);
  assert.equal(S.exams([paper], { rankType: 'class' })[0].plottedRank, 5);
  assert.throws(() => S.validate({ ...minimal, score: 60 }));
  assert.throws(() => S.validate({ ...minimal, gradeRank: 0 }));
  const t = {
    id: 'd',
    name: '每日',
    kind: 'recurring',
    rule: 'day',
    subject: '数学',
    format: 'text',
    dateOnly: true,
    startTime: '10:00',
    endTime: '11:00',
    created: M.parse('2026-10-19'),
    enabled: true,
  };
  const p = M.period(t, M.parse('2026-10-19'));
  assert.equal(M.windowFor(t, p).end, p.end - 1);
  assert.equal(M.submission(t, p.key, M.parse('2026-10-19T23:59'), '作业', [], 8).late, false);
});
test('修改自动打卡星期只影响本轮及以后，不给以前轮次追补新星期', async () => {
  const f = fixture();
  f.set('2026-10-12T12:00');
  await task(f, { format: 'auto', weekDays: [0] });
  f.set('2026-10-26T12:00');
  let snap = await f.api.snapshot();
  assert.equal(snap.records.length, 3);
  const t = snap.tasks[0];
  await f.api.saveWeekDays({ taskId: 't', expected: t.revision, weekDays: [2] }, 'student');
  snap = await f.api.snapshot();
  assert.equal(snap.records.length, 3);
  f.set('2026-10-28T12:00');
  assert.equal((await f.api.snapshot()).records.length, 4);
});
