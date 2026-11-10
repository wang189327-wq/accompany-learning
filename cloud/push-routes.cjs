'use strict';
const crypto = require('node:crypto');
const { AppError } = require('./errors.cjs');
const { createPushService } = require('./push-service.cjs');
const { createPushTransport } = require('./push-rpc.cjs');
const { createService } = require('./core.cjs');
function authorized(req, token) {
  if (typeof token !== 'string' || token.length < 32 || /^(GENERATE_|REPLACE_)/.test(token))
    return false;
  if (!String(req.headers.authorization || '').startsWith('Bearer ')) return false;
  const incoming = Buffer.from(req.headers.authorization.slice(7));
  const expected = Buffer.from(token);
  return incoming.length === expected.length && crypto.timingSafeEqual(incoming, expected);
}
async function handlePushRoute(req, res, options, readBody) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!['/api/push/status', '/api/push/devices', '/api/push/dispatch'].includes(pathname))
    return false;
  const env = options.pushEnv || process.env;
  const job = pathname === '/api/push/dispatch';
  const token = job ? env.C9_PUSH_JOB_TOKEN : options.token || env.C9_ACCESS_TOKEN;
  if (!authorized(req, token)) throw new AppError(401, '推送接口认证失败');
  if (job && token === (options.token || env.C9_ACCESS_TOKEN))
    throw new AppError(503, '推送触发访问码必须独立配置');
  if (req.method !== (pathname.endsWith('/status') ? 'GET' : 'POST'))
    throw new AppError(405, '请求方法无效');
  const { store, objects } = options.provider(req);
  const transport = options.pushTransport || createPushTransport(env, req.headers);
  const service = createPushService(store, transport, options.clock || Date.now);
  let result;
  if (job) {
    if (!transport.configured) result = { configured: false, sent: 0, failed: 0 };
    else {
      const messages = await createService(
        store,
        objects,
        options.clock || Date.now,
      ).notificationMessages();
      result = await service.dispatch(messages);
    }
  } else if (pathname.endsWith('/status')) result = service.status();
  else {
    let body;
    try {
      body = JSON.parse((await readBody(req, 8192)).toString('utf8'));
    } catch {
      throw new AppError(400, '推送设备请求无效');
    }
    result = await service.bind(body, req.headers['x-c9-role']);
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(result));
  return true;
}
module.exports = { handlePushRoute };
