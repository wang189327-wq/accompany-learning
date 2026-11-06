'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs');
const M = globalThis.TaskModel,
  S = require('../study-model.js'),
  at = (x) => M.parse(x),
  semester = '七年级上学期';
const task = (id, extra = {}) => ({
  id,
  name: '每周练习',
  semester,
  subject: '数学',
  kind: 'recurring',
  rule: 'week',
  format: 'text',
  enabled: true,
  ...extra,
});
test('学生可以发布并管理自己的作业，不能修改、删除老师作业；来源不能伪造或转移', async () => {
  const m = createMemory(),
    api = createService(m.store, m.objects, () => at('2026-07-01T10:00'));
  const teacher = await api.saveTask({ task: task('teacher') }, 'teacher');
  const student = await api.saveTask(
    { task: task('student', { createdBy: 'teacher' }) },
    'student',
  );
  assert.equal(student.createdBy, 'student');
  for (const change of [
    { name: '篡改' },
    { deletedAt: 1 },
    { enabled: false },
    { createdBy: 'student' },
  ])
    await assert.rejects(
      api.saveTask({ task: { ...teacher, ...change }, expected: teacher.revision }, 'student'),
      (e) => e.status === 403,
    );
  const next = await api.saveTask(
    {
      task: { ...student, name: '自主学习', semester: '八年级下学期', createdBy: 'teacher' },
      expected: student.revision,
    },
    'student',
  );
  assert.equal(next.createdBy, 'student');
  assert.equal(next.semester, '八年级下学期');
  const changed = await api.saveTask(
    { task: { ...next, name: '老师调整' }, expected: next.revision },
    'teacher',
  );
  assert.equal(changed.createdBy, 'student');
  await assert.rejects(
    api.saveTask({ task: { ...next, name: '旧版本' }, expected: next.revision }, 'student'),
    (e) => e.status === 409,
  );
  const deleted = await api.saveTask(
    { task: { ...changed, deletedAt: 1 }, expected: changed.revision },
    'student',
  );
  assert.ok(deleted.deletedAt);
  assert.equal(
    (await api.saveTask({ task: task('no-semester', { semester: undefined }) }, 'student'))
      .semester,
    '',
  );
  assert.equal(
    M.status(student, M.period(student, student.created), null, student.created).color,
    'blue',
  );
  assert.equal(
    M.status(student, M.period(student, student.created), { late: false }, student.created).color,
    'green',
  );
  assert.equal(
    M.status(
      { ...student, kind: 'once' },
      M.period(student, student.created),
      { late: true },
      student.created,
    ).color,
    'purple',
  );
});
test('旧作业和资料学期补齐前先备份，迁移幂等且不删除以后停用的作业', async () => {
  const m = createMemory(),
    api = createService(m.store, m.objects, () => at('2026-07-10T10:00'));
  const legacy = {
    ...task('old'),
    created: at('2026-07-01T10:00'),
    revision: 1,
    _rounds: {},
    enabled: false,
  };
  delete legacy.semester;
  m.tasks.set(legacy.id, legacy);
  m.library.set('folder', {
    id: 'folder',
    type: 'folder',
    scope: 'materials',
    name: '旧文件夹',
    color: '#e8f0e9',
    revision: 1,
  });
  m.library.set('material', {
    id: 'material',
    type: 'material',
    name: '旧资料',
    subject: '数学',
    uploader: 'teacher',
    files: [],
    revision: 1,
  });
  let s = await api.snapshot();
  assert.equal(s.tasks[0].semester, semester);
  assert.equal(s.tasks[0].createdBy, 'teacher');
  assert.equal(s.tasks[0].deletedAt, undefined);
  assert.ok(s.library.every((e) => e.semesters[0] === semester));
  assert.equal(s.features.studentTasks, true);
  const backups = [...m.files.keys()].filter((k) => k.startsWith('backups/upgrade'));
  assert.equal(backups.length, 1);
  const old = JSON.parse(m.files.get(backups[0]));
  assert.equal(old.tasks[0].semester, undefined);
  assert.equal(old.library[0].semesters, undefined);
  await api.snapshot();
  assert.equal([...m.files.keys()].filter((k) => k.startsWith('backups/upgrade')).length, 1);
  assert.equal(m.tasks.get('old').revision, 2);
});
test('迁移备份失败时不写入作业或资料；并发冲突不会覆盖用户修改', async () => {
  const m = createMemory(),
    api = createService(m.store, m.objects);
  m.tasks.set('old', {
    ...task('old', { semester: undefined }),
    created: 1,
    revision: 1,
    _rounds: {},
  });
  const put = m.objects.put;
  m.objects.put = async () => {
    throw Error('backup unavailable');
  };
  await assert.rejects(api.snapshot(), /backup unavailable/);
  assert.equal(m.tasks.get('old').revision, 1);
  m.objects.put = put;
  const save = m.store.putTask;
  m.store.putTask = async (t, expected) => {
    m.tasks.set('old', {
      ...m.tasks.get('old'),
      semester: '八年级上学期',
      createdBy: 'teacher',
      revision: 2,
      name: '并发修改',
    });
    return save(t, expected);
  };
  const result = await api.snapshot();
  assert.equal(result.tasks[0].name, '并发修改');
  assert.equal(result.tasks[0].semester, '八年级上学期');
});
test('资料和文件夹学期必选、多选去重；学期筛选取并集，目标按满分换算', () => {
  const base = {
    id: 'doc',
    type: 'material',
    name: '讲义',
    subject: '数学',
    uploader: 'student',
    files: [{}],
  };
  assert.throws(() => S.validate(base), /所属学期/);
  const doc = S.validate({ ...base, semesters: [semester, '八年级下学期', semester] });
  assert.deepEqual(doc.semesters, [semester, '八年级下学期']);
  assert.equal(S.filter([doc], { semesters: ['九年级下学期', '八年级下学期'] }).length, 1);
  assert.equal(S.filter([doc], { semesters: ['七年级下学期'] }).length, 0);
  assert.throws(
    () =>
      S.validate({
        id: 'folder',
        type: 'folder',
        scope: 'materials',
        name: '目录',
        color: '#e8f0e9',
        semesters: [],
      }),
    /所属学期/,
  );
  const paper = {
    id: 'p',
    type: 'exam',
    name: '月考',
    semester,
    subject: '数学',
    fullScore: 120,
    score: 96,
    rank: 2,
    examDate: S.date('2026-07-10'),
    notes: '无',
    files: [{}],
    targetScore: 108,
  };
  assert.equal(S.validate(paper).targetScore, 108);
  assert.throws(() => S.validate({ ...paper, targetScore: 121 }), /目标分数/);
  for (const base of [100, 120, 150]) {
    const point = S.exams([paper], { base, semesters: [semester, '八年级上学期'] })[0];
    assert.equal(point.plottedScore, base * 0.8);
    assert.equal(point.plottedTarget, base * 0.9);
    assert.equal(point.rank, 2);
  }
  assert.equal(S.exams([paper], { semesters: ['七年级下学期'] }).length, 0);
  assert.equal(S.exams([{ ...paper, targetScore: null }])[0].plottedTarget, null);
});
test('月历分别显示7月1日和10日的周作业打卡，补交落在实际提交日，已删除学生不可见', () => {
  const t = { ...task('weekly'), created: at('2026-07-01T10:00') },
    r1 = { taskId: t.id, round: '2026-W27', completed: at('2026-07-01T20:00'), late: false },
    r2 = { taskId: t.id, round: '2026-W28', completed: at('2026-07-10T20:00'), late: false },
    late = { taskId: t.id, round: '2026-W29', completed: at('2026-07-21T20:00'), late: true },
    rs = [r1, r2, late];
  assert.equal(M.calendarRecords([t], rs, S.date('2026-07-01'), 'student')[0], r1);
  assert.equal(M.calendarRecords([t], rs, S.date('2026-07-10'), 'student')[0], r2);
  assert.equal(M.calendarRecords([t], rs, S.date('2026-07-21'), 'student')[0], late);
  assert.equal(M.calendarRecords([t], rs, S.date('2026-07-15'), 'student').length, 0);
  assert.equal(M.calendarPending([t], rs, S.date('2026-07-02')).length, 0);
  assert.equal(M.calendarPending([t], rs, S.date('2026-07-06')).length, 1);
  assert.equal(
    M.calendarRecords(
      [{ ...t, deletedAt: at('2026-07-22T12:00') }],
      rs,
      S.date('2026-07-10'),
      'student',
    ).length,
    0,
  );
  assert.equal(
    M.calendarRecords([{ ...t, deletedAt: 1 }], rs, S.date('2026-07-10'), 'teacher').length,
    1,
  );
  const midnight = { ...r1, completed: at('2026-07-02T00:00') };
  assert.equal(M.calendarRecords([t], [midnight], S.date('2026-07-01'), 'student').length, 0);
  assert.equal(M.calendarRecords([t], [midnight], S.date('2026-07-02'), 'student').length, 1);
});
