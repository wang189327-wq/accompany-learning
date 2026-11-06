'use strict';
const http = require('node:http'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createService, AppError } = require('./core.cjs');
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
      const url = new URL(req.url, 'http://localhost'),
        p = url.pathname;
      if (p === '/health') {
        send(200, {
          ok: true,
          service: '伴学记录',
          version: '1.6.0',
          build: 56,
          features: {
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
        const files = {
          '/task-views.js': 'task-views.js',
          '/library-views.js': 'library-views.js',
          '/runtime-config.js': 'runtime-config.js',
          '/': 'index.html',
          '/index.html': 'index.html',
          '/app.js': 'app.js',
          '/model.js': 'model.js',
          '/cloud-client.js': 'cloud-client.js',
          '/startup-watch.js': 'startup-watch.js',
          '/study-model.js': 'study-model.js',
          '/study-ui.js': 'study-ui.js',
          '/assignment-groups.js': 'assignment-groups.js',
          '/assignment-groups-ui.js': 'assignment-groups-ui.js',
          '/task-order.js': 'task-order.js',
          '/image-zoom.js': 'image-zoom.js',
          '/file-viewer.js': 'file-viewer.js',
          '/zip-reader.js': 'zip-reader.js',
          '/docx-reader.js': 'docx-reader.js',
          '/my-model.js': 'my-model.js',
          '/my-page.js': 'my-page.js',
          '/font-settings.js': 'font-settings.js',
          '/background-settings.js': 'background-settings.js',
          '/pull-refresh.js': 'pull-refresh.js',
          '/pdf.mjs': 'pdf.mjs',
          '/pdf.worker.mjs': 'pdf.worker.mjs',
        };
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
        } catch {
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
      const status =
        e.status ||
        (/请选择|请填写|任务类型无效|提交形式无效|本轮|上传|截止时间/.test(e.message) ? 400 : 500);
      if (status >= 500) console.error('C9 request failed:', e.code || e.name);
      send(status, {
        error:
          status >= 500 && !(e instanceof AppError)
            ? '云端连接失败，请检查函数配置和访问权限'
            : e.message,
      });
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
