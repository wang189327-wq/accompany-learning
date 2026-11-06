'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  { createHash } = require('node:crypto');
const { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs');
async function fixture(format = 'text') {
  const mem = createMemory();
  let time = Date.parse('2026-10-27T02:00:00Z');
  const api = createService(mem.store, mem.objects, () => time);
  const task = await api.saveTask(
    {
      task: {
        id: 'release45',
        name: '2.3验收',
        subject: '数学',
        semester: '七年级上学期',
        kind: 'once',
        format,
        deadline: time + 86400000,
        enabled: true,
      },
    },
    'teacher',
  );
  const bytes = Buffer.from('完成内容'),
    u = await api.beginUpload(
      {
        taskId: task.id,
        kind: format,
        name: format === 'image' ? 'work.png' : 'work.txt',
        size: bytes.length,
        contentType: 'image/png',
      },
      'student',
    ),
    part = await api.uploadPart(u.uploadId, 1, bytes, 'student');
  await api.finishUpload(u.uploadId, { parts: [part] }, 'student');
  const record = await api.submit(
    {
      taskId: task.id,
      taskRevision: task.revision,
      round: '单次',
      requestId: 'submit-release45',
      selfScore: 8,
      uploadIds: [u.uploadId],
    },
    'student',
  );
  return { api, mem, record, advance: (ms) => (time += ms) };
}
test('增量同步省去历史文字OSS读取，保留消息自评分并检测新评分和点评', async () => {
  const f = await fixture();
  f.advance(2000);
  const first = await f.api.snapshot();
  f.advance(5000);
  let reads = 0;
  const get = f.mem.objects.get;
  f.mem.objects.get = async (k) => {
    reads++;
    return get(k);
  };
  const idle = await f.api.snapshot(first.serverTime);
  assert.equal(idle.recordsPartial, true);
  assert.equal(idle.records.length, 0);
  assert.equal(reads, 0);
  assert.match(idle.messages.find((m) => m.kind === 'completion').body, /8 \/ 10/);
  await f.api.grade({ taskId: f.record.taskId, round: '单次', score: 9, expected: 0 }, 'teacher');
  const graded = await f.api.snapshot(idle.serverTime);
  assert.equal(graded.records[0].teacherScore, 9);
  assert.equal(reads, 0);
  f.advance(5000);
  await f.api.reviewWorkerPoll({ workerId: 'release45-worker', ready: true });
  const job = await f.api.requestReview(
    { taskId: f.record.taskId, recordKey: f.record.recordKey, requestId: 'release45-review' },
    'teacher',
  );
  const claim = (await f.api.reviewWorkerPoll({ workerId: 'release45-worker', ready: true })).job;
  await f.api.reviewWorkerResult({
    workerId: claim.workerId,
    jobId: job.id,
    claim: claim.claim,
    text: '点评成功',
  });
  const reviewed = await f.api.snapshot(graded.serverTime);
  assert.equal(reviewed.records[0].aiReview.text, '点评成功');
  assert.equal(reviewed.records[0].teacherScore, 9);
});
test('历史图片在手动同步时续签链接，摘要避免重复OSS内容读取', async () => {
  const f = await fixture('image');
  const first = await f.api.snapshot();
  f.advance(360000);
  f.mem.objects.get = async () => {
    throw Error('不应重读OSS内容');
  };
  let signed = 0;
  f.mem.objects.url = async () => '/signed/' + ++signed;
  const delta = await f.api.snapshot(first.serverTime);
  assert.equal(delta.records[0].images[0].url, '/signed/1');
});
test('电脑重启后只补传落盘结果，HTTP批次接口可用，重复补传不调用模型', async () => {
  const f = await fixture(),
    workerId = 'release45-restart',
    token = 'user-' + 'a'.repeat(40),
    workerToken = 'worker-' + 'b'.repeat(40),
    { createServer } = require('../server.cjs'),
    fs = require('node:fs/promises'),
    path = require('node:path'),
    os = require('node:os'),
    worker = require('../../desktop-review/worker.cjs');
  await f.api.reviewWorkerPoll({ workerId, ready: true });
  await f.api.requestReview(
    { taskId: f.record.taskId, recordKey: f.record.recordKey, requestId: 'release45-restartjob' },
    'teacher',
  );
  const job = (await f.api.reviewWorkerPoll({ workerId, ready: true })).job,
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c9-release45-'));
  let modelCalls = 0;
  await worker.review(
    { ...job, text: '模拟作业' },
    { gateway: 'http://127.0.0.1:18789', gatewayToken: 'test', agent: 'test' },
    async () => {
      modelCalls++;
      return {
        ok: true,
        json: async () => ({ status: 'completed', output_text: '落盘后恢复的点评' }),
      };
    },
    async (part) =>
      worker.writeDurableBatch(dir, {
        ...part,
        workerId,
        jobId: job.id,
        claim: job.claim,
        taskId: job.taskId,
        recordKey: job.slot,
        generationId: job.id,
        sha256: createHash('sha256').update(part.text).digest('hex'),
      }),
  );
  assert.equal((await worker.readOutbox(dir)).length, 1);
  await assert.rejects(
    worker.flushOutbox(dir, { endpoint: 'http://offline', workerToken }, async () => {
      throw Error('断网');
    }),
  );
  assert.equal((await worker.readOutbox(dir)).length, 1);
  f.advance(360000);
  const server = createServer({
    token,
    workerToken,
    provider: () => f.mem,
    clock: () => Date.parse('2026-10-28T02:00:00Z'),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await worker.flushOutbox(dir, {
      endpoint: 'http://127.0.0.1:' + server.address().port,
      workerToken,
    });
    assert.equal((await worker.readOutbox(dir)).length, 0);
    assert.equal(modelCalls, 1);
    assert.equal((await f.api.snapshot()).records[0].aiReview.text, '落盘后恢复的点评');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test('点评批次补传幂等、校验、过期后恢复，旧代次不能覆盖新点评', async () => {
  const f = await fixture(),
    workerId = 'release45-worker';
  let puts = 0;
  const put = f.mem.objects.put;
  f.mem.objects.put = async (...args) => {
    puts++;
    return put(...args);
  };
  async function start(id) {
    await f.api.reviewWorkerPoll({ workerId, ready: true });
    await f.api.requestReview(
      { taskId: f.record.taskId, recordKey: f.record.recordKey, requestId: id },
      'teacher',
    );
    const job = (await f.api.reviewWorkerPoll({ workerId, ready: true })).job;
    return {
      workerId,
      jobId: job.id,
      claim: job.claim,
      generationId: job.id,
      taskId: f.record.taskId,
      recordKey: f.record.recordKey,
    };
  }
  const old = await start('release45-oldjob'),
    text = '第一批点评',
    sha256 = createHash('sha256').update(text).digest('hex'),
    batch = { ...old, batchIndex: 0, batchCount: 1, text, sha256 };
  await f.api.reviewWorkerBatch(batch);
  assert.equal((await f.api.reviewWorkerBatch(batch)).alreadySaved, true);
  await assert.rejects(
    f.api.reviewWorkerBatch({ ...batch, text: '被改动' }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    f.api.reviewWorkerBatch({ ...batch, claim: 'fake' }),
    (e) => e.status === 409,
  );
  f.advance(360000);
  await f.api.reviewWorkerResult({ ...old, batchCount: 1 });
  const count = puts;
  assert.equal((await f.api.reviewWorkerResult({ ...old, batchCount: 1 })).alreadySaved, true);
  assert.equal(puts, count);
  assert.equal((await f.api.snapshot()).records[0].aiReview.text, text);
  f.advance(1000);
  const cached = await f.api.requestReview(
    { taskId: f.record.taskId, recordKey: f.record.recordKey, requestId: 'release45-newjob' },
    'teacher',
  );
  assert.equal(cached.status, 'done');
  assert.equal((await f.api.reviewWorkerPoll({ workerId, ready: true })).job, null);
  await f.api.reviewWorkerResult({ ...old, batchCount: 1 });
  assert.equal((await f.api.snapshot()).records[0].aiReview.text, text);
});
