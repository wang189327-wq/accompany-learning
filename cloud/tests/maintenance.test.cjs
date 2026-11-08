'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { AppError, validate, responseError } = require('../errors.cjs');
const { createStorageMonitor } = require('../storage-monitor.cjs');
const { maintain, planLifecycle, empty } = require('../lifecycle-maintenance.cjs');
const OSS = require('ali-oss');
const parser = new OSS({
  region: 'oss-cn-hangzhou',
  bucket: 'c9-test-only',
  accessKeyId: 'fake',
  accessKeySecret: 'fake',
  secure: true,
});
const parse = (xml) => parser.parseXML(xml);

test('错误码只由明确类型决定，文案和SDK status不能伪造分类', () => {
  for (const message of ['请填写', '上传失败', 'arbitrary']) {
    assert.equal(responseError(new Error(message)).status, 500);
    assert.equal(responseError(new AppError(409, message)).body.code, 'CONFLICT');
  }
  assert.equal(
    responseError(Object.assign(new Error('private upstream'), { status: 403 })).status,
    500,
  );
  assert.throws(
    () =>
      validate(() => {
        throw Error('分数无效');
      }),
    (e) => e.status === 400 && e.code === 'VALIDATION_ERROR',
  );
  assert.equal(responseError(new AppError(413, 'too big')).body.code, 'PAYLOAD_TOO_LARGE');
});
test('1GB阈值边界、统计时间和查询复用；不限制上传', async () => {
  let time = 1000,
    reads = 0;
  const monitor = createStorageMonitor({ clock: () => time, ttl: 20 });
  const read = async () => {
    reads++;
    return {
      Storage: '1000000000',
      ObjectCount: '3',
      MultipartUploadCount: '2',
      LastModifiedTime: '7',
    };
  };
  const values = await Promise.all([monitor.status(read), monitor.status(read)]);
  assert.equal(reads, 1);
  assert.equal(values[0].exceeded, true);
  assert.equal(values[0].statisticsAt, 7000);
  assert.equal(values[0].uploadLimited, false);
  await monitor.status(read);
  assert.equal(reads, 1);
  time += 21;
  await monitor.status(read);
  assert.equal(reads, 2);
  const low = await createStorageMonitor().status(async () => ({
    Storage: 999999999,
    ObjectCount: 0,
    MultipartUploadCount: 0,
  }));
  assert.equal(low.exceeded, false);
});
test('读取容量失败或畸形统计明确不可用，不伪报0、不阻断其他功能', async () => {
  for (const read of [
    async () => {
      throw Error('AccessDenied secret');
    },
    async () => ({ Storage: 'invalid' }),
  ]) {
    const value = await createStorageMonitor().status(read);
    assert.equal(value.available, false);
    assert.equal(value.bytes, null);
    assert.equal(value.uploadLimited, false);
    assert.ok(!JSON.stringify(value).includes('secret'));
  }
  assert.throws(() => createStorageMonitor({ thresholdGB: 0 }));
});
test('生命周期合并只更新专用分片规则，已有对象/版本到期规则原样保留', async () => {
  const existing =
    '<Rule><ID>keep-old</ID><Prefix>history/</Prefix><Status>Enabled</Status><Expiration><Days>900</Days></Expiration><NoncurrentVersionExpiration><NoncurrentDays>90</NoncurrentDays></NoncurrentVersionExpiration></Rule>';
  const original = empty.replace(
    '</LifecycleConfiguration>',
    existing + '</LifecycleConfiguration>',
  );
  const plan = await planLifecycle(original, parse, 3);
  assert.ok(plan.xml.includes(existing));
  assert.equal(plan.kept.length, 1);
  const rules = (await parse(plan.xml)).Rule;
  assert.equal(rules.length, 3);
  assert.equal(rules[1].AbortMultipartUpload.Days, '3');
  assert.equal(rules[1].Expiration, undefined);
  assert.deepEqual(
    rules.slice(1).map((x) => x.Prefix),
    ['assets/', 'library-files/'],
  );
});
test('重叠分片规则、同名但包含删除动作或未知XML停止合并', async () => {
  for (const rule of [
    '<Rule><ID>other</ID><Prefix></Prefix><Status>Enabled</Status><AbortMultipartUpload><Days>30</Days></AbortMultipartUpload></Rule>',
    '<Rule><ID>c9-abort-incomplete-assets</ID><Prefix>assets/</Prefix><Status>Enabled</Status><Expiration><Days>1</Days></Expiration></Rule>',
  ])
    await assert.rejects(
      planLifecycle(
        empty.replace('</LifecycleConfiguration>', rule + '</LifecycleConfiguration>'),
        parse,
      ),
    );
  await assert.rejects(planLifecycle('<!DOCTYPE x>' + empty, parse));
});
test('生命周期默认预览不写云端；应用前并发变化停止；应用后验证保留旧规则', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'c9-maintenance-'));
  let xml = empty,
    puts = 0,
    gets = 0,
    change = false;
  const fake = {
    _bucketRequestParams: (method) => ({ method }),
    parseXML: parse,
    request: async (p) => {
      if (p.method === 'PUT') {
        puts++;
        xml = p.content;
        return { data: '' };
      }
      gets++;
      return {
        data:
          change && gets === 2
            ? empty.replace('</LifecycleConfiguration>', '\n</LifecycleConfiguration>')
            : xml,
      };
    },
  };
  try {
    const preview = await maintain(fake, 'fake', { backupDir: path.join(temp, 'preview') });
    assert.equal(preview.applied, false);
    assert.equal(puts, 0);
    gets = 0;
    change = true;
    await assert.rejects(
      maintain(fake, 'fake', { apply: true, backupDir: path.join(temp, 'changed') }),
      /改变/,
    );
    assert.equal(puts, 0);
    gets = 0;
    change = false;
    const applied = await maintain(fake, 'fake', {
      apply: true,
      backupDir: path.join(temp, 'apply'),
    });
    assert.equal(applied.applied, true);
    assert.equal(puts, 1);
    assert.equal(await fs.readFile(path.join(temp, 'apply/original-lifecycle.xml'), 'utf8'), empty);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('存储统计接口鉴权与明确错误响应；容量失败仍可正常读取快照', async () => {
  const { createServer } = require('../server.cjs'),
    { createMemory } = require('../memory.cjs');
  const memory = createMemory(),
    token = 'test-storage-status-12345678901234567890';
  memory.objects.bucketStats = async () => {
    throw Error('denied');
  };
  const server = createServer({ token, provider: () => memory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const unauthorized = await fetch(url + '/api/storage/status');
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).code, 'UNAUTHORIZED');
    const headers = { Authorization: 'Bearer ' + token, 'X-C9-Role': 'teacher' };
    const value = await (await fetch(url + '/api/storage/status', { headers })).json();
    assert.equal(value.available, false);
    assert.equal((await fetch(url + '/api/snapshot', { headers })).status, 200);
    const malformed = await fetch(url + '/api/tasks', {
      method: 'POST',
      headers,
      body: 'not json',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, 'INVALID_REQUEST');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
