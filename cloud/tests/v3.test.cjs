const test = require('node:test'),
  assert = require('node:assert/strict'),
  { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs');
const M = globalThis.TaskModel,
  base = M.parse('2026-11-02T12:00');
test('双方可删除非空目录、内容回到根目录、附件不变、旧目录不可写入', async () => {
  const mem = createMemory(),
    api = createService(mem.store, mem.objects, () => base);
  for (const [scope, type] of [
    ['materials', 'material'],
    ['exams', 'exam'],
  ]) {
    const folder = await api.saveLibrary(
      {
        entry: {
          id: scope,
          type: 'folder',
          scope,
          name: '资料夹',
          semesters: ['七年级上学期'],
          color: '#e8f0e9',
        },
      },
      'teacher',
    );
    const bytes = Buffer.from('original-document'),
      u = await api.beginLibraryUpload(
        { libraryType: type, name: '资料.pdf', contentType: 'application/pdf', size: bytes.length },
        'student',
      ),
      part = await api.uploadPart(u.uploadId, 1, bytes, 'student');
    await api.finishUpload(u.uploadId, { parts: [part] }, 'student');
    const entry = await api.saveLibrary(
      {
        entry: {
          id: type,
          name: '资料',
          type,
          subject: '数学',
          uploader: 'student',
          semesters: ['七年级上学期'],
          folderId: folder.id,
          files: [{ uploadId: u.uploadId }],
        },
      },
      'student',
    );
    await assert.rejects(
      api.deleteLibrary({ id: folder.id, expected: folder.revision + 1 }, 'teacher'),
      (e) => e.status === 409,
    );
    await api.deleteLibrary({ id: folder.id, expected: folder.revision }, 'student');
    const actual = (await api.snapshot()).library.find((x) => x.id === entry.id);
    assert.equal(actual.folderId, null);
    assert.deepEqual((await api.file(u.uploadId)).bytes, bytes);
    await assert.rejects(
      api.saveLibrary(
        { entry: { ...entry, name: '旧页面编辑' }, expected: entry.revision },
        'teacher',
      ),
      (e) => e.status === 400,
    );
    await api.saveLibrary(
      { entry: { ...actual, name: '新名称' }, expected: actual.revision },
      'teacher',
    );
    await assert.rejects(
      api.saveLibrary({ entry: folder, expected: folder.revision }, 'teacher'),
      (e) => e.status === 409,
    );
  }
});
test('停用默认打卡从当天日历移除，保留此前完成，修改后停用日期不漂移，恢复后重现', async () => {
  const mem = createMemory();
  let clock = base - M.DAY;
  const api = createService(mem.store, mem.objects, () => clock);
  await api.saveTask(
    { task: { id: 'auto', name: '自动', format: 'auto', dateOnly: true } },
    'teacher',
  );
  await api.snapshot();
  clock += M.DAY;
  let s = await api.snapshot();
  assert.equal(s.records.length, 2);
  let t = s.tasks[0];
  t = await api.saveTask({ task: { ...t, enabled: false }, expected: t.revision }, 'teacher');
  s = await api.snapshot();
  assert.equal(M.calendarRecords(s.tasks, s.records, M.parse('2026-11-02'), 'teacher').length, 0);
  assert.equal(M.calendarRecords(s.tasks, s.records, M.parse('2026-11-01'), 'student').length, 1);
  assert.equal(s.records.length, 2);
  clock += M.DAY;
  t = await api.saveTask({ task: { ...t, name: '修改停用任务' }, expected: t.revision }, 'teacher');
  assert.equal(t.disabledAt, base);
  t = await api.saveTask({ task: { ...t, enabled: true }, expected: t.revision }, 'teacher');
  s = await api.snapshot();
  assert.equal(M.calendarRecords(s.tasks, s.records, M.parse('2026-11-02'), 'teacher').length, 1);
  assert.equal(t.disabledAt, null);
});
test('移除固定测试历史并备份，名称相似正式任务不受影响，重复快照幂等', async () => {
  const mem = createMemory(),
    api = createService(mem.store, mem.objects, () => base);
  const hidden = {
    id: 'e2etest-20261010',
    name: 'E2E验收测试',
    kind: 'recurring',
    rule: 'day',
    format: 'text',
    created: base,
    updated: base,
    revision: 1,
    enabled: false,
    deletedAt: base,
    semester: '',
    createdBy: 'teacher',
    _rounds: {},
  };
  await mem.store.putTask(hidden, null);
  await api.saveTask({ task: { id: 'normal', name: 'E2E验收测试正式作业' } }, 'teacher');
  const s = await api.snapshot();
  assert.deepEqual(
    s.tasks.map((x) => x.id),
    ['normal'],
  );
  assert.ok(mem.tasks.get(hidden.id).historyPurged);
  assert.ok(mem.files.has('backups/v3-test-history/' + hidden.id + '.json'));
  const revision = mem.tasks.get(hidden.id).revision;
  await api.snapshot();
  assert.equal(mem.tasks.get(hidden.id).revision, revision);
  assert.deepEqual(
    (await api.widgetSnapshot()).tasks.map((x) => x.id),
    ['normal'],
  );
});
test('周期日期只显示实际日期，相同起止不重复，多星期不包含未选中间日', () => {
  const t = { kind: 'recurring', rule: 'week', dateOnly: true, weekDays: [6] },
    p = M.period(t, base);
  assert.equal(M.scheduleLabel(t, p), '2026-11-08');
  assert.equal(M.scheduleLabel({ ...t, weekDays: [6, 0] }, p), '2026-11-02、2026-11-08');
  assert.equal(
    M.scheduleLabel(
      { kind: 'recurring', rule: 'day', dateOnly: true },
      M.period({ kind: 'recurring', rule: 'day' }, base),
    ),
    '2026-11-02',
  );
});
