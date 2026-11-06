'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs'),
  X = require('../my-model.js');
const M = global.TaskModel,
  at = M.parse;
function setup() {
  const memory = createMemory();
  let time = at('2026-10-13T10:00');
  const api = createService(memory.store, memory.objects, () => time);
  return { memory, api, setTime: (v) => (time = v) };
}
async function task(s, extra = {}, who = 'teacher') {
  return s.api.saveTask(
    {
      task: {
        id: 'task-' + Math.random().toString(36).slice(2),
        name: '每日练习',
        subject: '数学',
        semester: '七年级上学期',
        kind: 'recurring',
        rule: 'day',
        format: 'text',
        enabled: true,
        ...extra,
      },
    },
    who,
  );
}
async function submit(s, t, requestId = 'request-1') {
  const bytes = Buffer.from('我的作业'),
    u = await s.api.beginUpload(
      { taskId: t.id, kind: 'text', size: bytes.length, name: '作业.txt' },
      'student',
    ),
    part = await s.api.uploadPart(u.uploadId, 1, bytes, 'student');
  await s.api.finishUpload(u.uploadId, { parts: [part] }, 'student');
  const body = {
    taskId: t.id,
    taskRevision: t.revision,
    round: M.period(t, t.created).key,
    requestId,
    selfScore: 9,
    uploadIds: [u.uploadId],
  };
  return { body, result: await s.api.submit(body, 'student') };
}
test('头像昵称分角色保存，共同目标和可编辑合并表格同步；旧版本保存拒绝', async () => {
  const s = setup(),
    value = {
      id: 'shared',
      school: '目标学校',
      goals: { 数学: { full: 120, score: 108, rank: 10 } },
      table: {
        ...X.table(),
        headers: ['年份', '学校', '校内分数', '校内排名', '市分数', '市排名'],
      },
    };
  await s.api.saveMyPreference({ value, expected: 0 }, 'teacher');
  await assert.rejects(
    s.api.saveMyPreference({ value, expected: 0 }, 'student'),
    (e) => e.status === 409,
  );
  const merged = X.merge(
    { ...value.table, rows: [['2025', '一中', '', '', '', '']] },
    { r: 0, c: 0, h: 1, w: 2 },
    'all',
  );
  await s.api.saveMyPreference({ value: { ...value, table: merged }, expected: 1 }, 'student');
  await s.api.saveMyPreference(
    { value: { id: 'profile:teacher', nickname: '老师甲' }, expected: 0 },
    'teacher',
  );
  await s.api.saveMyPreference(
    { value: { id: 'profile:student', nickname: '学生乙' }, expected: 0 },
    'student',
  );
  await assert.rejects(
    s.api.saveMyPreference(
      { value: { id: 'profile:teacher', nickname: '越权' }, expected: 1 },
      'student',
    ),
    (e) => e.status === 403,
  );
  const snap = await s.api.snapshot(),
    shared = snap.preferences.find((p) => p.id === 'shared');
  assert.equal(shared.revision, 2);
  assert.equal(shared.table.headers[2], '校内分数');
  assert.equal(shared.table.merges.length, 1);
  assert.equal(shared.goals.数学.rank, 10);
  assert.equal(snap.preferences.find((p) => p.id === 'profile:teacher').nickname, '老师甲');
  await assert.rejects(
    s.api.saveMyPreference(
      { value: { ...shared, goals: { 数学: { full: 100, score: 101, rank: 1 } } }, expected: 2 },
      'teacher',
    ),
    (e) => e.status === 400,
  );
  const backup = await s.api.backup('teacher'),
    saved = JSON.parse(s.memory.files.get(backup.backupKey));
  assert.equal(saved.my.preferences.length, 3);
  assert.equal(saved.my.metadata.length, 3);
});
test('任务备注和提醒仅老师可改，发布和修改消息随任务条件更新提交；失败无新消息', async () => {
  const s = setup();
  let t = await task(s, { note: '检查计算步骤', reminder: { amount: 2, unit: 'hours' } });
  let snap = await s.api.snapshot();
  assert.equal(snap.tasks[0].note, t.note);
  assert.equal(snap.messages.length, 1);
  await assert.rejects(
    s.api.saveTask({ task: { ...t, note: '篡改' }, expected: t.revision }, 'student'),
    (e) => e.status === 403,
  );
  const own = await task(s, {}, 'student');
  await assert.rejects(
    s.api.saveTask({ task: { ...own, note: '自己的也不能写' }, expected: own.revision }, 'student'),
    (e) => e.status === 403,
  );
  t = await s.api.saveTask(
    { task: { ...t, name: '新的数学作业' }, expected: t.revision },
    'teacher',
  );
  await assert.rejects(
    s.api.saveTask({ task: t, expected: 1 }, 'teacher'),
    (e) => e.status === 409,
  );
  snap = await s.api.snapshot();
  assert.equal(snap.messages.length, 2);
  assert.ok(!('_events' in snap.tasks[0]));
});
test('完成消息幂等，已读按角色分开；并发已读不会丢失，失败提交不发送消息', async () => {
  const s = setup(),
    t = await task(s),
    { body } = await submit(s, t);
  await s.api.submit(body, 'student');
  let snap = await s.api.snapshot();
  assert.equal(snap.messages.filter((m) => m.kind === 'completion').length, 1);
  const teacherMsg = snap.messages.find((m) => m.kind === 'completion'),
    studentMsg = snap.messages.find((m) => m.kind === 'taskPublished');
  await assert.rejects(
    s.api.markMessagesRead({ ids: [teacherMsg.id] }, 'student'),
    (e) => e.status === 403,
  );
  await Promise.all([
    s.api.markMessagesRead({ ids: [teacherMsg.id] }, 'teacher'),
    s.api.markMessagesRead({ ids: [studentMsg.id] }, 'student'),
  ]);
  snap = await s.api.snapshot();
  assert.ok(snap.messages.every((m) => m.read));
  await assert.rejects(
    s.api.submit({ ...body, requestId: 'other-request' }, 'student'),
    (e) => e.status === 409,
  );
  assert.equal((await s.api.snapshot()).messages.length, 2);
});
test('日/周/月/单次到点提醒只发一次；完成、暂停、停用不发送；下一轮恢复', async () => {
  for (const rule of ['day', 'week', 'month', 'once']) {
    const s = setup(),
      t = await task(s, {
        rule: rule === 'once' ? null : rule,
        kind: rule === 'once' ? 'once' : 'recurring',
        deadline: at('2026-10-14T00:00'),
        reminder: { amount: 2, unit: 'hours' },
      }),
      p = M.period(t, t.created),
      cutoff = t.kind === 'once' ? t.deadline : p.end;
    s.setTime(cutoff - 7200000 - 1);
    assert.equal((await s.api.snapshot()).messages.filter((m) => m.kind === 'reminder').length, 0);
    s.setTime(cutoff - 7200000);
    const snaps = await Promise.all([s.api.snapshot(), s.api.snapshot()]);
    assert.equal(snaps[0].messages.filter((m) => m.kind === 'reminder').length, 1);
    assert.equal((await s.api.snapshot()).messages.filter((m) => m.kind === 'reminder').length, 1);
    if (rule !== 'once') {
      const nextEnd = M.period(t, cutoff).end;
      s.setTime(nextEnd - 7200000);
      assert.equal(
        (await s.api.snapshot()).messages.filter((m) => m.kind === 'reminder').length,
        2,
      );
    }
  }
  const s = setup(),
    completed = await task(s, { reminder: { amount: 2, unit: 'hours' } });
  await submit(s, completed);
  const paused = await task(s, { reminder: { amount: 2, unit: 'hours' } });
  await s.api.pauseRound(
    {
      taskId: paused.id,
      expected: paused.revision,
      round: M.period(paused, paused.created).key,
      paused: true,
    },
    'teacher',
  );
  await task(s, { enabled: false, reminder: { amount: 2, unit: 'hours' } });
  s.setTime(at('2026-10-13T22:00'));
  assert.equal((await s.api.snapshot()).messages.filter((m) => m.kind === 'reminder').length, 0);
});
test('同角色并发标记不同消息为已读，最终取并集', async () => {
  const s = setup();
  await task(s);
  await task(s);
  const ids = (await s.api.snapshot()).messages.map((m) => m.id);
  await Promise.all(ids.map((id) => s.api.markMessagesRead({ ids: [id] }, 'student')));
  assert.ok((await s.api.snapshot()).messages.every((m) => m.read));
});
