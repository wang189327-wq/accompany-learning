'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
test('云端界面分段上传、网络重试复用上传成果、访问码不进入URL', async () => {
  const calls = [],
    elements = new Map();
  const token = 'test-' + 'x'.repeat(40);
  let failSubmit = true;
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: get, addEventListener() {} },
    location: { protocol: 'https:', hostname: 'example.com', origin: 'https://example.com' },
    localStorage: { getItem: () => JSON.stringify({ endpoint: 'https://example.com', token }) },
    performance,
    Date,
    URL,
    Blob,
    AbortSignal,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/submissions') && failSubmit) {
        failSubmit = false;
        throw Error('network failure');
      }
      let value;
      if (url.endsWith('/api/uploads')) value = { uploadId: 'upload-1', chunkSize: 4 };
      else if (url.includes('/parts/'))
        value = { number: Number(url.split('/').at(-1)), etag: 'test-etag' };
      else if (url.endsWith('/complete')) value = { uploadId: 'upload-1' };
      else value = { id: 'task|单次', selfScore: 8, completed: 1000 };
      return { ok: true, json: async () => value };
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/attachment-cache.js'), 'utf8'),
    context,
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/cloud-client.js'), 'utf8'),
    context,
  );
  const Cloud = vm.runInContext('Cloud', context);
  await Cloud.connect();
  await vm.runInContext('Cloud.snapshot()', context);
  const record = {
      taskId: 'task',
      round: '单次',
      format: 'text',
      text: 'abcdefghij',
      selfScore: 8,
      images: [],
    },
    session = { requestId: 'request-1' };
  await assert.rejects(Cloud.submit(record, 1, session), /网络连接失败/);
  await Cloud.submit(record, 1, session);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/uploads')).length, 1);
  assert.equal(calls.filter((c) => c.url.includes('/parts/')).length, 3);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/submissions')).length, 2);
  for (const call of calls) {
    assert.ok(!call.url.includes(token));
    assert.equal(call.options.headers.Authorization, 'Bearer ' + token);
  }
  assert.equal(record.selfScore, 8);
  assert.equal(record.completed, 1000);
});
test('云端生成界面只使用网络读写并保留评分和任务分栏', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  new vm.Script(source);
  new vm.Script(fs.readFileSync(path.join(__dirname, '../public/cloud-client.js'), 'utf8'));
  assert.ok(/const\s+TEST_MODE\s*=\s*false/.test(source));
  assert.ok(source.includes('Cloud.snapshot()'));
  assert.ok(source.includes('Cloud.submit(record'));
  assert.ok(!source.includes('indexedDB.open('));
  assert.ok(/section\(\s*['"]未完成任务['"]/.test(source));
  assert.ok(/section\(\s*['"]已完成任务['"]/.test(source));
  assert.ok(source.includes('作业自评分：'));
  assert.ok(source.includes('老师评分：'));
  assert.ok(source.includes('提交作业'));
  assert.ok(!source.includes('学生端：提交后不可修改'));
  assert.ok(source.includes('StudyUI.page(tab)'));
});
test('手机本地预览不允许保存设置时，仍可成功连接；首次连接设置不依赖重新加载', async () => {
  const elements = new Map(),
    listeners = new Map();
  const get = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: '',
        textContent: '',
        open: false,
        addEventListener() {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
        querySelector() {
          return get('saveButton');
        },
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: get,
      addEventListener: (name, fn) => listeners.set(name, fn),
      dispatchEvent() {},
    },
    location: { protocol: 'file:', hostname: '', origin: 'null' },
    localStorage: {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('blocked');
      },
    },
    performance,
    Date,
    URL,
    Blob,
    AbortController,
    setTimeout,
    clearTimeout,
    Event,
    C9_DEFAULT_ENDPOINT: 'https://example.com',
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true, serverTime: 1000, tasks: [], records: [] }),
    }),
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/attachment-cache.js'), 'utf8'),
    context,
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../public/cloud-client.js'), 'utf8'),
    context,
  );
  const Cloud = vm.runInContext('Cloud', context);
  const connecting = Cloud.connect();
  assert.equal(get('apiEndpoint').value, 'https://example.com');
  get('connectionToken').value = 'test-' + 'x'.repeat(40);
  listeners.get('click')({ target: { closest: () => ({}) } });
  get('connectionToken').value = 'test-' + 'x'.repeat(40);
  await get('connectionForm').onsubmit({ preventDefault() {} });
  await connecting;
  assert.equal(Cloud.storageSaved, false);
  assert.equal(get('connectionDialog').open, false);
  assert.equal(get('saveButton').disabled, false);
  assert.equal((await Cloud.snapshot()).tasks.length, 0);
});
test('手机单文件无外部脚本，内置脚本语法完整且不包含访问码', () => {
  const file = fs.readFileSync(path.join(__dirname, '../release/伴学记录手机测试版.html'), 'utf8');
  assert.ok(!/<script\b[^>]*\bsrc=/i.test(file));
  const scripts = [...file.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 7);
  for (const script of scripts) new vm.Script(script[1]);
  assert.ok(!file.includes('正在加载本地数据'));
  assert.ok(file.includes('C9_DEFAULT_ENDPOINT'));
  const privatePath = path.join(__dirname, '../访问码.txt');
  if (fs.existsSync(privatePath))
    assert.ok(!file.includes(fs.readFileSync(privatePath, 'utf8').trim()));
});
