'use strict';
const { handlePushRoute } = require('./push-routes.cjs');
const http = require('node:http'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createService } = require('./core.cjs');
const { AppError, responseError } = require('./errors.cjs');
const { createStorageMonitor } = require('./storage-monitor.cjs');
const staticAssets = require('./static-assets.json');
const publicRoot = path.join(__dirname, 'public');
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0,
      chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AppError(413, '请求过大，请分段上传'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function authorized(req, token) {
  const raw = req.headers.authorization;
  const incoming = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const a = Buffer.from(incoming),
    b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createServer(options = {}) {
  const monitor = createStorageMonitor({
    thresholdGB: options.storageWarnGB ?? process.env.C9_STORAGE_WARN_GB ?? 1,
    clock: options.clock || Date.now,
  });
  const token = options.token || process.env.C9_ACCESS_TOKEN;
  if (!token || token.length < 32 || /^(GENERATE_|REPLACE_)/.test(token))
    throw Error('C9_ACCESS_TOKEN 至少需要 32 个字符，请配置自己的随机访问码，不要使用示例占位值');
  const provider = options.provider || ((req) => require('./aliyun.cjs').createAliyun(req));
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin,
      allowed = (process.env.C9_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-C9-Role');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(origin && !allowed.includes(origin) ? 403 : 204);
      res.end();
      return;
    }
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    try {
      if (await handlePushRoute(req, res, { ...options, provider, token }, readBody)) return;
      const url = new URL(req.url, 'http://localhost'),
        p = url.pathname;
      if (p === '/health') {
        send(200, {
          ok: true,
          service: 'Accompany Learning',
          version: '1.6.0',
          build: 1,
          features: {
            systemPush: true,
            storageMonitor: true,
            explicitErrors: true,
            generatedAssets: true,
            assignmentGroups: true,
            optionalGroupFields: true,
            snapshotOptimized: true,
            folderDelete: true,
            historyCleanup: true,
            disabledAutoCalendar: true,
            aiReview: true,
            studentAiReview: true,
            courseTasks: true,
            optionalTaskFields: true,
            fileSubmissions: true,
            onceAutoCheckin: true,
            library: true,
            semesters: true,
            studentTasks: true,
            calendar: true,
            roundPause: true,
            taskOrder: true,
            my: true,
            messages: true,
            notes: true,
            reminders: true,
            roundNotes: true,
            admissionColumns: true,
            taskSchedule: true,
            libraryDelete: true,
            goalExtras: true,
            tableEditing: true,
            customExamScore: true,
            repeatSubmissions: true,
            autoCheckin: true,
            studentWeekDays: true,
            optionalExam: true,
          },
          serverTime: Date.now(),
        });
        return;
      }
      if (!p.startsWith('/api/')) {
        const files = { ...staticAssets };
        if (/^\/pdf-(cmaps|fonts|wasm)\/[a-zA-Z0-9_.-]+$/.test(p) && !p.includes('..'))
          files[p] = p.slice(1);
        if (req.method !== 'GET' || !files[p]) throw new AppError(404, '页面不存在');
        const type = /\.m?js$/.test(p)
          ? 'application/javascript; charset=utf-8'
          : p.endsWith('.wasm')
            ? 'application/wasm'
            : p.includes('/pdf-')
              ? 'application/octet-stream'
              : 'text/html; charset=utf-8';
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; font-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https: data:; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
        res.writeHead(200, { 'Content-Type': type });
        res.end(await fs.readFile(path.join(publicRoot, files[p])));
        return;
      }
      const workerPath =
        p === '/api/ai/worker/poll' ||
        p === '/api/ai/worker/result' ||
        p === '/api/ai/worker/batch';
      if (workerPath) {
        const workerToken = options.workerToken || process.env.C9_AI_WORKER_TOKEN;
        if (
          !workerToken ||
          workerToken.length < 32 ||
          workerToken === token ||
          !authorized(req, workerToken)
        )
          throw new AppError(401, '电脑点评服务认证失败');
        const { store, objects } = provider(req),
          workerService = createService(store, objects, options.clock || Date.now);
        if (req.method !== 'POST') throw new AppError(405, '请求方法无效');
        let body;
        try {
          body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8'));
        } catch (e) {
          if (e instanceof AppError) throw e;
          throw new AppError(400, '点评请求内容无效');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new AppError(400, '点评请求内容无效');
        send(
          200,
          await (p.endsWith('/poll')
            ? workerService.reviewWorkerPoll(body)
            : p.endsWith('/batch')
              ? workerService.reviewWorkerBatch(body)
              : workerService.reviewWorkerResult(body)),
        );
        return;
      }
      if (!authorized(req, token)) throw new AppError(401, '访问码不正确，请重新配置连接');
      if (req.method === 'GET' && p === '/api/storage/status') {
        if (!['teacher', 'student'].includes(req.headers['x-c9-role']))
          throw new AppError(403, '请选择老师或学生身份');
        send(200, await monitor.status(() => provider(req).objects.bucketStats()));
        return;
      }
      const service = createService(
        ...(() => {
          const { store, objects } = provider(req);
          return [store, objects, options.clock || Date.now];
        })(),
      );
      const who = req.headers['x-c9-role'];
      if (req.method === 'GET' && p === '/api/check') {
        send(200, await service.check());
        return;
      }
      if (req.method === 'GET' && p === '/api/ai/review') {
        send(200, await service.reviewStatus(url.searchParams.get('jobId'), who));
        return;
      }
      if (req.method === 'GET' && p === '/api/widget') {
        send(200, await service.widgetSnapshot());
        return;
      }
      if (req.method === 'GET' && p === '/api/snapshot') {
        send(200, await service.snapshot(url.searchParams.get('since')));
        return;
      }
      const file = /^\/api\/files\/([-a-zA-Z0-9_]+)$/.exec(p);
      if (req.method === 'GET' && file) {
        const data = await service.file(file[1]);
        res.writeHead(200, {
          'Content-Type': data.contentType,
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(data.name),
          'Content-Security-Policy': "default-src 'none'; sandbox",
        });
        res.end(data.bytes);
        return;
      }
      const image = /^\/api\/images\/([-a-zA-Z0-9_]+)$/.exec(p);
      if (req.method === 'GET' && image) {
        const data = await service.image(image[1]);
        res.writeHead(200, {
          'Content-Type': data.contentType,
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(data.name),
          'Content-Security-Policy': "default-src 'none'; sandbox",
        });
        res.end(data.bytes);
        return;
      }
      if (req.method !== 'POST') throw new AppError(404, '接口不存在');
      const part = /^\/api\/uploads\/([-a-zA-Z0-9_]+)\/parts\/(\d+)$/.exec(p);
      if (part) {
        send(
          200,
          await service.uploadPart(
            part[1],
            Number(part[2]),
            await readBody(req, 4 * 1024 * 1024),
            who,
          ),
        );
        return;
      }
      let body;
      try {
        body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
      } catch (e) {
        if (e.status) throw e;
        throw new AppError(400, '请求内容无效');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new AppError(400, '请求内容无效');
      if (p === '/api/preferences/my') {
        send(200, await service.saveMyPreference(body, who));
        return;
      }
      if (p === '/api/messages/read') {
        send(200, await service.markMessagesRead(body, who));
        return;
      }
      if (p === '/api/preferences/order') {
        send(200, await service.saveTaskOrder(body, who));
        return;
      }
      if (p === '/api/tasks/weekdays') {
        send(200, await service.saveWeekDays(body, who));
        return;
      }
      if (p === '/api/tasks/round-note') {
        send(200, await service.saveRoundNote(body, who));
        return;
      }
      if (p === '/api/tasks/pause') {
        send(200, await service.pauseRound(body, who));
        return;
      }
      if (p === '/api/assignment-groups') {
        send(200, await service.publishAssignmentGroup(body, who));
        return;
      }
      if (p === '/api/tasks') {
        send(200, await service.saveTask(body, who));
        return;
      }
      if (p === '/api/uploads') {
        send(
          200,
          await (body.scope === 'library'
            ? service.beginLibraryUpload(body, who)
            : service.beginUpload(body, who)),
        );
        return;
      }
      if (p === '/api/library/delete') {
        send(200, await service.deleteLibrary(body, who));
        return;
      }
      if (p === '/api/library/save') {
        send(200, await service.saveLibrary(body, who));
        return;
      }
      const finish = /^\/api\/uploads\/([-a-zA-Z0-9_]+)\/complete$/.exec(p);
      if (finish) {
        send(200, await service.finishUpload(finish[1], body, who));
        return;
      }
      if (p === '/api/submissions') {
        send(200, await service.submit(body, who));
        return;
      }
      if (p === '/api/ai/review') {
        send(200, await service.requestReview(body, who));
        return;
      }
      if (p === '/api/grades') {
        send(200, await service.grade(body, who));
        return;
      }
      if (p === '/api/backup') {
        send(200, await service.backup(who));
        return;
      }
      throw new AppError(404, '接口不存在');
    } catch (e) {
      const failure = responseError(e);
      if (failure.status >= 500) console.error('C9 request failed:', e.code || e.name);
      send(failure.status, failure.body);
    }
  });
}
if (require.main === module) {
  const server = createServer();
  server.listen(
    Number(process.env.FC_CUSTOM_LISTEN_PORT || process.env.PORT || 9000),
    '0.0.0.0',
    () => console.log('C9 API is ready'),
  );
}
module.exports = { createServer };
