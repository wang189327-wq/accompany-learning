const test = require('node:test'),
  assert = require('node:assert/strict');
const { createService } = require('../core.cjs'),
  { createMemory } = require('../memory.cjs'),
  { createServer } = require('../server.cjs');
const S = require('../study-model.js');
function fixture() {
  const memory = createMemory();
  return { memory, api: createService(memory.store, memory.objects) };
}
async function upload(
  api,
  libraryType = 'material',
  who = 'teacher',
  bytes = Buffer.from('test-document'),
  name = '讲义.pdf',
) {
  const start = await api.beginLibraryUpload(
    { libraryType, size: bytes.length, name, contentType: 'application/pdf' },
    who,
  );
  const part = await api.uploadPart(start.uploadId, 1, bytes, who);
  await api.finishUpload(start.uploadId, { parts: [part] }, who);
  return { uploadId: start.uploadId };
}
const paper = (files, extra = {}) => ({
  id: 'paper-1',
  type: 'exam',
  name: '数学月考',
  subject: '数学',
  semester: '七年级上学期',
  score: 96,
  rank: 8,
  fullScore: 120,
  examDate: S.date('2026-10-10'),
  notes: '无',
  files,
  ...extra,
});
test('双方上传文档、共用文件夹、编辑覆盖旧信息且不记录上传时间', async () => {
  const { api, memory } = fixture();
  const folder = await api.saveLibrary(
    {
      entry: {
        id: 'folder-1',
        type: 'folder',
        semesters: ['七年级上学期'],
        name: '复习资料',
        scope: 'materials',
        color: '#e8f0e9',
        created: 1,
      },
    },
    'student',
  );
  const file = await upload(api);
  const entry = await api.saveLibrary(
    {
      entry: {
        id: 'material-1',
        type: 'material',
        semesters: ['七年级上学期'],
        name: '旧名称',
        subject: '语文',
        uploader: 'teacher',
        folderId: folder.id,
        files: [file],
        created: 1,
      },
    },
    'teacher',
  );
  const next = await api.saveLibrary(
    {
      entry: {
        ...entry,
        name: '新名称',
        subject: '数学',
        uploader: 'student',
        folderId: null,
        updated: 2,
      },
      expected: entry.revision,
    },
    'student',
  );
  assert.equal(next.name, '新名称');
  assert.equal(next.subject, '数学');
  assert.equal(next.folderId, null);
  assert.equal(next.uploader, 'student');
  assert.equal(memory.library.size, 2);
  assert.equal(next.created, undefined);
  assert.equal(next.updated, undefined);
  assert.equal(next.uploadedAt, undefined);
  const meta = JSON.parse(memory.files.get('uploads/' + file.uploadId + '.json'));
  assert.equal(meta.created, undefined);
  await assert.rejects(
    api.saveLibrary({ entry: { ...next, name: '覆盖别人' }, expected: entry.revision }, 'teacher'),
    (e) => e.status === 409,
  );
  const renamed = await api.saveLibrary(
    { entry: { ...folder, name: '新文件夹', color: '#dceafb' }, expected: folder.revision },
    'teacher',
  );
  assert.equal(renamed.name, '新文件夹');
  const snapshot = await api.snapshot();
  assert.equal(snapshot.tasks.length, 0);
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.library.length, 2);
  assert.equal((await api.file(file.uploadId)).bytes.toString(), 'test-document');
});
test('必填字段、文件完整性和文件夹归属由云端校验', async () => {
  const { api } = fixture(),
    file = await upload(api, 'exam', 'student');
  const saved = await api.saveLibrary({ entry: paper([file]) }, 'student');
  assert.equal(saved.score, 96);
  for (const [key, value] of Object.entries({
    name: '',
    subject: '体育',
    semester: '高中',
    score: -1,
    rank: 0,
    fullScore: 0,
    examDate: -1,
    files: [],
  })) {
    await assert.rejects(
      api.saveLibrary({ entry: paper([file], { id: 'invalid-' + key, [key]: value }) }, 'teacher'),
      (e) => e.status === 400,
    );
  }
  const folder = await api.saveLibrary(
    {
      entry: {
        id: 'wrong-folder',
        type: 'folder',
        semesters: ['七年级上学期'],
        scope: 'materials',
        name: '资料夹',
        color: '#dceafb',
      },
    },
    'teacher',
  );
  await assert.rejects(
    api.saveLibrary(
      { entry: paper([file], { id: 'wrong-scope', folderId: folder.id }) },
      'student',
    ),
    (e) => e.status === 400,
  );
  await assert.rejects(
    api.saveLibrary({ entry: paper([file], { id: 'no-role' }) }, 'visitor'),
    (e) => e.status === 403,
  );
  const changed = await api.saveLibrary(
    {
      entry: { ...saved, name: '订正试卷', score: 100, notes: '已订正' },
      expected: saved.revision,
    },
    'teacher',
  );
  assert.equal(changed.score, 100);
  assert.equal(changed.notes, '已订正');
  const unfinished = await api.beginLibraryUpload(
    { libraryType: 'exam', name: '未完成.pdf', size: 10, contentType: 'application/pdf' },
    'teacher',
  );
  await assert.rejects(
    api.saveLibrary(
      { entry: paper([{ uploadId: unfinished.uploadId }], { id: 'not-ready' }) },
      'teacher',
    ),
    (e) => e.status === 400,
  );
});
test('三种分制、满分筛选、日期边界和排名保持原始名次', () => {
  const items = [
    paper([], { id: 'p1' }),
    paper([], { id: 'p2', fullScore: 150, score: 120, rank: 3, examDate: S.date('2026-10-11') }),
    paper([], {
      id: 'p3',
      subject: '英语',
      fullScore: 100,
      score: 80,
      examDate: S.date('2026-10-12'),
    }),
  ];
  for (const base of [100, 120, 150]) {
    const rows = S.exams(items, { subject: '数学', from: '2026-10-10', to: '2026-10-11', base });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].plottedScore, 0.8 * base);
    assert.equal(rows[1].plottedScore, 0.8 * base);
    assert.equal(rows[1].rank, 3);
  }
  assert.equal(S.exams(items, { fullScore: 150 }).length, 1);
  assert.equal(S.exams(items, { to: '2026-10-10' }).length, 1);
  assert.throws(() => S.exams(items, { from: '2026-10-12', to: '2026-10-10' }));
  assert.equal(S.date('2026-02-30'), null);
  const late = {
    id: 'r1',
    taskId: 't1',
    round: '2026-W40',
    completed: S.date('2026-10-11') + 1000,
    selfScore: 8,
    teacherScore: null,
  };
  assert.equal(S.taskPoints([late], 't1', '2026-10-11', '2026-10-11').length, 1);
  assert.equal(S.taskPoints([late], 't1', '2026-10-01', '2026-10-10').length, 0);
  assert.equal(S.taskPoints([late], 't1')[0].teacherScore, null);
});
test('新接口鉴权、文档字节传输、元数据保存及共享快照', async (t) => {
  const { memory } = fixture(),
    token = 'test-' + 'x'.repeat(40),
    server = createServer({ token, provider: () => memory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = 'http://127.0.0.1:' + server.address().port,
    headers = {
      Authorization: 'Bearer ' + token,
      'X-C9-Role': 'teacher',
      'Content-Type': 'application/json',
    };
  const request = async (p, data, raw = false) =>
    fetch(base + p, { method: 'POST', headers, body: raw ? data : JSON.stringify(data) });
  assert.equal((await fetch(base + '/api/files/file-1')).status, 401);
  const start = await (
    await request('/api/uploads', {
      scope: 'library',
      libraryType: 'material',
      name: '复习资料.pdf',
      size: 3,
      contentType: 'application/pdf',
    })
  ).json();
  const part = await (
    await request('/api/uploads/' + start.uploadId + '/parts/1', Buffer.from('PDF'), true)
  ).json();
  assert.equal(
    (await request('/api/uploads/' + start.uploadId + '/complete', { parts: [part] })).status,
    200,
  );
  assert.equal(
    (
      await request('/api/library/save', {
        entry: {
          id: 'doc-1',
          type: 'material',
          semesters: ['七年级上学期'],
          name: '课件',
          subject: '英语',
          uploader: 'teacher',
          files: [{ uploadId: start.uploadId }],
        },
      })
    ).status,
    200,
  );
  const file = await fetch(base + '/api/files/' + start.uploadId, { headers });
  assert.equal(await file.text(), 'PDF');
  assert.ok(file.headers.get('content-disposition').includes('attachment'));
  const snapshot = await (await fetch(base + '/api/snapshot', { headers })).json();
  assert.equal(snapshot.library[0].name, '课件');
  assert.equal(snapshot.features.library, true);
  const backup = await (await request('/api/backup', {})).json();
  const payload = JSON.parse(memory.files.get(backup.backupKey));
  assert.equal(payload.library.length, 1);
});
