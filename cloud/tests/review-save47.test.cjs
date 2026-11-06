'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { createMemory } = require('../memory.cjs'),
  { createService } = require('../core.cjs'),
  { createServer } = require('../server.cjs'),
  worker = require('../../desktop-review/worker.cjs');
async function fixture() {
  const mem = createMemory(),
    api = createService(mem.store, mem.objects);
  let task = await api.saveTask(
    {
      task: {
        id: 'save47',
        name: '点评保存回归',
        subject: '数学',
        semester: '七年级上学期',
        kind: 'recurring',
        rule: 'week',
        format: 'text',
        enabled: true,
      },
    },
    'teacher',
  );
  async function submit(id) {
    task = (await api.snapshot()).tasks[0];
    const bytes = Buffer.from('模拟作业'),
      u = await api.beginUpload(
        { taskId: task.id, kind: 'text', size: bytes.length, name: 'test.txt' },
        'student',
      ),
      part = await api.uploadPart(u.uploadId, 1, bytes, 'student');
    await api.finishUpload(u.uploadId, { parts: [part] }, 'student');
    return api.submit(
      {
        taskId: task.id,
        taskRevision: task.revision,
        round: globalThis.TaskModel.period(task, Date.now()).key,
        requestId: id,
        selfScore: 8,
        uploadIds: [u.uploadId],
      },
      'student',
    );
  }
  return { mem, api, submit };
}
test('真实电脑worker领取slot字段后完整保存，重复点击不再调用模型，补交可独立点评', async () => {
  const f = await fixture(),
    record = await f.submit('first-submit-47'),
    userToken = 'user-' + 'a'.repeat(40),
    workerToken = 'worker-' + 'b'.repeat(40),
    controller = new AbortController();
  let modelCalls = 0,
    savedKey;
  await f.api.reviewWorkerPoll({ workerId: 'test47-preready', ready: true });
  await f.api.requestReview(
    { taskId: record.taskId, recordKey: record.recordKey, requestId: 'review-request-47' },
    'teacher',
  );
  const server = createServer({ token: userToken, workerToken, provider: () => f.mem });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c9-save47-')),
    endpoint = 'http://127.0.0.1:' + server.address().port;
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await worker.run(
      {
        test: true,
        endpoint,
        gateway: 'http://127.0.0.1:18789',
        workerToken,
        gatewayToken: 'test',
      },
      {
        signal: controller.signal,
        pollMs: 5,
        outboxDir: dir,
        request: async (url, options) => {
          if (url.endsWith('/v1/models')) return { ok: true, json: async () => ({ data: [] }) };
          if (url.endsWith('/v1/responses')) {
            modelCalls++;
            return {
              ok: true,
              json: async () => ({ status: 'completed', output_text: '保存到正确提交的点评' }),
            };
          }
          if (url.endsWith('/batch')) savedKey = JSON.parse(options.body).recordKey;
          const response = await fetch(url, options);
          if (url.endsWith('/result') && response.ok) controller.abort();
          return response;
        },
      },
    );
  } finally {
    clearTimeout(timer);
    await new Promise((r) => server.close(r));
  }
  assert.equal(modelCalls, 1);
  assert.equal(savedKey, record.recordKey);
  assert.equal((await worker.readOutbox(dir)).length, 0);
  const snapshot = await f.api.snapshot();
  assert.equal(
    snapshot.records.find((x) => x.id === record.id).aiReview.text,
    '保存到正确提交的点评',
  );
  const again = await f.api.requestReview(
    { taskId: record.taskId, recordKey: record.recordKey, requestId: 'again-request-47' },
    'student',
  );
  assert.equal(again.status, 'done');
  assert.equal((await f.api.reviewStatus(again.id, 'teacher')).review.text, '保存到正确提交的点评');
  assert.equal(
    (await f.api.reviewWorkerPoll({ workerId: 'test47-idleworker', ready: true })).job,
    null,
  );
  const next = await f.submit('second-submit-47');
  assert.notEqual(next.recordKey, record.recordKey);
  const nextJob = await f.api.requestReview(
    { taskId: next.taskId, recordKey: next.recordKey, requestId: 'second-review-47' },
    'teacher',
  );
  assert.equal(nextJob.status, 'waiting');
  const waitingAgain = await f.api.requestReview(
    { taskId: next.taskId, recordKey: next.recordKey, requestId: 'duplicate-click-47' },
    'student',
  );
  assert.equal(waitingAgain.id, nextJob.id);
});
