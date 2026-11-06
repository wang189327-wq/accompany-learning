const test = require('node:test'),
  assert = require('node:assert/strict');
const { createService } = require('../core.cjs'),
  { createMemory } = require('../memory.cjs');
const M = global.TaskModel,
  at = M.parse;
const base = {
  id: 'schedule',
  name: '周末练习',
  subject: '数学',
  semester: '七年级上学期',
  created: at('2026-10-14T10:00'),
  kind: 'recurring',
  rule: 'week',
  format: 'text',
  enabled: true,
  weekDays: [6],
  startTime: '09:30',
  endTime: '18:45',
};
test('按北京时间分钟与完成星期安排，日周月日历共用同一待办逻辑', () => {
  const p = M.period(base, base.created);
  assert.equal(M.windowFor(base, p).start, at('2026-10-18T09:30'));
  assert.equal(M.windowFor(base, p).end, at('2026-10-18T18:45'));
  assert.equal(M.calendarPending([base], [], at('2026-10-17T00:00')).length, 0);
  assert.equal(M.calendarPending([base], [], at('2026-10-18T00:00')).length, 1);
  assert.throws(() => M.submission(base, p.key, at('2026-10-18T09:29'), '作业', [], 8), /尚未到/);
  assert.equal(M.submission(base, p.key, at('2026-10-18T09:30'), '作业', [], 8).late, false);
  assert.equal(M.submission(base, p.key, at('2026-10-18T18:46'), '作业', [], 8).late, true);
  const once = {
    ...base,
    kind: 'once',
    availableFrom: at('2026-10-19T10:01'),
    deadline: at('2026-10-19T10:31'),
  };
  assert.equal(M.calendarPending([once], [], at('2026-10-18T00:00')).length, 0);
  assert.equal(M.calendarPending([once], [], at('2026-10-19T00:00')).length, 1);
  assert.throws(() => M.validateTask({ ...once, availableFrom: once.deadline + 1 }));
});
test('老师和学生均可删除已保存资料或试卷，过期请求拒绝，删除后不再出现在快照', async () => {
  const memory = createMemory(),
    api = createService(memory.store, memory.objects);
  for (const type of ['material', 'exam']) {
    const bytes = Buffer.from('%PDF-test'),
      u = await api.beginLibraryUpload(
        { libraryType: type, size: bytes.length, name: '资料.pdf', contentType: 'application/pdf' },
        'student',
      ),
      part = await api.uploadPart(u.uploadId, 1, bytes, 'student');
    await api.finishUpload(u.uploadId, { parts: [part] }, 'student');
    const entry = await api.saveLibrary(
      {
        entry: {
          id: type,
          name: '待删除资料',
          type,
          subject: '数学',
          uploader: 'student',
          semesters: ['七年级上学期'],
          semester: '七年级上学期',
          score: 90,
          fullScore: 100,
          rank: 1,
          examDate: at('2026-10-18T00:00'),
          notes: '无',
          files: [{ uploadId: u.uploadId }],
        },
      },
      'student',
    );
    await assert.rejects(
      api.deleteLibrary({ id: entry.id, expected: 0 }, 'teacher'),
      (e) => e.status === 409,
    );
    await api.deleteLibrary(
      { id: entry.id, expected: entry.revision },
      type === 'exam' ? 'teacher' : 'student',
    );
    assert.equal(
      (await api.snapshot()).library.some((x) => x.id === entry.id),
      false,
    );
    await assert.rejects(
      api.saveLibrary({ entry, expected: entry.revision + 1 }, 'student'),
      (e) => e.status === 409,
    );
    assert.ok(memory.library.get(entry.id).deletedAt);
  }
  await assert.rejects(
    api.deleteLibrary({ id: 'material', expected: 1 }, 'visitor'),
    (e) => e.status === 403,
  );
});
