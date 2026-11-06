const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path');
test('排序映射只在创建比较器时构建，结果与既有角色顺序/默认时间顺序完全一致', () => {
  const c = vm.createContext({
    document: { addEventListener() {} },
    localStorage: {
      getItem() {
        return null;
      },
    },
    Map,
    Date,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../task-order.js'), 'utf8'), c);
  const compare = vm.runInContext('TaskOrdering.compare', c),
    tasks = Array.from({ length: 500 }, (_, i) => ({ id: 'task' + i, created: i % 17 }));
  for (const ids of [
    [],
    ['task4', 'task2', 'task9'],
    tasks
      .slice(0, 50)
      .reverse()
      .map((x) => x.id),
    ['task3', 'task3', 'task4'],
  ]) {
    const old = (a, b) => {
      const rank = new Map(ids.map((id, i) => [id, i]));
      return (
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
        b.created - a.created ||
        a.id.localeCompare(b.id)
      );
    };
    assert.deepEqual(
      [...tasks].sort(compare(ids)).map((t) => t.id),
      [...tasks].sort(old).map((t) => t.id),
    );
  }
});
