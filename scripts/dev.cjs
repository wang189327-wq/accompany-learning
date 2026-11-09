'use strict';
(async () => {
  await require('../cloud/build.cjs').build();
  const { randomBytes } = require('node:crypto'),
    { createMemory } = require('../cloud/memory.cjs'),
    { createServer } = require('../cloud/server.cjs');
  const memory = createMemory(),
    token = randomBytes(32).toString('hex'),
    port = Number(process.env.PORT || 9000),
    server = createServer({ token, provider: () => memory });
  server.listen(port, '127.0.0.1', () => {
    console.log('Accompany Learning本机演示：http://127.0.0.1:' + port);
    console.log('临时访问码（仅本次进程有效）：' + token);
    console.log('使用内存存储，停止程序后演示数据清空。正式使用请部署云端。');
  });
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
