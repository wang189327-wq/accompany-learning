'use strict';
const { randomUUID, createHash } = require('node:crypto');
require('./model.js');
const M = globalThis.TaskModel;
const S = require('./study-model.js');
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new AppError(status, message);
};
const TEXT_CACHE_LIMIT = 64 * 1024;
function id(value) {
  if (typeof value !== 'string' || !/^[-a-zA-Z0-9_]{1,100}$/.test(value)) fail(400, '编号无效');
  return value;
}
function round(value) {
  if (value !== '单次' && !/^\d{4}-(?:W\d{2}|\d{2}(?:-\d{2})?)$/.test(value)) fail(400, '轮次无效');
  return value;
}
function role(value, wanted) {
  if (value !== wanted)
    fail(403, wanted === 'teacher' ? '此操作仅供老师使用' : '此操作仅供学生使用');
}
function visibleTask(task) {
  const { _rounds, _events, ...publicTask } = task;
  return { ...publicTask, requiresTeaching: publicTask.requiresTeaching === true };
}
// Bound record I/O per snapshot without changing input/output order. Drain all
// active operations before propagating an error (no detached migration writes).
async function mapRecords(values, fn) {
  const results = new Array(values.length);
  let next = 0,
    failed = false,
    error;
  const workers = Array.from({ length: Math.min(6, values.length) }, async () => {
    while (!failed) {
      const index = next++;
      if (index >= values.length) break;
      try {
        results[index] = await fn(values[index], index);
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    }
  });
  await Promise.all(workers);
  if (failed) throw error;
  return results;
}
function createService(store, objects, clock = Date.now) {
  const reviews = require('./ai-review.cjs').createReviews(
    store,
    objects,
    clock,
    fail,
    async (taskId, slot) => {
      const task = await taskGet(taskId);
      if (typeof slot !== 'string' || slot.length > 180 || !task._rounds?.[slot])
        fail(404, '提交记录不存在');
      return { task, record: await materialize(task, slot) };
    },
  );
  const extras = require('./extras.cjs').createExtras(store, objects, clock, M, fail);
  const assignmentGroups = require('./assignment-groups.cjs').createAssignmentGroups(
    store,
    clock,
    M,
    fail,
  );
  function libraryRole(who) {
    if (!['student', 'teacher'].includes(who)) fail(403, '请选择学生或老师身份');
  }
  function uploadRole(meta, who) {
    if (meta.scope === 'library') libraryRole(who);
    else role(who, 'student');
  }
  async function libraryList() {
    const all = store.listLibrary ? (await store.listLibrary()).filter((x) => !x.deletedAt) : [],
      dirs = new Set(all.filter((x) => x.type === 'folder').map((x) => x.id));
    return all.map((x) => (x.folderId && !dirs.has(x.folderId) ? { ...x, folderId: null } : x));
  }
  async function libraryExpanded(entry) {
    if (entry.type === 'folder') return entry;
    const files = [];
    for (const file of entry.files) files.push({ ...file, url: await objects.url(file.key) });
    return { ...entry, files };
  }
  async function taskGet(taskId) {
    const t = await store.getTask(id(taskId));
    if (!t) fail(404, '作业不存在');
    return t;
  }
  async function materialize(task, roundKey, knownMeta = undefined) {
    const ref = task._rounds?.[roundKey];
    if (!ref) fail(404, '本轮尚未提交');
    let meta = knownMeta === undefined ? await store.getRecord(task.id, roundKey) : knownMeta,
      payload = meta?.summary;
    if (!payload) {
      payload = JSON.parse((await objects.get(ref.key)).toString('utf8'));
      if (payload.textKey) {
        const text = await objects.get(payload.textKey);
        if (text.length <= TEXT_CACHE_LIMIT)
          payload = { ...payload, cachedText: text.toString('utf8') };
      }
      const next = {
        ...(meta || {
          taskId: task.id,
          round: roundKey,
          payloadKey: ref.key,
          teacherScore: null,
          gradeRevision: 0,
        }),
        summary: payload,
      };
      try {
        await store.putRecord(next, meta?.gradeRevision ?? null);
        meta = next;
      } catch (e) {
        if (e.status !== 409) throw e;
        meta = await store.getRecord(task.id, roundKey);
        if (!meta?.summary) throw e;
        payload = meta.summary;
      }
    }
    return {
      ...payload,
      id: task.id + '|' + roundKey,
      recordKey: roundKey,
      completed: ref.completed,
      late: ref.late,
      teacherScore: meta.teacherScore,
      gradeRevision: meta.gradeRevision,
      gradedAt: meta.gradedAt || null,
      aiReview: await reviews.getReview(task.id, roundKey, meta),
    };
  }
  async function expanded(record) {
    const text =
      typeof record.cachedText === 'string'
        ? record.cachedText
        : record.textKey
          ? (await objects.get(record.textKey)).toString('utf8')
          : '';
    const images = [];
    for (const im of record.images)
      images.push({
        ...im,
        url: await objects.url(im.key),
        ...(objects.thumbnailURL
          ? { thumbnailUrl: await objects.thumbnailURL(im.key, im.name) }
          : {}),
      });
    const { textKey, requestId, cachedText, ...rest } = record;
    return { ...rest, text, images };
  }
  async function automatic(tasks = undefined) {
    tasks = tasks || (await store.listTasks());
    for (const [index, initial] of tasks.entries()) {
      let task = initial;
      for (let attempt = 0; attempt < 4; attempt++) {
        const dates = (
          task.kind === 'once' && Object.keys(task._rounds || {}).length
            ? []
            : M.autoDates(task, clock())
        ).filter((d) => !Object.values(task._rounds || {}).some((r) => r.autoDate === d.date));
        if (!dates.length) break;
        const refs = { ...task._rounds };
        for (const d of dates) {
          const slot = refs[d.round] ? d.round + '~auto' + d.date.replaceAll('-', '') : d.round,
            keyPrefix = 'submissions/' + task.id + '/auto-' + d.date;
          const payload = {
            taskId: task.id,
            taskName: task.name,
            subject: task.subject,
            semester: task.semester,
            kind: task.kind,
            format: 'auto',
            automatic: true,
            round: d.round,
            start: d.start,
            end: d.end,
            images: [],
            textKey: null,
            selfScore: null,
          };
          const key =
            keyPrefix +
            '-' +
            createHash('sha256').update(JSON.stringify(payload)).digest('hex') +
            '.json';
          await objects.put(key, Buffer.from(JSON.stringify(payload)), 'application/json');
          refs[slot] = {
            key,
            completed: d.completed,
            late: false,
            autoDate: d.date,
            notify: false,
          };
        }
        const next = { ...task, _rounds: refs, revision: task.revision + 1 };
        try {
          await store.putTask(next, task.revision);
          task = next;
          break;
        } catch (e) {
          if (e.status !== 409 || attempt === 3) throw e;
          task = await taskGet(task.id);
        }
      }
      tasks[index] = task;
    }
    return tasks;
  }
  async function uploadGet(uploadId) {
    const key = 'uploads/' + id(uploadId) + '.json';
    let body;
    try {
      body = await objects.get(key);
    } catch (e) {
      if (e.status === 404) fail(404, '上传记录不存在');
      throw e;
    }
    return JSON.parse(body.toString('utf8'));
  }
  async function cleanupTests(tasks) {
    for (const [index, original] of tasks.entries()) {
      if (!M.historyHidden(original) || original.historyPurged) continue;
      const key = 'backups/v3-test-history/' + original.id + '.json';
      await objects.put(
        key,
        Buffer.from(
          JSON.stringify({
            task: original,
            archivedAt: clock(),
            reason: '用户要求移除测试作业历史',
          }),
        ),
        'application/json',
      );
      const current = await store.getTask(original.id);
      tasks[index] = current;
      if (!current || current.historyPurged || current.revision !== original.revision) continue;
      const next = {
        ...current,
        historyPurged: true,
        deletedAt: current.deletedAt || clock(),
        enabled: false,
        revision: current.revision + 1,
      };
      try {
        await store.putTask(next, current.revision);
        tasks[index] = next;
      } catch (e) {
        if (e.status !== 409) throw e;
        tasks[index] = await store.getTask(current.id);
      }
    }
    return tasks.filter(Boolean);
  }
  async function migrateLegacy(ts) {
    const ls = await libraryList();
    const oldTasks = ts.filter((t) => t.semester == null || !t.createdBy),
      oldEntries = ls.filter((e) => e.type !== 'exam' && !e.semesters);
    if (!oldTasks.length && !oldEntries.length) return { tasks: ts, library: ls };
    const rs = await mapRecords(
      ts.flatMap((t) => Object.keys(t._rounds || {}).map((key) => ({ t, key }))),
      ({ t, key }) => materialize(t, key),
    );
    const backupKey =
      'backups/upgrade-v1.3.0-' +
      new Date(clock()).toISOString().replace(/[:.]/g, '-') +
      '-' +
      randomUUID() +
      '.json';
    await objects.put(
      backupKey,
      Buffer.from(
        JSON.stringify({ version: 3, created: clock(), tasks: ts, records: rs, library: ls }),
      ),
      'application/json',
    );
    const positions = new Map(ts.map((t, i) => [t.id, i]));
    for (const t of oldTasks) {
      const index = positions.get(t.id),
        current = await store.getTask(t.id);
      ts[index] = current;
      if (!current || (current.semester != null && current.createdBy)) continue;
      const next = {
        ...current,
        semester: current.semester ?? '七年级上学期',
        createdBy: current.createdBy || 'teacher',
        revision: current.revision + 1,
      };
      try {
        await store.putTask(next, current.revision);
        ts[index] = next;
      } catch (e) {
        if (e.status !== 409) throw e;
        ts[index] = await store.getTask(t.id);
      }
    }
    for (const e of oldEntries) {
      const current = await store.getLibrary(e.id);
      if (!current || current.semesters) continue;
      try {
        await store.putLibrary(
          { ...current, semesters: ['七年级上学期'], revision: current.revision + 1 },
          current.revision,
        );
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    }
    return { tasks: ts.filter(Boolean), library: oldEntries.length ? await libraryList() : ls };
  }
  const taskService = require('./task-service.cjs').createTaskService({
    store,
    clock,
    M,
    extras,
    assignmentGroups,
    taskGet,
    visibleTask,
    libraryRole,
    id,
    round,
    role,
    fail,
  });
  return {
    ...taskService,
    publishAssignmentGroup: assignmentGroups.publish,
    requestReview: reviews.requestReview,
    reviewStatus: reviews.reviewStatus,
    reviewWorkerPoll: reviews.workerPoll,
    reviewWorkerResult: reviews.workerResult,
    reviewWorkerBatch: reviews.workerBatch,
    saveMyPreference: extras.savePreference,
    markMessagesRead: extras.markRead,
    async check() {
      await store.listTasks();
      await store.getRecord('__c9_check__', 'check');
      const bytes = Buffer.from('C9 connectivity check');
      await objects.put('system/connectivity.txt', bytes, 'text/plain');
      if (!(await objects.get('system/connectivity.txt')).equals(bytes))
        fail(503, '文件存储校验失败');
      return { ok: true, serverTime: clock() };
    },
    async backup(who) {
      role(who, 'teacher');
      const ts = await store.listTasks(),
        rs = [];
      for (const task of ts)
        for (const key of Object.keys(task._rounds || {})) rs.push(await materialize(task, key));
      const backupKey =
        'backups/' +
        new Date(clock()).toISOString().replace(/[:.]/g, '-') +
        '-' +
        randomUUID() +
        '.json';
      await objects.put(
        backupKey,
        Buffer.from(
          JSON.stringify({
            version: 4,
            my: await extras.backup(),
            created: clock(),
            tasks: ts,
            assignmentGroups: await assignmentGroups.list(),
            records: rs,
            library: await libraryList(),
            taskOrders: await Promise.all(
              ['student', 'teacher'].map((w) => store.getRecord('__c9_prefs__', w)),
            ),
          }),
        ),
        'application/json',
      );
      return { ok: true, backupKey };
    },
    async snapshot(sinceValue) {
      const cleaned = await cleanupTests(await store.listTasks()),
        migrated = await migrateLegacy(cleaned);
      const allTasks = await extras.remind(await automatic(migrated.tasks));
      const ts = allTasks.filter((t) => !M.historyHidden(t)),
        time = clock(),
        candidate = Number(sinceValue),
        since =
          Number.isSafeInteger(candidate) && candidate > 0 && candidate < time + 1000
            ? candidate
            : null;
      const rows = await mapRecords(
        ts.flatMap((t) => Object.entries(t._rounds || {}).map(([r, ref]) => ({ t, r, ref }))),
        async ({ t, r, ref }) => {
          let meta,
            changed = since === null || ref.completed >= since - 1000;
          if (since !== null) {
            meta = await store.getRecord(t.id, r);
            changed =
              changed ||
              !meta?.summary ||
              (meta?.gradedAt || 0) >= since - 1000 ||
              (meta?.reviewUpdatedAt || 0) >= since - 1000;
          }
          if (changed || meta?.summary?.images?.length) {
            const record = await expanded(await materialize(t, r, meta));
            return { record, message: record };
          }
          return { message: meta?.summary ? { ...meta.summary, recordKey: r } : null };
        },
      );
      const rs = rows.filter((x) => x.record).map((x) => x.record),
        messageRecords = rows.filter((x) => x.message).map((x) => x.message),
        taskOrders = {};
      const orderValues = await Promise.all(
        ['student', 'teacher'].map((who) => store.getRecord('__c9_prefs__', who)),
      );
      for (const [index, who] of ['student', 'teacher'].entries()) {
        const pref = orderValues[index];
        if (pref) taskOrders[who] = { ids: pref.ids, revision: pref.gradeRevision };
      }
      return {
        ...(await extras.snapshot(ts, messageRecords)),
        taskOrders,
        assignmentGroups: await assignmentGroups.list(),
        tasks: ts.map(visibleTask),
        records: rs,
        recordsPartial: since !== null,
        library: await Promise.all(migrated.library.map(libraryExpanded)),
        features: {
          assignmentGroups: true,
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
        serverTime: time,
      };
    },

    async widgetSnapshot() {
      const ts = (await automatic()).filter((t) => !M.historyHidden(t)),
        records = await mapRecords(
          ts.flatMap((t) => Object.keys(t._rounds || {}).map((key) => ({ t, key }))),
          async ({ t, key }) => {
            const r = await materialize(t, key);
            return {
              taskId: r.taskId,
              taskName: r.taskName,
              round: r.round,
              completed: r.completed,
              late: r.late,
            };
          },
        );
      return { tasks: ts.map(visibleTask), records, serverTime: clock() };
    },

    async deleteLibrary(body, who) {
      libraryRole(who);
      const old = await store.getLibrary(id(body.id));
      if (!old || old.deletedAt) fail(404, '资料不存在或已删除');
      if (!['material', 'exam', 'folder'].includes(old.type)) fail(400, '资料类型无效');
      if (old.revision !== body.expected) fail(409, '资料已变更，请刷新后重试');
      await store.putLibrary(
        { ...old, deletedAt: clock(), revision: old.revision + 1 },
        old.revision,
      );
      return { ok: true };
    },
    async saveLibrary(body, who) {
      libraryRole(who);
      let value;
      try {
        value = S.validate(body.entry);
      } catch (e) {
        fail(400, e.message);
      }
      id(value.id);
      const old = await store.getLibrary(value.id);
      if (value.type === 'exam' && old && body.entry.gradeRank === undefined)
        value.gradeRank = old.gradeRank ?? null;
      if (old?.deletedAt) fail(409, '资料已删除，不能重新保存');
      if (old && old.type !== value.type) fail(409, '资料类型不能修改');
      if (old ? old.revision !== body.expected : body.expected != null)
        fail(409, '资料已变更，请刷新后重试');
      if (value.type === 'folder' && old && old.scope !== value.scope)
        fail(409, '文件夹位置不能修改');
      if (value.folderId) {
        const folder = await store.getLibrary(id(value.folderId));
        if (
          !folder ||
          folder.deletedAt ||
          folder.type !== 'folder' ||
          folder.scope !== (value.type === 'exam' ? 'exams' : 'materials')
        )
          fail(400, '文件夹不存在或属于其他页面');
      }
      if (value.type !== 'folder') {
        const files = [];
        for (const file of value.files) {
          const u = await uploadGet(id(file.uploadId));
          if (!u.ready || u.scope !== 'library' || u.libraryType !== value.type)
            fail(400, '文件未上传完成或不属于此类资料');
          files.push({
            uploadId: u.id,
            key: u.key,
            name: u.name,
            size: u.size,
            contentType: u.contentType,
          });
        }
        value.files = files;
      }
      const next = { ...value, revision: (old?.revision || 0) + 1 };
      await store.putLibrary(next, old?.revision ?? null);
      return libraryExpanded(next);
    },
    async beginLibraryUpload(body, who) {
      libraryRole(who);
      if (!['material', 'exam'].includes(body.libraryType)) fail(400, '资料类型无效');
      if (!Number.isSafeInteger(body.size) || body.size < 1) fail(400, '不能上传空文件');
      const name = String(body.name || '').trim(),
        contentType = body.contentType || 'application/octet-stream';
      if (!name || name.length > 250) fail(400, '文件名称无效');
      if (!/^[-a-zA-Z0-9.+]+\/[-a-zA-Z0-9.+]+$/.test(contentType)) fail(400, '文件格式无效');
      const uploadId = randomUUID(),
        key = 'library-files/' + uploadId,
        multipart = await objects.begin(key, contentType);
      const meta = {
        id: uploadId,
        scope: 'library',
        libraryType: body.libraryType,
        kind: 'file',
        key,
        size: body.size,
        name,
        contentType,
        multipart,
        ready: false,
      };
      await objects.put(
        'uploads/' + uploadId + '.json',
        Buffer.from(JSON.stringify(meta)),
        'application/json',
      );
      return { uploadId, chunkSize: 4 * 1024 * 1024 };
    },
    async file(uploadId) {
      const u = await uploadGet(uploadId);
      if (!u.ready || (u.scope !== 'library' && u.kind !== 'file')) fail(404, '资料文件不存在');
      return { bytes: await objects.get(u.key), contentType: u.contentType, name: u.name };
    },

    async beginUpload(body, who) {
      role(who, 'student');
      const t = await taskGet(body.taskId);
      if (t.deletedAt || !t.enabled) fail(409, '作业已停用或删除');
      if (!['image', 'text', 'file'].includes(body.kind)) fail(400, '上传类型无效');
      if (t.format === 'auto') fail(400, '默认打卡无需上传');
      if (t.format !== body.kind) fail(400, '上传形式与作业不一致');
      if (!Number.isSafeInteger(body.size) || body.size < 1) fail(400, '文件为空或大小无效');
      const contentType =
        body.kind === 'text'
          ? 'text/plain; charset=utf-8'
          : body.kind === 'file'
            ? typeof body.contentType === 'string' &&
              /^[a-zA-Z0-9_.+-]+\/[a-zA-Z0-9_.+-]+$/.test(body.contentType)
              ? body.contentType
              : 'application/octet-stream'
            : body.contentType;
      if (
        body.kind === 'image' &&
        (typeof contentType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(contentType))
      )
        fail(400, '请选择图片文件');
      const uploadId = randomUUID(),
        key = 'assets/' + t.id + '/' + uploadId;
      const multipart = await objects.begin(key, contentType);
      const meta = {
        id: uploadId,
        taskId: t.id,
        kind: body.kind,
        key,
        size: body.size,
        name: String(body.name || '作业内容').slice(0, 250),
        contentType,
        multipart,
        ready: false,
        created: clock(),
      };
      await objects.put(
        'uploads/' + uploadId + '.json',
        Buffer.from(JSON.stringify(meta)),
        'application/json',
      );
      return { uploadId, chunkSize: 4 * 1024 * 1024 };
    },
    async uploadPart(uploadId, number, bytes, who) {
      const meta = await uploadGet(uploadId);
      uploadRole(meta, who);
      if (meta.ready) fail(409, '上传已经完成');
      if (!Number.isInteger(number) || number < 1 || number > 10000) fail(400, '上传分段编号无效');
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) fail(413, '每段需在 4 MB 以内');
      const result = await objects.part(meta.key, meta.multipart, number, bytes);
      return { number, etag: result };
    },
    async finishUpload(uploadId, body, who) {
      const meta = await uploadGet(uploadId);
      uploadRole(meta, who);
      if (meta.ready) return { uploadId, key: meta.key, name: meta.name };
      if (!Array.isArray(body.parts) || !body.parts.length || body.parts.length > 10000)
        fail(400, '上传分段信息无效');
      const parts = body.parts.map((p, i) => {
        if (p.number !== i + 1 || typeof p.etag !== 'string') fail(400, '上传分段不完整');
        return { number: p.number, etag: p.etag };
      });
      try {
        await objects.complete(meta.key, meta.multipart, parts);
      } catch (error) {
        try {
          if ((await objects.size(meta.key)) !== meta.size) throw error;
        } catch {
          throw error;
        }
      }
      const size = await objects.size(meta.key);
      if (size !== meta.size) fail(409, '文件大小不一致，请重新上传');
      meta.ready = true;
      await objects.put(
        'uploads/' + uploadId + '.json',
        Buffer.from(JSON.stringify(meta)),
        'application/json',
      );
      return { uploadId, key: meta.key, name: meta.name };
    },
    async submit(body, who) {
      role(who, 'student');
      id(body.requestId);
      round(body.round);
      const t = await taskGet(body.taskId);
      M.validateScore(body.selfScore);
      if (!Array.isArray(body.uploadIds)) fail(400, '上传列表无效');
      const uploads = [];
      for (const uploadId of body.uploadIds) {
        const u = await uploadGet(uploadId);
        if (!u.ready || u.taskId !== t.id) fail(400, '作业文件尚未上传完成或属于其他作业');
        uploads.push(u);
      }
      if (t.format === 'text' && (uploads.length !== 1 || uploads[0].kind !== 'text'))
        fail(400, '文字作业必须上传作业内容');
      if (t.format === 'image' && (!uploads.length || uploads.some((u) => u.kind !== 'image')))
        fail(400, '图片作业必须上传作业图片');
      if (t.format === 'file' && (!uploads.length || uploads.some((u) => u.kind !== 'file')))
        fail(400, '文件作业必须上传作业文件');
      const text = t.format === 'text' ? (await objects.get(uploads[0].key)).toString('utf8') : '';
      const images =
        t.format === 'image'
          ? uploads.map((u) => ({ key: u.key, uploadId: u.id, name: u.name }))
          : [];
      const files =
        t.format === 'file'
          ? uploads.map((u) => ({
              key: u.key,
              uploadId: u.id,
              name: u.name,
              contentType: u.contentType,
              size: u.size,
            }))
          : [];
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            taskId: t.id,
            round: body.round,
            uploadIds: body.uploadIds,
            selfScore: body.selfScore,
          }),
        )
        .digest('hex');
      const refs = t._rounds || {},
        same = Object.entries(refs).find(([k, r]) => r.requestId === body.requestId);
      if (same) {
        if (same[1].hash !== hash) fail(409, '同一次请求内容不同，请重新打开提交');
        return expanded(await materialize(t, same[0]));
      }
      if (t.kind === 'once' && refs[body.round]) fail(409, '单次作业已经提交，不能修改');
      const slot = refs[body.round] ? body.round + '~' + body.requestId : body.round;
      if (t.deletedAt || !t.enabled) fail(409, '作业已停用或删除，不能提交');
      if (t.revision !== body.taskRevision) fail(409, '作业已变更，请刷新后重新提交');
      const record = M.submission(
        t,
        body.round,
        clock(),
        text,
        t.format === 'file' ? files : images,
        body.selfScore,
      );
      const payload = {
        taskId: t.id,
        taskName: t.name,
        semester: t.semester ?? '七年级上学期',
        subject: t.subject,
        kind: t.kind,
        format: t.format,
        round: body.round,
        start: record.start,
        end: record.end,
        selfScore: body.selfScore,
        textKey: t.format === 'text' ? uploads[0].key : null,
        images,
        files,
        requestId: body.requestId,
      };
      const key = 'submissions/' + t.id + '/' + body.requestId + '-' + hash + '.json';
      await objects.put(key, Buffer.from(JSON.stringify(payload)), 'application/json');
      const accepted = M.submission(
        t,
        body.round,
        clock(),
        text,
        t.format === 'file' ? files : images,
        body.selfScore,
      );
      const updated = {
        ...t,
        revision: t.revision + 1,
        _rounds: {
          ...t._rounds,
          [slot]: {
            key,
            hash,
            requestId: body.requestId,
            completed: accepted.completed,
            late: accepted.late,
            notify: true,
            taskName: t.name,
            selfScore: body.selfScore,
          },
        },
      };
      try {
        await store.putTask(updated, t.revision);
      } catch (e) {
        if (e.status !== 409) throw e;
        const latest = await taskGet(t.id),
          entry = Object.entries(latest._rounds || {}).find(
            ([k, r]) => r.requestId === body.requestId,
          ),
          ref = entry?.[1];
        if (ref?.requestId === body.requestId && ref.hash === hash)
          return expanded(await materialize(latest, entry[0]));
        fail(409, '作业或本轮成果已变更，请刷新');
      }
      return expanded(await materialize(updated, slot));
    },
    async grade(body, who) {
      role(who, 'teacher');
      round(body.round);
      M.validateScore(body.score);
      const t = await taskGet(body.taskId);
      const slot = body.recordKey || body.round;
      if (typeof slot !== 'string' || slot.length > 180 || !t._rounds?.[slot])
        fail(404, '提交记录不存在');
      const record = await materialize(t, slot);
      if (record.automatic) fail(400, '自动打卡无需评分');
      if (record.round !== body.round) fail(400, '提交轮次不一致');
      if (record.gradeRevision !== body.expected) fail(409, '评分已更新，请刷新后重试');
      const existing = await store.getRecord(t.id, slot);
      await store.putRecord(
        {
          ...existing,
          teacherScore: body.score,
          gradedAt: clock(),
          gradeRevision: existing.gradeRevision + 1,
        },
        existing.gradeRevision,
      );
      return { teacherScore: body.score };
    },
    async image(uploadId) {
      const u = await uploadGet(uploadId);
      if (!u.ready || u.kind !== 'image') fail(404, '图片不存在');
      return { bytes: await objects.get(u.key), contentType: u.contentType, name: u.name };
    },
  };
}
module.exports = { createService, AppError };
