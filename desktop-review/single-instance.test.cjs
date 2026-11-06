'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http'),
  { spawn } = require('node:child_process');
test('重复点击两个启动入口只运行一份电脑服务', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c9-single-instance-')),
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url === '/v1/models' ? { data: [] } : { ok: true, job: null }));
    });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = 'http://127.0.0.1:' + server.address().port,
    config = path.join(dir, 'config.json');
  await fs.writeFile(
    config,
    JSON.stringify({
      test: true,
      endpoint,
      gateway: endpoint,
      workerToken: 'test-' + 'x'.repeat(40),
      gatewayToken: 'test',
    }),
  );
  const env = {
    ...process.env,
    USERPROFILE: dir,
    HOME: dir,
    LOCALAPPDATA: path.join(dir, 'Local'),
    C9_REVIEW_CONFIG: config,
  };
  let first, second;
  try {
    first = spawn(process.execPath, [path.join(__dirname, 'worker.cjs')], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let firstLog = '';
    first.stdout.on('data', (b) => (firstLog += b));
    const until = Date.now() + 5000;
    while (!firstLog.includes('点评服务在线') && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.match(firstLog, /点评服务在线/);
    second = spawn(process.execPath, [path.join(__dirname, 'worker.cjs')], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let secondLog = '';
    second.stdout.on('data', (b) => (secondLog += b));
    const exited = await Promise.race([
      new Promise((r) => second.on('exit', r)),
      new Promise((_, reject) => setTimeout(() => reject(Error('重复入口未退出')), 2500).unref()),
    ]);
    assert.equal(exited, 0);
    assert.match(secondLog, /已经运行/);
    assert.equal(first.exitCode, null);
  } finally {
    for (const child of [second, first])
      if (child && child.exitCode === null) {
        const exited = new Promise((r) => child.once('exit', r));
        child.kill();
        await exited;
      }
    await new Promise((r) => server.close(r));
  }
});
