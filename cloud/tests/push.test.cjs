'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemory } = require('../memory.cjs');
const { createPushService } = require('../push-service.cjs');
test('device role binding, duplicate delivery, disable and retries', async () => {
  const { store } = createMemory();
  let now = 100000,
    calls = 0,
    fail = false;
  const transport = {
    configured: true,
    applications: ['app.accompany.learning'],
    async send() {
      calls++;
      if (fail) throw Error('offline');
    },
  };
  const push = createPushService(store, transport, () => now);
  const body = {
    installationId: 'a'.repeat(32),
    bindingSecret: 'b'.repeat(32),
    applicationId: 'app.accompany.learning',
    deviceId: 'test-device-123',
    enabled: true,
  };
  await push.bind(body, 'teacher');
  const message = {
    id: 'one',
    targetRole: 'teacher',
    title: '作业提交',
    created: now,
    taskId: 'x',
  };
  assert.equal((await push.dispatch([message, message])).sent, 1);
  assert.equal(calls, 1);
  await push.bind(body, 'student');
  assert.equal((await push.dispatch([{ ...message, id: 'two' }])).sent, 0);
  const student = { ...message, id: 'three', targetRole: 'student' };
  fail = true;
  assert.equal((await push.dispatch([student])).failed, 1);
  fail = false;
  assert.equal((await push.dispatch([student])).sent, 0);
  now += 61000;
  assert.equal((await push.dispatch([student])).sent, 1);
  await push.bind({ ...body, enabled: false }, 'student');
  assert.equal((await push.dispatch([{ ...student, id: 'four', created: now }])).sent, 0);
  await assert.rejects(push.bind({ ...body, bindingSecret: 'c'.repeat(32) }, 'student'), {
    status: 403,
  });
});
test('new device never receives pre-registration history', async () => {
  const { store } = createMemory();
  let count = 0;
  const push = createPushService(
    store,
    {
      configured: true,
      applications: ['app.accompany.learning'],
      async send() {
        count++;
      },
    },
    () => 200000,
  );
  await push.bind(
    {
      installationId: '1'.repeat(32),
      bindingSecret: '2'.repeat(32),
      applicationId: 'app.accompany.learning',
      deviceId: 'device-1111',
    },
    'student',
  );
  await push.dispatch([{ id: 'old', title: 'old', targetRole: 'student', created: 1000 }]);
  assert.equal(count, 0);
});
test('push HTTP routes separate scheduler credential from user credential', async (t) => {
  const { createServer } = require('../server.cjs');
  const memory = createMemory();
  const token = 'a'.repeat(40),
    job = 'b'.repeat(40);
  const server = createServer({
    token,
    provider: () => memory,
    pushEnv: { C9_PUSH_JOB_TOKEN: job },
    pushTransport: { configured: true, applications: ['app.accompany.learning'], async send() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(url + '/api/push/status')).status, 401);
  assert.equal(
    (
      await fetch(url + '/api/push/dispatch', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      })
    ).status,
    401,
  );
  const status = await fetch(url + '/api/push/status', {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.deepEqual(await status.json(), {
    configured: true,
    applications: ['app.accompany.learning'],
  });
  const dispatched = await fetch(url + '/api/push/dispatch', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + job },
  });
  assert.equal(dispatched.status, 200);
  assert.equal((await dispatched.json()).sent, 0);
});
test('Aliyun RPC uses server credential and matching vendor notification channel', async () => {
  const { createPushTransport } = require('../push-rpc.cjs');
  let params;
  const transport = createPushTransport(
    {
      C9_PUSH_APPS: '{"app.accompany.learning":"123"}',
      C9_PUSH_ACCESS_KEY_ID: 'server-key',
      C9_PUSH_ACCESS_KEY_SECRET: 'server-secret',
      C9_PUSH_VIVO_TEST: 'true',
    },
    {},
    async (url, options) => {
      assert.equal(url, 'https://cloudpush.aliyuncs.com/');
      params = options.body;
      return {
        ok: true,
        async json() {
          return { MessageId: 'accepted-1' };
        },
      };
    },
  );
  await transport.send(
    { applicationId: 'app.accompany.learning', deviceId: 'device-1', role: 'student' },
    { id: 'm1', title: '发布作业', taskId: 't1' },
  );
  assert.equal(params.get('AndroidNotificationChannel'), 'c9_messages');
  assert.equal(params.get('AndroidVivoPushMode'), '1');
  assert.equal(params.get('AppKey'), '123');
  assert.ok(params.get('Signature'));
  assert.equal(params.get('AccessKeySecret'), null);
  assert.equal(params.get('Body'), '你有一条新的作业消息，点击查看');
  assert.throws(
    () => createPushTransport({ C9_PUSH_APPS: '{"app.accompany.learning":123}' }),
    /quoted decimal/,
  );
  assert.throws(() => createPushTransport({ C9_PUSH_APPS: '[]' }), /quoted decimal/);
});
test('example scheduler credentials cannot activate the dispatch route', async (t) => {
  const { createServer } = require('../server.cjs');
  const token = 'GENERATE_SEPARATE_RANDOM_32_CHAR_TOKEN';
  const server = createServer({
    token: 'x'.repeat(40),
    provider: () => createMemory(),
    pushEnv: { C9_PUSH_JOB_TOKEN: token },
    pushTransport: { configured: true, applications: [], async send() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/push/dispatch', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(response.status, 401);
});
