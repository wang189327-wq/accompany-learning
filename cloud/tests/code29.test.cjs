const test = require('node:test'),
  assert = require('node:assert/strict'),
  { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs'),
  X = require('../my-model.js');
test('新增目标、表格填充和行列移动云端往返；旧客户端不丢失新增目标，显式清空有效', async () => {
  const memory = createMemory(),
    api = createService(memory.store, memory.objects);
  let table = X.table();
  table = X.insertRow(table, 1);
  table.rows[0][0] = '2025';
  table.rows[1][0] = '2026';
  table = X.fill(table, null, true);
  table = X.move(table, 'row', 0, 1, 'after');
  let value = await api.saveMyPreference(
    {
      value: {
        id: 'shared',
        school: '目标学校',
        table,
        goals: {
          体育: { full: 30, score: 28, rank: 1 },
          实验: { full: 10, score: 9, rank: 2 },
          总分: { full: 760, score: 700, rank: 3 },
        },
      },
      expected: 0,
    },
    'student',
  );
  const snap = await api.snapshot(),
    stored = snap.preferences.find((p) => p.id === 'shared');
  assert.deepEqual(stored.table, table);
  assert.equal(stored.goals.总分.full, 760);
  assert.ok(
    snap.features.goalExtras && snap.features.tableEditing && snap.features.customExamScore,
  );
  value = await api.saveMyPreference(
    { value: { ...value, goals: { 数学: { full: 100, score: 90, rank: 1 } } }, expected: 1 },
    'teacher',
  );
  assert.equal(value.goals.体育.full, 30);
  assert.equal(value.goals.总分.score, 700);
  value = await api.saveMyPreference(
    { value: { ...value, goals: { ...value.goals, 体育: null } }, expected: 2 },
    'student',
  );
  assert.equal(value.goals.体育, undefined);
  assert.equal(value.goals.实验.full, 10);
  await assert.rejects(
    api.saveMyPreference({ value, expected: 1 }, 'teacher'),
    (e) => e.status === 409,
  );
});
