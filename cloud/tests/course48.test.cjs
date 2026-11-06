const test = require('node:test'),
  assert = require('node:assert/strict'),
  { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs');
const now = () => Date.UTC(2026, 10, 2, 4),
  fixture = () => {
    const mem = createMemory();
    return { mem, api: createService(mem.store, mem.objects, now) };
  };
test('文件任务多附件上传下载、重试幂等、补交独立、删除后保留、禁止空提交和AI误读', async () => {
  const { api } = fixture();
  let t = await api.saveTask(
    { task: { id: 'files', name: '文件作业', format: 'file' } },
    'teacher',
  );
  const ids = [];
  for (const [name, type, data] of [
    ['练习.pdf', 'application/pdf', 'pdf-bytes'],
    [
      '答题.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx-bytes',
    ],
  ]) {
    const bytes = Buffer.from(data),
      u = await api.beginUpload(
        { taskId: t.id, kind: 'file', name, size: bytes.length, contentType: type },
        'student',
      ),
      p = await api.uploadPart(u.uploadId, 1, bytes, 'student');
    await api.finishUpload(u.uploadId, { parts: [p] }, 'student');
    ids.push(u.uploadId);
  }
  const body = {
    taskId: t.id,
    taskRevision: t.revision,
    round: global.TaskModel.period(t, now()).key,
    requestId: 'files-submit-1234',
    selfScore: 8,
    uploadIds: ids,
  };
  await assert.rejects(api.submit({ ...body, uploadIds: [] }, 'student'), /必须上传作业文件/);
  const first = await api.submit(body, 'student');
  assert.equal(first.files.length, 2);
  assert.deepEqual(first.images, []);
  assert.equal((await api.submit(body, 'student')).recordKey, first.recordKey);
  assert.equal((await api.file(ids[0])).bytes.toString(), 'pdf-bytes');
  await assert.rejects(
    api.requestReview(
      { taskId: t.id, recordKey: first.recordKey, requestId: 'file-review-1234' },
      'teacher',
    ),
    /暂不支持AI点评/,
  );
  t = (await api.snapshot()).tasks[0];
  const second = await api.submit(
    { ...body, taskRevision: t.revision, requestId: 'files-submit-5678' },
    'student',
  );
  assert.notEqual(second.recordKey, first.recordKey);
  t = (await api.snapshot()).tasks[0];
  await api.saveTask({ task: { ...t, deletedAt: now() }, expected: t.revision }, 'teacher');
  assert.equal((await api.snapshot()).records.length, 2);
  assert.equal((await api.file(ids[1])).bytes.toString(), 'docx-bytes');
});
test('单次默认打卡立即完成或等待开始日期，永久只生成一条', async () => {
  const { api } = fixture();
  await api.saveTask(
    { task: { id: 'auto-once', name: '单次默认', kind: 'once', format: 'auto' } },
    'teacher',
  );
  let s = await api.snapshot();
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].automatic, true);
  assert.equal(s.records[0].round, '单次');
  s = await api.snapshot();
  assert.equal(s.records.length, 1);
  await api.saveTask(
    {
      task: {
        id: 'auto-future',
        name: '未来单次',
        kind: 'once',
        format: 'auto',
        availableFrom: now() + 86400000,
      },
    },
    'teacher',
  );
  assert.equal((await api.snapshot()).records.length, 1);
  const mem = createMemory();
  let clock = now();
  const futureApi = createService(mem.store, mem.objects, () => clock);
  let t = await futureApi.saveTask(
    {
      task: {
        id: 'future',
        name: '将来',
        kind: 'once',
        format: 'auto',
        availableFrom: clock + 86400000,
      },
    },
    'teacher',
  );
  assert.equal((await futureApi.snapshot()).records.length, 0);
  clock += 86400000;
  assert.equal((await futureApi.snapshot()).records.length, 1);
  t = (await futureApi.snapshot()).tasks[0];
  await futureApi.saveTask(
    {
      task: { ...t, availableFrom: clock + 86400000, deadline: clock + 3 * 86400000 },
      expected: t.revision,
    },
    'teacher',
  );
  clock += 2 * 86400000;
  assert.equal((await futureApi.snapshot()).records.length, 1);
});
test('老师学生都能仅名称发布，默认每天文字启用，无伪造学科学期', async () => {
  for (const who of ['teacher', 'student']) {
    const { api } = fixture(),
      t = await api.saveTask({ task: { id: 'minimal', name: '  只填名称  ' } }, who);
    assert.equal(t.name, '只填名称');
    assert.equal(t.subject, '');
    assert.equal(t.semester, '');
    assert.equal(t.kind, 'recurring');
    assert.equal(t.rule, 'day');
    assert.equal(t.format, 'text');
    assert.equal(t.enabled, true);
    assert.equal(t.requiresTeaching, false);
    const s = await api.snapshot();
    assert.equal(s.tasks[0].semester, '');
    assert.equal(s.features.courseTasks, true);
    assert.equal(s.features.optionalTaskFields, true);
  }
});
test('授课信息可编辑，旧客户端不传时保留，老任务读取默认否且不批量重写', async () => {
  const { mem, api } = fixture();
  let t = await api.saveTask(
    { task: { id: 'course', name: '课程', requiresTeaching: true } },
    'teacher',
  );
  assert.equal(t.requiresTeaching, true);
  const { requiresTeaching, ...oldClient } = t;
  t = await api.saveTask(
    { task: { ...oldClient, name: '旧客户端修改名称' }, expected: t.revision },
    'teacher',
  );
  assert.equal(t.requiresTeaching, true);
  t = await api.saveTask(
    { task: { ...t, requiresTeaching: false }, expected: t.revision },
    'teacher',
  );
  assert.equal(t.requiresTeaching, false);
  delete mem.tasks.get('course').requiresTeaching;
  const revision = mem.tasks.get('course').revision;
  assert.equal((await api.snapshot()).tasks[0].requiresTeaching, false);
  assert.equal(mem.tasks.get('course').revision, revision);
});
test('空单次日期自动补齐，星期可留空；非法非空字段仍拒绝', async () => {
  const { api } = fixture();
  const t = await api.saveTask({ task: { id: 'once', name: '单次', kind: 'once' } }, 'teacher');
  assert.ok(Number.isFinite(t.deadline) && t.deadline > now());
  const w = await api.saveTask(
    { task: { id: 'week', name: '周任务', rule: 'week', weekDays: null } },
    'teacher',
  );
  assert.equal(w.rule, 'week');
  for (const bad of [
    { subject: '不合法' },
    { semester: '不合法' },
    { requiresTeaching: 'true' },
    { kind: 'bad' },
    { format: 'bad' },
    { rule: 'bad' },
  ])
    await assert.rejects(api.saveTask({ task: { id: 'bad', name: '校验', ...bad } }, 'teacher'));
  await assert.rejects(api.saveTask({ task: { id: 'empty', name: '  ' } }, 'teacher'));
});
test('课程停用恢复保留原作业和字段，学生不能修改老师的任务', async () => {
  const { api } = fixture();
  let t = await api.saveTask(
    { task: { id: 't', name: '课程', requiresTeaching: true } },
    'teacher',
  );
  await assert.rejects(
    api.saveTask({ task: { ...t, requiresTeaching: false }, expected: t.revision }, 'student'),
    (e) => e.status === 403,
  );
  t = await api.saveTask({ task: { ...t, enabled: false }, expected: t.revision }, 'teacher');
  assert.equal(t.enabled, false);
  assert.equal(t.requiresTeaching, true);
  t = await api.saveTask({ task: { ...t, enabled: true }, expected: t.revision }, 'teacher');
  assert.equal(t.enabled, true);
  assert.equal(t.requiresTeaching, true);
});
