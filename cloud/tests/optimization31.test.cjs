const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  { performance } = require('node:perf_hooks');
const root = path.join(__dirname, '../..');
test('附件内存缓存、并发合并、连接隔离、LRU、失败重试和超大文件回退', async () => {
  const c = vm.createContext({ Blob, Map, Promise, Date, globalThis: undefined });
  c.globalThis = c;
  vm.runInContext(fs.readFileSync(path.join(root, 'attachment-cache.js'), 'utf8'), c);
  const cache = c.C9AttachmentCache.create({
    indexedDB: null,
    memoryLimit: 10,
    diskLimit: 30,
    maxEntries: 2,
  });
  let downloads = 0;
  const load = async () => {
    downloads++;
    await new Promise((r) => setTimeout(r, 8));
    return new Blob(['12345']);
  };
  const results = await Promise.all([cache.get('A', 'file1', load), cache.get('A', 'file1', load)]);
  assert.equal(downloads, 1);
  assert.equal(results[0], results[1]);
  await cache.get('A', 'file1', load);
  assert.equal(downloads, 1);
  await cache.get('B', 'file1', load);
  assert.equal(downloads, 2);
  await cache.get('A', 'file2', load);
  await cache.get('A', 'file1', load);
  assert.equal(downloads, 4, 'A file1 evicted independently of B');
  await assert.rejects(
    cache.get('A', 'failure', async () => {
      throw Error('offline');
    }),
    /offline/,
  );
  assert.equal((await cache.get('A', 'failure', load)).size, 5);
  const huge = async () => {
    downloads++;
    return new Blob(['0'.repeat(11)]);
  };
  const before = downloads;
  await cache.get('A', 'huge', huge);
  await cache.get('A', 'huge', huge);
  assert.equal(downloads - before, 2);
  assert.ok(cache.stats().memoryBytes <= 10);
  assert.equal(cache.stats().pending, 0);
});
test('有索引和无索引的历史/日历业务结果完全一致，含删除、停用、暂停、多次提交和同时间排序', () => {
  const contexts = [vm.createContext({}), vm.createContext({})];
  for (const [i, c] of contexts.entries())
    vm.runInContext(
      fs.readFileSync(path.join(root, i ? 'model.js' : 'tests/fixtures/model-3.0.js'), 'utf8'),
      c,
    );
  const old = contexts[0].TaskModel,
    M = contexts[1].TaskModel,
    start = M.parse('2026-10-01'),
    tasks = [],
    records = [];
  for (let i = 0; i < 250; i++) {
    const t = {
      id: 't' + i,
      name: '任务' + i,
      kind: i % 7 === 0 ? 'once' : 'recurring',
      rule: ['day', 'week', 'month'][i % 3],
      format: i % 5 === 0 ? 'auto' : 'text',
      enabled: i % 11 !== 0,
      created: start,
      updated: start + 10 * M.DAY,
      dateOnly: true,
      deadline: start + 30 * M.DAY,
      weekDays: i % 4 === 0 ? [0, 2, 6] : null,
      deletedAt: i % 13 === 0 ? start + 20 * M.DAY : null,
      pausedRounds: i % 17 === 0 ? ['2026-W43'] : [],
    };
    tasks.push(t);
    for (let j = 0; j < 65; j++) {
      const completed = start + (j % 35) * M.DAY + (j % 2 ? 100 : 0),
        p = M.period(t, completed);
      records.push({
        id: t.id + '|' + j,
        taskId: t.id,
        round: p.key,
        completed,
        automatic: t.format === 'auto',
      });
    }
  }
  const index = M.indexRecords(records),
    plain = (x) => JSON.stringify(x);
  for (const role of ['teacher', 'student'])
    for (let day = 0; day < 42; day++) {
      const at = start + day * M.DAY;
      assert.equal(
        plain(M.calendarRecords(tasks, records, at, role, index)),
        plain(old.calendarRecords(tasks, records, at, role)),
      );
      assert.equal(
        plain(M.calendarPending(tasks, records, at, index)),
        plain(old.calendarPending(tasks, records, at)),
      );
    }
  for (const t of tasks)
    for (const p of M.history(t, start + 30 * M.DAY)) {
      const prior = records
        .filter((r) => r.taskId === t.id && r.round === p.key)
        .sort((a, b) => a.completed - b.completed || a.id.localeCompare(b.id));
      assert.equal(plain(index.byRound.get(t.id + '|' + p.key) || []), plain(prior));
    }
  const timings = { records: records.length, days: 42 };
  for (const [name, fn] of [
    ['original', (d) => old.calendarRecords(tasks, records, start + d * M.DAY, 'teacher')],
    ['indexed', (d) => M.calendarRecords(tasks, records, start + d * M.DAY, 'teacher', index)],
  ]) {
    const a = performance.now();
    for (let n = 0; n < 10; n++) for (let d = 0; d < 42; d++) fn(d);
    timings[name + 'Ms'] = +(performance.now() - a).toFixed(2);
  }
  console.log(JSON.stringify({ calendarBenchmark: timings }));
});
test('运行时适配区验证缺失/重复，插入顺序和实际生成脚本有效', async () => {
  const { assembleRuntime, REQUIRED } = require('../runtime-builder.cjs');
  const source = REQUIRED.map(
    (name, i) =>
      '/* @runtime-begin ' + name + ' */ obsolete(' + i + '); /* @runtime-end ' + name + ' */',
  ).join('\n');
  await assert.rejects(
    assembleRuntime(
      source.replace('/* @runtime-begin storage */', '/* removed */'),
      async () => '',
    ),
    /缺少适配区/,
  );
  await assert.rejects(
    assembleRuntime(
      source + '\n/* @runtime-begin storage */x/* @runtime-end storage */',
      async () => '',
    ),
    /重复/,
  );
  const output = await assembleRuntime(
    source,
    async (name) => 'adapters.push(' + JSON.stringify(name) + ');',
  );
  const adapters = [];
  vm.runInNewContext(output, { adapters });
  assert.deepEqual(adapters, REQUIRED);
  assert.ok(!output.includes('obsolete('));
  assert.ok(!output.includes('@runtime-'));
  new vm.Script(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'cloud/public/index.html'), 'utf8');
  assert.equal(
    fs.readFileSync(path.join(root, 'styles.css'), 'utf8'),
    html.match(/<style>([\s\S]*?)<\/style>/)[1],
  );
});
