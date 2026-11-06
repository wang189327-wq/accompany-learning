const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemory } = require('../memory.cjs');
const { createService } = require('../core.cjs');
const fixture = () => {
  const memory = createMemory();
  return {
    ...memory,
    api: createService(memory.store, memory.objects, () => Date.UTC(2026, 10, 6)),
  };
};
const group = (id = 'group-one') => ({
  id,
  name: '阅读提升',
  subject: '语文',
  semester: '七年级上学期',
});

test('任务独立于作业：双方发布、同名不同ID、完整及增量快照、备份', async () => {
  const { api, files } = fixture();
  const first = await api.publishAssignmentGroup({ group: group() }, 'teacher');
  await api.publishAssignmentGroup({ group: group('group-two') }, 'student');
  assert.equal(first.createdBy, 'teacher');
  const full = await api.snapshot();
  assert.equal(full.assignmentGroups.length, 2);
  assert.equal(full.tasks.length, 0);
  assert.equal(full.features.assignmentGroups, true);
  assert.equal((await api.snapshot(full.serverTime - 1)).assignmentGroups.length, 2);
  const backup = await api.backup('teacher');
  assert.equal(JSON.parse(files.get(backup.backupKey)).assignmentGroups.length, 2);
});

test('关联可空；旧客户端缺省保留、显式null解除；作业元数据不受任务覆盖', async () => {
  const { api } = fixture();
  await api.publishAssignmentGroup({ group: group() }, 'teacher');
  const old = await api.saveTask({ task: { id: 'old-assignment', name: '旧作业' } }, 'teacher');
  assert.equal(old.assignmentGroupId, null);
  const linked = await api.saveTask(
    { task: { ...old, assignmentGroupId: 'group-one', subject: '数学' }, expected: old.revision },
    'teacher',
  );
  const input = { ...linked, name: '旧客户端改名' };
  delete input.assignmentGroupId;
  const preserved = await api.saveTask({ task: input, expected: linked.revision }, 'teacher');
  assert.equal(preserved.assignmentGroupId, 'group-one');
  assert.equal(preserved.subject, '数学');
  const unlinked = await api.saveTask(
    { task: { ...preserved, assignmentGroupId: null }, expected: preserved.revision },
    'teacher',
  );
  assert.equal(unlinked.assignmentGroupId, null);
  await assert.rejects(
    api.saveTask(
      { task: { ...unlinked, assignmentGroupId: 'unknown' }, expected: unlinked.revision },
      'teacher',
    ),
    /任务不存在/,
  );
});

test('必填校验、身份和重复ID保护；同时创建不丢任务', async () => {
  const { api } = fixture();
  for (const field of ['name', 'subject', 'semester']) {
    await assert.rejects(
      api.publishAssignmentGroup({ group: { ...group(), [field]: '' } }, 'teacher'),
    );
  }
  await assert.rejects(api.publishAssignmentGroup({ group: group() }, 'other'), /身份/);
  await api.publishAssignmentGroup({ group: group() }, 'teacher');
  await assert.rejects(api.publishAssignmentGroup({ group: group() }, 'student'), /已存在/);
  await Promise.all(
    ['a', 'b', 'c'].map((id) => api.publishAssignmentGroup({ group: group(id) }, 'student')),
  );
  assert.equal((await api.snapshot()).assignmentGroups.length, 4);
});
