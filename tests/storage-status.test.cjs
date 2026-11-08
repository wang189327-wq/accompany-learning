'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const vm = require('node:vm'),
  fs = require('node:fs'),
  path = require('node:path');
const tick = () => new Promise((r) => setImmediate(r));
test('容量提醒显示阈值但不显示上传限制；读取失败不伪报零', async () => {
  const box = { textContent: '', hidden: true, style: {} };
  let scope = 'first',
    calls = 0;
  const context = vm.createContext({
    Date,
    document: { getElementById: () => box },
    Cloud: {
      storageScope: () => scope,
      request: async () => {
        calls++;
        return scope === 'first'
          ? {
              available: true,
              bytes: 1000000000,
              thresholdBytes: 1000000000,
              exceeded: true,
              statisticsAt: 1000,
            }
          : { available: false, message: '暂时无法读取容量' };
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../storage-status.js'), 'utf8'), context);
  vm.runInContext("StorageStatus.mount('teacher')", context);
  await tick();
  assert.match(box.textContent, /已达到提醒值，不限制上传/);
  assert.match(box.textContent, /统计非实时/);
  assert.equal(calls, 1);
  vm.runInContext("StorageStatus.mount('teacher')", context);
  await tick();
  assert.equal(calls, 1);
  scope = 'second';
  vm.runInContext("StorageStatus.mount('student')", context);
  await tick();
  assert.match(box.textContent, /暂时无法读取/);
  assert.ok(!box.textContent.includes('0.00'));
});
