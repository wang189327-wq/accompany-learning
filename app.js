function periodNoteName(task) {
  return { week: '本周备注', month: '本月备注', day: '本日备注' }[task?.rule] || '周期备注';
}
('use strict');
const M = TaskModel,
  $ = (id) => document.getElementById(id);
/* @runtime-begin testmode */
const TEST_MODE = new URLSearchParams(location.search).get('test') === '1';
const APP_TITLE = '伴学记录 · 本机测试版';
/* @runtime-end testmode */
let searchName = '',
  searchSubject = '',
  searchAssignmentGroup = '',
  searchSemesters = [];
let cloudFeatures = { semesters: true, studentTasks: true, roundPause: true, roundNotes: true };
let db,
  tasks = [],
  assignmentGroups = [],
  records = [],
  role = null,
  tab = 'tasks',
  editing = null,
  selected = null,
  submitting = null,
  busy = false,
  testTime = null,
  shown = 30;
let photoUrls = [],
  grading = null,
  photoRecordId = null,
  photoIndex = 0,
  photoOwnUrl = null,
  photoGesture = null,
  photoZoom = null,
  roundNoteDraft = null,
  formRoundKey = null,
  editingRevision = null,
  refreshSequence = 0;
let lastSyncViewStamp = null;
/* @runtime-begin clock */
const now = () => (testTime == null ? Date.now() : testTime);
/* @runtime-end clock */
function readDevice(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function saveDevice(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
const DEFAULT_MOTTO = '两个人，一起把事情完成';
let motto = readDevice('c9-device-motto', DEFAULT_MOTTO),
  taskView = readDevice('c9-task-view', 'agenda'),
  calendarDate = null;
if (!['agenda', 'day', 'week', 'month'].includes(taskView)) taskView = 'agenda';
function semesterChoices(id, values = []) {
  return (
    '<div class="semesterChoices" id="' +
    id +
    '">' +
    M.SEMESTERS.map(
      (v) =>
        '<label><input type="checkbox" value="' +
        v +
        '" ' +
        (values.includes(v) ? 'checked' : '') +
        '><span>' +
        v +
        '</span></label>',
    ).join('') +
    '</div>'
  );
}
function semesterSummary(values) {
  return values.length
    ? values
        .map((v) => '<span class="semesterValue">' + escapeHTML(M.semesterLabel(v)) + '</span>')
        .join('、')
    : '全部学期';
}
function semesterFilter(id, values = []) {
  return (
    '<div class="semesterField"><span>所属学期</span><details class="semesterFilter semesterDropdown"><summary aria-label="所属学期，多选">' +
    semesterSummary(values) +
    '</summary>' +
    semesterChoices(id, values) +
    '</details></div>'
  );
}
function selectedSemesters(id) {
  return [...$(id).querySelectorAll('input:checked')].map((x) => x.value);
}
document.body.insertAdjacentHTML(
  'beforeend',
  [
    '<dialog id="mottoDialog">',
    '<div class="dialogHead">',
    '<h3>编辑标语</h3>',
    '<button data-close="mottoDialog">关闭</button>',
    '</div>',
    '<form id="mottoForm">',
    '<label>文字内容<textarea id="mottoText" required>',
    '</textarea>',
    '</label>',
    '<p id="mottoError" class="error">',
    '</p>',
    '<div class="actions">',
    '<button type="submit" class="primary">保存</button>',
    '<button type="button" id="resetMotto">恢复默认</button>',
    '</div>',
    '</form>',
    '</dialog>',
  ].join(''),
);
$('appSubtitle').setAttribute('role', 'button');
$('appSubtitle').tabIndex = 0;
$('appSubtitle').setAttribute('aria-label', '双击编辑标语');
function editMotto() {
  if ($('mottoDialog').open) return;
  $('mottoText').value = motto;
  $('mottoError').textContent = '';
  $('mottoDialog').showModal();
}
$('appSubtitle').addEventListener('dblclick', (e) => {
  e.preventDefault();
  editMotto();
});
let lastMottoTap = null;
$('appSubtitle').addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' || !e.isPrimary || e.button !== 0) return;
  const stamp = performance.now();
  if (
    lastMottoTap &&
    stamp - lastMottoTap.time < 400 &&
    Math.hypot(e.clientX - lastMottoTap.x, e.clientY - lastMottoTap.y) < 24
  ) {
    lastMottoTap = null;
    e.preventDefault();
    editMotto();
  } else lastMottoTap = { time: stamp, x: e.clientX, y: e.clientY };
});
$('appSubtitle').addEventListener('keydown', (e) => {
  if (['Enter', ' '].includes(e.key)) {
    e.preventDefault();
    editMotto();
  }
});
$('mottoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('mottoText').value.trim();
  if (!value) {
    $('mottoError').textContent = '请输入标语';
    return;
  }
  motto = value;
  const saved = saveDevice('c9-device-motto', motto);
  $('mottoDialog').close();
  render();
  if (!saved) toast('已调整，本设备无法持久保存设置');
});
$('resetMotto').addEventListener('click', () => {
  $('mottoText').value = DEFAULT_MOTTO;
});
const escapeHTML = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
function toast(s) {
  $('toast').textContent = s;
  $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), 4000);
}
/* @runtime-begin storage */
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('two-person-task-assistant', 3);
    r.onupgradeneeded = () => {
      for (const name of ['preferences', 'messages'])
        if (!r.result.objectStoreNames.contains(name))
          r.result.createObjectStore(name, { keyPath: 'id' });
      if (!r.result.objectStoreNames.contains('tasks'))
        r.result.createObjectStore('tasks', { keyPath: 'id' });
      if (!r.result.objectStoreNames.contains('records')) {
        const st = r.result.createObjectStore('records', { keyPath: 'id' });
        st.createIndex('taskId', 'taskId');
      }
      if (!r.result.objectStoreNames.contains('library'))
        r.result.createObjectStore('library', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error('请关闭其他旧版本窗口后重试'));
  });
}
function all(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'),
      r = tx.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function refresh() {
  const sequence = ++refreshSequence;
  const data = await Promise.all([
    all('tasks'),
    all('records'),
    all('library'),
    all('preferences'),
    all('messages'),
  ]);
  if (sequence !== refreshSequence) return;
  [tasks, records] = data;
  assignmentGroups = data[3].find((value) => value.id === 'assignment-groups')?.groups || [];
  await autoLocal();
  StudyUI.set(data[2]);
  await checkReminders();
  const latestMessages = await all('messages');
  if (sequence !== refreshSequence) return;
  MyUI.set(data[3], latestMessages);
  render();
  if ($('detailDialog').open && !$('photoDialog').open) renderDetail();
  if ($('messagesDialog').open) MyUI.showMessages();
}
function changed() {
  saveDevice('c9-data-changed', uid());
}
function saveMyPreference(value, expected) {
  return new Promise((resolve, reject) => {
    let problem;
    const tx = db.transaction('preferences', 'readwrite'),
      st = tx.objectStore('preferences');
    tx.oncomplete = () => {
      changed();
      resolve();
    };
    tx.onabort = () => reject(problem || tx.error || Error('保存失败'));
    const req = st.get(value.id);
    req.onsuccess = () => {
      if ((req.result?.revision || 0) !== expected) {
        problem = Error('信息已在另一窗口更新，请关闭并重新打开编辑');
        tx.abort();
        return;
      }
      st.put({ ...value, revision: expected + 1 });
    };
  });
}
function markMessagesRead(ids) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readwrite'),
      st = tx.objectStore('messages');
    tx.oncomplete = () => {
      changed();
      resolve();
    };
    tx.onabort = () => reject(tx.error || Error('消息保存失败'));
    ids.forEach((id) => {
      const req = st.get(id);
      req.onsuccess = () => {
        if (req.result?.targetRole === role) st.put({ ...req.result, read: true });
      };
    });
  });
}
async function checkReminders() {
  if (!role) return;
  const candidates = tasks.map((t) => MyModel.due(t, records, now(), M)).filter(Boolean);
  if (!candidates.length) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['tasks', 'records', 'messages'], 'readwrite'),
      st = tx.objectStore('messages');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || Error('提醒保存失败'));
    for (const msg of candidates) {
      const req = st.get(msg.id);
      req.onsuccess = () => {
        if (req.result) return;
        const taskReq = tx.objectStore('tasks').get(msg.taskId);
        taskReq.onsuccess = () => {
          const task = taskReq.result;
          if (!task) return;
          const recordReq = tx.objectStore('records').get(task.id + '|' + msg.round);
          recordReq.onsuccess = () => {
            const current = MyModel.due(task, recordReq.result ? [recordReq.result] : [], now(), M);
            if (current && current.id === msg.id) st.add(current);
          };
        };
      };
    }
  });
}
/* @runtime-end storage */
function checkGroupCapability() {
  if (typeof Cloud !== 'undefined' && !cloudFeatures.assignmentGroups)
    throw Error('请先部署1.0云端接口，再发布任务或保存作业关联');
}
async function publishAssignmentGroup(group) {
  checkGroupCapability();
  if (!['teacher', 'student'].includes(role)) throw Error('请选择学生或老师身份');
  if (
    typeof Cloud !== 'undefined' &&
    (!group.subject || !group.semester) &&
    !cloudFeatures.optionalGroupFields
  )
    throw Error('请先部署build 1云端接口，再仅填写名称发布任务；学科和学期均为选填');
  if (typeof Cloud !== 'undefined')
    return Cloud.request('/api/assignment-groups', { method: 'POST', role, body: { group } });
  const value = AssignmentGroups.validate(group, M.SUBJECTS, M.SEMESTERS);
  return new Promise((resolve, reject) => {
    let problem;
    const tx = db.transaction('preferences', 'readwrite'),
      store = tx.objectStore('preferences');
    tx.oncomplete = () => {
      changed();
      resolve();
    };
    tx.onabort = () => reject(problem || tx.error || Error('任务发布失败'));
    const request = store.get('assignment-groups');
    request.onsuccess = () => {
      const old = request.result;
      if (old?.groups.some((item) => item.id === value.id)) {
        problem = Error('任务编号已存在');
        tx.abort();
        return;
      }
      store.put({
        id: 'assignment-groups',
        groups: [...(old?.groups || []), { ...value, createdBy: role, created: now() }],
        revision: (old?.revision || 0) + 1,
      });
    };
  });
}

/* @runtime-begin tasks */
function writeTask(task, expected) {
  return new Promise((resolve, reject) => {
    let problem;
    const tx = db.transaction(['tasks', 'records', 'messages'], 'readwrite'),
      st = tx.objectStore('tasks');
    tx.oncomplete = () => {
      changed();
      resolve();
    };
    tx.onabort = () => reject(problem || tx.error || Error('保存失败'));
    tx.onerror = () => {};
    const req = st.get(task.id);
    req.onsuccess = () => {
      const current = req.result;
      if (!role || (current && !M.canManage(current, role))) {
        problem = Error('只能修改或删除自己发布的作业');
        tx.abort();
        return;
      }
      if (
        role !== 'teacher' &&
        (task.roundNote ||
          JSON.stringify(task.roundNotes || {}) !== JSON.stringify(current?.roundNotes || {}))
      ) {
        problem = Error('只有老师可以修改本周期备注');
        tx.abort();
        return;
      }
      if (
        role !== 'teacher' &&
        ((task.note || '') !== (current?.note || '') ||
          JSON.stringify(task.reminder || null) !== JSON.stringify(current?.reminder || null))
      ) {
        problem = Error('只有老师可以修改备注和提醒');
        tx.abort();
        return;
      }
      try {
        task.assignmentGroupId = AssignmentGroups.association(
          task.assignmentGroupId,
          current?.assignmentGroupId,
          assignmentGroups,
        );
        task.note = String(task.note || '');
        task.reminder = MyModel.reminder(task.reminder);
        if (task.roundNote)
          task = M.withRoundNote(
            { ...task, roundNotes: current?.roundNotes || {} },
            task.roundNote.round,
            task.roundNote.text,
            now(),
          );
        else task.roundNotes = current?.roundNotes || {};
        delete task.roundNote;
        if (
          current?.format === 'auto' &&
          JSON.stringify(task.weekDays) !== JSON.stringify(current.weekDays)
        )
          task.autoScheduleFrom = M.period(task, now()).start;
        if (
          task.format === 'auto' &&
          (current?.format !== 'auto' || (!current?.enabled && task.enabled))
        )
          task.autoStartAt = now();
      } catch (err) {
        problem = err;
        tx.abort();
        return;
      }
      task.disabledAt = task.enabled
        ? null
        : current?.enabled === false
          ? current.disabledAt || current.updated || now()
          : now();
      task.createdBy = current?.createdBy || (current ? 'teacher' : role);
      M.validateTask(task, { requireSemester: true });
      if (expected != null && (!current || current.revision !== expected)) {
        problem = Error('作业已在另一个窗口更新，请刷新后重试');
        tx.abort();
        return;
      }
      const count = tx.objectStore('records').index('taskId').count(task.id);
      count.onsuccess = () => {
        if (
          role !== 'teacher' &&
          current &&
          count.result &&
          (current.kind !== task.kind ||
            current.rule !== task.rule ||
            current.format !== task.format)
        ) {
          problem = Error('已有成果的作业不能更改类型、周期或提交形式，请新建作业');
          tx.abort();
          return;
        }
        task.revision = (current?.revision || 0) + 1;
        st.put(task);
        if (role === 'teacher' && !task.deletedAt)
          tx.objectStore('messages').add({
            id: 'task:' + task.id + ':' + task.revision,
            targetRole: 'student',
            kind: current ? 'taskUpdated' : 'taskPublished',
            taskId: task.id,
            title: current ? '老师修改了作业' : '老师发布了作业',
            body: task.name + ' · ' + (task.semester || '七年级上学期'),
            created: now(),
            read: false,
          });
      };
    };
  });
}
/* @runtime-end tasks */
/* @runtime-begin records */
function writeRecord(record, taskRevision) {
  if (role !== 'student') return Promise.reject(Error('只有学生可以提交作业'));
  return new Promise((resolve, reject) => {
    let problem;
    const tx = db.transaction(['tasks', 'records', 'messages'], 'readwrite');
    tx.oncomplete = () => {
      changed();
      resolve();
    };
    tx.onabort = () => reject(problem || tx.error || Error('提交失败，可能此轮已提交'));
    tx.onerror = () => {};
    const req = tx.objectStore('tasks').get(record.taskId);
    req.onsuccess = () => {
      const t = req.result;
      if (
        !t ||
        t.deletedAt ||
        !t.enabled ||
        M.paused(t, record.round) ||
        t.revision !== taskRevision
      ) {
        problem = Error('作业已变更，请刷新后重新提交');
        tx.abort();
        return;
      }
      tx.objectStore('records').add(record);
      tx.objectStore('messages').add({
        id: 'completion:' + record.id,
        targetRole: 'teacher',
        kind: 'completion',
        taskId: record.taskId,
        round: record.round,
        title: '学生完成了作业',
        body:
          record.taskName + ' · ' + record.round + '\n作业自评分：' + record.selfScore + ' / 10 分',
        created: record.completed,
        read: false,
      });
    };
  });
}
/* @runtime-end records */
/* @runtime-begin library */
function writeLibrary(entry, expected) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('library', 'readwrite'),
      st = tx.objectStore('library');
    let problem;
    tx.oncomplete = () => {
      changed();
      resolve();
    };
    tx.onabort = () => reject(problem || tx.error || Error('保存失败'));
    tx.onerror = () => {};
    const req = st.get(entry.id);
    req.onsuccess = () => {
      const old = req.result;
      if (old ? old.revision !== expected : expected != null) {
        problem = Error('资料已在其他窗口修改，请刷新后重试');
        tx.abort();
        return;
      }
      st.put({ ...entry, revision: (old?.revision || 0) + 1 });
    };
  });
}
/* @runtime-end library */
// 渲染在 submission-views.js，评分交互在 grade-flow.js；
// 保留原函数名，task-views.js 等调用方不用改。
function scoreHTML(record) {
  return SubmissionViews.score(record);
}
function colorSelect(id) {
  return GradeFlow.colorSelect(id);
}
function showGrade(id) {
  return GradeFlow.open(id);
}
/* @runtime-begin grade */
function saveGrade(id, score, expected) {
  if (role !== 'teacher') return Promise.reject(Error('只有老师可以评分'));
  M.validateScore(score);
  return new Promise((resolve, reject) => {
    let problem;
    const tx = db.transaction('records', 'readwrite');
    tx.oncomplete = () => {
      changed();
      resolve();
    };
    tx.onabort = () => reject(problem || tx.error || Error('评分保存失败'));
    tx.onerror = () => {};
    const store = tx.objectStore('records'),
      r = store.get(id);
    r.onsuccess = () => {
      if (!r.result) {
        problem = Error('成果记录不存在，请刷新');
        tx.abort();
        return;
      }
      if ((r.result.gradeRevision || 0) !== expected) {
        problem = Error('评分已在其他窗口更新，请关闭并重新打开评分');
        tx.abort();
        return;
      }
      store.put(M.grade(r.result, score, now()));
    };
  });
}
/* @runtime-end grade */
let indexedRecords = null,
  indexedLength = -1,
  currentRecordIndex = null;
function recordIndex() {
  if (indexedRecords !== records || indexedLength !== records.length) {
    indexedRecords = records;
    indexedLength = records.length;
    currentRecordIndex = M.indexRecords(records);
  }
  return currentRecordIndex;
}
function recordsFor(t, p) {
  return recordIndex().byRound.get(t.id + '|' + p.key) || [];
}
function recordFor(t, p) {
  return recordsFor(t, p).at(-1);
}
function dateText(ms) {
  return ms == null ? '未设置' : M.input(ms).slice(0, 10);
}
function formatText(f) {
  return f === 'auto' ? '默认打卡' : f === 'image' ? '图片' : f === 'file' ? '文件' : '文字';
}
let weekDaysEditing = null;
async function saveWeekDays(task, days) {
  if (typeof Cloud !== 'undefined') {
    if (!cloudFeatures.studentWeekDays) throw Error('请先部署内部33云端接口');
    return Cloud.request('/api/tasks/weekdays', {
      method: 'POST',
      role,
      body: { taskId: task.id, expected: task.revision, weekDays: days },
    });
  }
  M.validateTask({ ...task, weekDays: days });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tasks', 'readwrite'),
      st = tx.objectStore('tasks'),
      r = st.get(task.id);
    r.onsuccess = () => {
      if (r.result?.revision !== task.revision) {
        tx.abort();
        return;
      }
      st.put({
        ...r.result,
        weekDays: days,
        autoScheduleFrom:
          task.format === 'auto' ? M.period(task, now()).start : task.autoScheduleFrom || null,
        dateOnly: true,
        startTime: null,
        endTime: null,
        revision: task.revision + 1,
      });
    };
    tx.oncomplete = resolve;
    tx.onabort = () => reject(Error('作业已变更，请重新打开'));
  });
}
const reviewingIds = new Set(),
  receivedReviewIds = new Set();
function markReviewReceived(recordId) {
  receivedReviewIds.add(recordId);
  document.querySelectorAll('[data-ai-review]').forEach((button) => {
    if (button.dataset.aiReview === recordId) button.textContent = '正在点评…';
  });
}
function reviewFailure(message) {
  alert('点评未完成\n\n' + String(message || '请稍后重试'));
}
async function reviewHomework(recordId) {
  if (!['teacher', 'student'].includes(role) || reviewingIds.has(recordId)) return;
  const record = records.find((r) => r.id === recordId);
  if (!record) return;
  if (typeof Cloud === 'undefined') {
    reviewFailure('请先连接支持AI点评的云端接口');
    return;
  }
  if (!cloudFeatures.aiReview) {
    reviewFailure('请先部署AI点评云端接口（build39）');
    return;
  }
  if (role === 'student' && !cloudFeatures.studentAiReview) {
    reviewFailure('请先更新云端接口（build40），再使用学生点评');
    return;
  }
  reviewingIds.add(recordId);
  renderDetail();
  try {
    const job = await Cloud.request('/api/ai/review', {
      method: 'POST',
      role,
      body: {
        taskId: record.taskId,
        recordKey: record.recordKey || record.round,
        requestId: uid(),
      },
    });
    if (job.status === 'running') markReviewReceived(recordId);
    let finished = false;
    for (let i = 0; i < 155; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await Cloud.request('/api/ai/review?jobId=' + encodeURIComponent(job.id), {
        role,
      });
      if (result.status === 'running') markReviewReceived(recordId);
      if (result.status === 'done') {
        await refresh();
        toast('作业点评已保存');
        finished = true;
        break;
      }
      if (result.status === 'failed') throw Error(result.error || '点评未完成，请稍后重试');
    }
    if (!finished) throw Error('点评超时，请稍后重新打开作业查看');
  } catch (e) {
    reviewFailure(e.message);
  } finally {
    receivedReviewIds.delete(recordId);
    reviewingIds.delete(recordId);
    if ($('detailDialog').open) renderDetail();
  }
}
document.addEventListener('click', (event) => {
  const fileButton = event.target.closest('[data-homework-file]');
  if (fileButton) {
    const record = records.find((r) => r.id === fileButton.dataset.homeworkFile);
    if (record && canViewTask(tasks.find((t) => t.id === record.taskId)))
      FileViewer.open(
        (record.files || []).map((file) => ({
          entry: { name: record.taskName, type: 'homework' },
          file,
        })),
        Number(fileButton.dataset.fileIndex) || 0,
      );
    return;
  }
  const button = event.target.closest('[data-ai-review]');
  if (button) reviewHomework(button.dataset.aiReview);
});
function submittedHTML(r) {
  return SubmissionViews.record(r);
}
async function autoLocal() {
  const updates = [];
  for (const t of tasks)
    for (const d of t.kind === 'once' && records.some((r) => r.taskId === t.id)
      ? []
      : M.autoDates(t, now())) {
      const id = t.id + '|auto|' + d.date;
      if (!records.some((r) => r.id === id))
        updates.push({
          ...d,
          id,
          taskId: t.id,
          taskName: t.name,
          subject: t.subject,
          semester: t.semester,
          kind: t.kind,
          format: 'auto',
          automatic: true,
          late: false,
          images: [],
          text: '',
          selfScore: null,
          teacherScore: null,
          gradeRevision: 0,
        });
    }
  if (!updates.length) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (const r of updates) tx.objectStore('records').put(r);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  records.push(...updates);
}

function badge(s) {
  return `<span class="badge ${s.color}">${escapeHTML(s.label)}</span>`;
}

function kindText(t) {
  return t.kind === 'once'
    ? '单次作业'
    : { day: '每天循环', week: '每周循环', month: '每月循环' }[t.rule] || '周期作业';
}
function canViewTask(task) {
  return !!task && !M.historyHidden(task) && (role === 'teacher' || !task.deletedAt);
}
function closeHiddenTask() {
  if (role !== 'student' || !selected || canViewTask(tasks.find((t) => t.id === selected))) return;
  selected = null;
  ['photoDialog', 'detailDialog', 'submitDialog'].forEach((id) => {
    if ($(id).open) $(id).close();
  });
  $('largePhoto').removeAttribute('src');
  $('downloadPhoto').onclick = null;
  $('detailTitle').textContent = '';
  $('detailBody').innerHTML = '';
  releasePhotos();
}

function dayStart(value) {
  return StudyModel.date(value);
}
function dayLabel(value) {
  return StudyModel.dateLabel(value);
}
function completedOn(value) {
  return M.calendarRecords(tasks, records, dayStart(value), role, recordIndex());
}
function pendingOn(list, value) {
  return M.calendarPending(list, records, dayStart(value), recordIndex());
}
function moveCalendar(delta) {
  let d = dayStart(calendarDate || dayLabel(now()));
  if (taskView === 'month') {
    const local = new Date(d + 28800000),
      y = local.getUTCFullYear(),
      m = local.getUTCMonth() + delta,
      day = local.getUTCDate(),
      last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    d = Date.UTC(y, m, Math.min(day, last)) - 28800000;
  } else d += delta * (taskView === 'week' ? 7 : 1) * M.DAY;
  calendarDate = dayLabel(d);
}
const groupUI = AssignmentGroupsUI.create(() => ({
  groups: assignmentGroups,
  M,
  escapeHTML,
  uid,
  toast,
  refresh,
  checkCapability: checkGroupCapability,
  publish: publishAssignmentGroup,
  onSelect(id, value) {
    if (id === 'historyGroup') {
      searchAssignmentGroup = value;
      $('historyResults').innerHTML = historyResults();
    }
  },
}));
const taskViews = TaskViews.create(() => ({
  tab,
  taskView,
  TaskOrdering,
  calendarDate,
  dayLabel,
  now,
  dayStart,
  M,
  recordFor,
  pendingOn,
  completedOn,
  tasks,
  escapeHTML,
  scoreHTML,
  badge,
  kindText,
  formatText,
  dateText,
  role,
  periodNoteName,
  canViewTask,
  searchName,
  searchSubject,
  searchSemesters,
  searchAssignmentGroup,
  assignmentGroups,
  AssignmentGroups,
}));
function calendarPage(list, agenda) {
  return taskViews.calendarPage(list, agenda);
}

function taskCard(task, at = now()) {
  return taskViews.taskCard(task, at);
}
function updateHistoryFilterStyles() {
  if (tab !== 'history') return;
  for (const [element, selected] of [
    [$('historySearch'), !!searchName.trim()],
    [$('historySubject'), !!searchSubject],
    [
      $('historySemesters')?.closest('details').querySelector('summary'),
      searchSemesters.length > 0,
    ],
  ])
    element?.classList.toggle('filterSelected', selected);
  $('historySemesters')
    ?.querySelectorAll('label')
    .forEach((label) =>
      label.classList.toggle('filterSelected', label.querySelector('input').checked),
    );
}
function historyResults() {
  return taskViews.historyResults();
}
function navIcon(key) {
  const paths = {
    tasks:
      '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10l1 1 2-2M14 10h2M9 16l1 1 2-2M14 16h2"/>',
    history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2"/>',
    materials:
      '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    exams:
      '<path d="M4 3v17h17M8 15l4-5 4 2 4-7"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="16" cy="12" r="1"/>',
    mine: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths[key] + '</svg>';
}
function alignPublishButton() {
  const row = $('newTask')?.closest('.taskStats'),
    button = row?.querySelector('.publishActions'),
    metrics = row?.querySelector('.taskMetrics');
  if (!row || !button?.getBoundingClientRect || !metrics?.getBoundingClientRect) return;
  const b = button.getBoundingClientRect(),
    m = metrics.getBoundingClientRect();
  row.classList.toggle('publishWrapped', b.top >= m.bottom - 0.5);
}
const publishAlignmentObserver =
  typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => alignPublishButton())
    : {
        disconnect() {},
        observe() {
          alignPublishButton();
        },
      };
function render() {
  $('app').setAttribute('data-page', tab);
  document.body.append($('settingsPanel'));
  $('settingsPanel').classList.toggle('hidden', !role || tab !== 'mine');
  $('app').classList.toggle('myPage', tab === 'mine');
  closeHiddenTask();
  document.querySelector('header').classList.toggle('hidden', !role || tab !== 'mine');
  $('switchRole').classList.toggle('hidden', !role);
  $('appSubtitle').textContent = motto;
  document.title = '伴学记录' + (TEST_MODE ? ' · 本地测试版' : '');
  if (!role) {
    $('app').innerHTML =
      '<div class="welcome"><h1>' +
      APP_TITLE +
      [
        '</h1>',
        '<h2>今天以哪个角色进入？</h2>',
        '<div class="roles">',
        '<button class="role" data-role="teacher">',
        '<strong>我是老师</strong>',
        '</button>',
        '<button class="role" data-role="student">',
        '<strong>我是学生</strong>',
        '</button>',
        '</div>',
        '</div>',
      ].join('');
    return;
  }
  if (typeof Cloud !== 'undefined') Cloud.updateWidget?.(role, tasks, records);
  const active = tasks.filter(
    (t) =>
      !M.historyHidden(t) &&
      !t.deletedAt &&
      (role === 'teacher' || (t.enabled && !M.paused(t, M.period(t, now())))),
  );
  const sorted =
    taskView === 'agenda' ? TaskOrdering.ordered(active) : active.sort(TaskOrdering.compare());
  const disabled = sorted.filter((t) => !t.enabled);
  const enabled = sorted.filter((t) => t.enabled);
  const done = enabled.filter((t) => recordFor(t, M.period(t, now())));
  const pending = enabled.filter(
    (t) => !recordFor(t, M.period(t, now())) && !M.paused(t, M.period(t, now())),
  );
  const pausedTasks = enabled.filter(
    (t) => M.paused(t, M.period(t, now())) && !recordFor(t, M.period(t, now())),
  );
  const visibleIds = new Set(tasks.filter(canViewTask).map((t) => t.id));
  const historyCount = records.filter((r) => visibleIds.has(r.taskId)).length;
  const section = (name, list, empty) =>
    [
      `<section class="taskSection">`,
      `<div class="sectionTitle">`,
      `<h2>`,
      `${name}</h2>`,
      `<span>`,
      `${list.length} 个</span>`,
      `</div>`,
      `<div class="grid">`,
      `${list.map((t) => taskCard(t)).join('') || `<div class="empty">${empty}</div>`}</div>`,
      `</section>`,
    ].join('');
  const content =
    tab === 'mine'
      ? MyUI.page()
      : ['materials', 'exams'].includes(tab)
        ? StudyUI.page(tab)
        : tab === 'tasks'
          ? calendarPage(
              sorted,
              section('未完成作业', pending, '暂无未完成作业') +
                section('已完成作业', done, '暂无已完成作业') +
                (role === 'teacher' ? section('已停用作业', disabled, '暂无已停用作业') : '') +
                (role === 'teacher' && pausedTasks.length
                  ? section('本轮暂停', pausedTasks, '')
                  : ''),
            )
          : [
              `<div class="pageHeading">`,
              `<h2>作业档案</h2>`,
              `</div>`,
              `<div class="historyFilters">`,
              `<div class="historyNames"><label>作业名称<input id="historySearch" type="search" placeholder="输入作业名称关键词" value="${escapeHTML(searchName)}"></label>`,
              `${groupUI.html('historyGroup', searchAssignmentGroup, true)}</div>`,
              `<label>学科<select id="historySubject">`,
              `<option value="">全部学科</option>`,
              `${M.SUBJECTS.map((s) => `<option value="${s}" ${s === searchSubject ? 'selected' : ''}>${s}</option>`).join('')}</select>`,
              `</label>`,
              `${semesterFilter('historySemesters', searchSemesters)}<button id="clearFilters">清空筛选</button>`,
              `</div>`,
              `<div id="historyResults">`,
              `${historyResults()}</div>`,
            ].join('');
  const tools = TEST_MODE
    ? `<button id="backup">导出备份</button><button id="restore">恢复备份</button><button id="testToggle">测试时间</button>`
    : '';
  const panel = TEST_MODE
    ? [
        `<div id="testPanel" class="test ${testTime == null ? 'hidden' : ''}">`,
        `<strong>`,
        `${testTime == null ? '设置测试时间' : '时间模拟已开启'}</strong>`,
        `<p class="muted">仅用于测试，全部时间均为北京时间。</p>`,
        `<label>模拟日期与时间<input id="testInput" type="datetime-local" value="${M.input(now())}">`,
        `</label>`,
        `<div class="actions">`,
        `<button id="applyTime">应用测试时间</button>`,
        `<button id="realTime">恢复真实时间</button>`,
        `</div>`,
        `</div>`,
      ].join('')
    : '';
  const taskSummary = `${
    tab === 'tasks'
      ? [
          `<div class="stats taskStats">`,
          `<div class="taskMetrics">`,
          `<span class="taskCount">`,
          `<strong>`,
          `${active.length}</strong> 个作业</span>`,
          `<div class="secondaryStats">`,
          `<span>`,
          `<strong>`,
          `${done.length}</strong> 个本轮已完成</span>`,
          `<span>`,
          `<strong>`,
          `${historyCount}</strong> 份历史成果</span>`,
          `</div>`,
          `</div>`,
          `<div class="publishActions"><button id="newAssignmentGroup" class="primary">+发布任务</button><button id="newTask" class="primary">+发布作业</button></div>`,
          `</div>`,
        ].join('')
      : ''
  }`;
  $('app').innerHTML = [
    `${tab === 'tasks' ? `<div class="taskTopRow">${taskSummary}${tools ? '<div class="toolbar testTools">' + tools + '</div>' : ''}${panel}</div>` : ''}${content}<nav class="bottomNav" aria-label="页面导航">`,
    `${[
      ['tasks', '作业清单'],
      ['history', '作业档案'],
      ['materials', '学习资料'],
      ['exams', '成绩分析'],
      ['mine', '我的'],
    ]
      .map(([key, label]) =>
        [
          `<button data-tab="${key}" class="${tab === key ? 'selected' : ''}" ${tab === key ? 'aria-current="page"' : ''}> <span class="navIcon">`,
          `${navIcon(key)}${key === 'mine' && MyUI.unread() ? '<span class="redDot" aria-label="有未读消息"></span>' : ''}</span>`,
          `<span class="navLabel">`,
          `${label}</span>`,
          `</button>`,
        ].join(''),
      )
      .join('')}</nav>`,
  ].join('');
  if (tab === 'history') updateHistoryFilterStyles();
  if (tab === 'mine') {
    $('mySettingsSlot').append($('settingsPanel'));
    if (typeof StorageStatus !== 'undefined') StorageStatus.mount(role);
  }
  publishAlignmentObserver.disconnect();
  if (tab === 'tasks' && $('newTask')) {
    const row = $('newTask').closest('.taskStats');
    publishAlignmentObserver.observe(row);
    publishAlignmentObserver.observe($('newTask'));
    if (row?.querySelector('.taskMetrics'))
      publishAlignmentObserver.observe(row.querySelector('.taskMetrics'));
    alignPublishButton();
  }
}

function syncNodeKey(node) {
  if (node.nodeType !== 1) return null;
  return (
    node.id ||
    node.getAttribute('data-round') ||
    node.getAttribute('data-submission') ||
    node.getAttribute('data-media-key')
  );
}
function syncMarkup(target, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  function patch(parent, incoming) {
    const old = [...parent.childNodes],
      keyed = new Map(old.map((n) => [syncNodeKey(n), n]).filter(([k]) => k));
    let cursor = parent.firstChild;
    for (const fresh of [...incoming.childNodes]) {
      const key = syncNodeKey(fresh);
      let live = key ? keyed.get(key) : cursor;
      if (
        !live ||
        live.nodeType !== fresh.nodeType ||
        live.nodeName !== fresh.nodeName ||
        (!key && syncNodeKey(live))
      ) {
        live = fresh;
        parent.insertBefore(live, cursor);
      } else {
        if (live !== cursor) parent.insertBefore(live, cursor);
        if (live.nodeType === 1) {
          const keepImage =
            live.tagName === 'IMG' &&
            key &&
            syncNodeKey(live) === key &&
            !(live.complete && live.naturalWidth === 0 && !live.dataset.retried);
          for (const a of [...live.attributes])
            if (a.name !== 'data-retried' && !fresh.hasAttribute(a.name))
              live.removeAttribute(a.name);
          for (const a of [...fresh.attributes])
            if (!(keepImage && a.name === 'src') && live.getAttribute(a.name) !== a.value)
              live.setAttribute(a.name, a.value);
          patch(live, fresh);
        } else if (live.nodeValue !== fresh.nodeValue) live.nodeValue = fresh.nodeValue;
      }
      cursor = live.nextSibling;
    }
    while (cursor) {
      const next = cursor.nextSibling;
      parent.removeChild(cursor);
      cursor = next;
    }
  }
  patch(target, template.content);
}
let localPhotoCache = new Map();
function localPhotoURL(blob) {
  if (!localPhotoCache.has(blob)) {
    const url = URL.createObjectURL(blob);
    localPhotoCache.set(blob, url);
    photoUrls.push(url);
  }
  return localPhotoCache.get(blob);
}
// Keep loaded images even when a later snapshot carries a new signed URL.
// A failed image can retry once with the latest link; never run an error loop.
document.addEventListener(
  'error',
  (event) => {
    const image = event.target;
    if (!image.matches?.('img[data-media-key]') || image.dataset.retried) return;
    const record = records.find((r) => r.id === image.dataset.photo),
      file = record?.images?.[Number(image.dataset.index)];
    if (file?.url && image.getAttribute('src') !== file.url) {
      image.dataset.retried = '1';
      image.src = file.url;
    }
  },
  true,
);

function releasePhotos() {
  localPhotoCache.clear();
  photoUrls.forEach((u) => URL.revokeObjectURL(u));
  photoUrls = [];
}
function renderDetail() {
  const t = tasks.find((x) => x.id === selected);
  if (!canViewTask(t)) {
    closeHiddenTask();
    return false;
  }
  $('detailTitle').textContent = t.name;
  if (t.kind === 'recurring' && StudyUI.taskMode === 'chart') {
    syncMarkup($('detailBody'), StudyUI.taskChart(t, records));
    return;
  }
  const rounds = M.history(t, now());
  const keys = new Set(rounds.map((p) => p.key));
  // Records remain visible if simulated time precedes their round or after schedule edits.
  records
    .filter((r) => r.taskId === t.id)
    .forEach((r) => {
      if (!keys.has(r.round)) {
        keys.add(r.round);
        rounds.push({ key: r.round, start: r.start, end: r.end });
      }
    });
  rounds.sort((a, b) => b.start - a.start);
  const completion = StudyUI.state.task.completion || 'all';
  const visibleRounds = rounds.filter(
    (p) => completion === 'all' || (completion === 'done') === !!recordFor(t, p),
  );
  syncMarkup(
    $('detailBody'),
    [
      `<p class="muted">`,
      `${escapeHTML(t.subject || '学科未设置')} · ${kindText(t)} · ${formatText(t.format)} · 发布于 ${M.display(t.created)}${t.deletedAt ? ' · 已删除' : !t.enabled ? ' · 已停用' : ''}</p>`,
      `${t.note ? '<p class="muted taskNote">作业备注：' + escapeHTML(t.note) + '</p>' : ''}${StudyUI.taskTabs(t)}${
        visibleRounds
          .slice(0, shown)
          .map((p) => {
            const list = recordsFor(t, p),
              r = list.at(-1),
              s = M.status(t, p, r, now());
            let body = list.map(submittedHTML).join('');
            if (role === 'student' && !t.deletedAt && t.format !== 'auto') {
              const canSubmit =
                t.enabled && p.start <= now() && (t.kind === 'recurring' || !r) && !M.paused(t, p);
              if (canSubmit || r)
                body +=
                  '<div class="actions submissionActions studentSubmissionActions">' +
                  (canSubmit
                    ? '<button class="primary" data-submit="' +
                      escapeHTML(p.key) +
                      '">' +
                      (r
                        ? '再次提交作业'
                        : now() > M.windowFor(t, p).end
                          ? '补交作业'
                          : '提交作业') +
                      '</button>'
                    : '') +
                  (r && r.format !== 'file'
                    ? '<button class="primary" data-ai-review="' +
                      escapeHTML(r.id) +
                      '"' +
                      (reviewingIds.has(r.id) ? ' disabled' : '') +
                      '>' +
                      (receivedReviewIds.has(r.id) ? '正在点评…' : '点评作业') +
                      '</button>'
                    : '') +
                  '</div>';
            }
            if (!body)
              body =
                t.format === 'auto'
                  ? '<p class="muted">到指定日期自动打卡</p>'
                  : M.paused(t, p)
                    ? '<p class="muted">本轮已暂停，无需打卡</p>'
                    : '<p class="muted">本轮未提交成果</p>';
            return [
              `<section class="round" data-round="${escapeHTML(p.key)}">`,
              `<div class="roundTitle">`,
              `<strong>`,
              `${escapeHTML(M.scheduleLabel(t, p))}</strong>`,
              `${badge(s)}</div>`,
              `${t.kind === 'recurring' && M.roundNote(t, p.key) ? '<p class="muted periodNote">' + periodNoteName(t) + '：' + escapeHTML(M.roundNote(t, p.key)) + '</p>' : ''}${body}${role === 'teacher' && t.kind === 'recurring' && canEditRoundNotes() ? '<div class="actions roundNoteActions"><button data-period-note="' + escapeHTML(p.key) + '">编辑' + periodNoteName(t) + '</button></div>' : ''}</section>`,
            ].join('');
          })
          .join('') || '<p class="empty">暂无符合所选状态的记录。</p>'
      }${visibleRounds.length > shown ? '<button id="moreRounds">显示更多记录</button>' : ''}`,
    ].join(''),
  );
}
function showForm(id) {
  editing = id || null;
  const t = tasks.find((x) => x.id === id);
  editingRevision = t?.revision ?? null;
  if (t && !M.canManage(t, role)) return;
  if (typeof Cloud !== 'undefined' && !cloudFeatures.semesters) {
    toast('请先更新 v1.5.1 云端接口，再发布或修改作业');
    return;
  }
  $('taskForm').reset();
  groupUI.reset('formAssignmentGroup', t?.assignmentGroupId || '');
  $('assignmentGroupField').innerHTML = groupUI.html(
    'formAssignmentGroup',
    t?.assignmentGroupId || '',
  );
  $('requiresTeaching').value = t ? String(t.requiresTeaching === true) : '';
  $('teacherTaskFields').classList.toggle('hidden', role !== 'teacher');
  $('taskNote').value = t?.note || '';
  $('periodNote').value = t?.kind === 'recurring' ? M.roundNote(t, M.period(t, now()).key) : '';
  $('reminderEnabled').checked = !!t?.reminder;
  $('reminderAmount').value = t?.reminder?.amount ?? 1;
  $('reminderUnit').value = t?.reminder?.unit || 'hours';
  updateReminderForm();
  $('formError').textContent = '';
  $('formTitle').textContent = t ? '修改作业' : '发布作业';
  if (t) {
    $('name').value = t.name;
    $('subject').value = t.subject || '';
    $('taskSemester').value = t.semester ?? '七年级上学期';
    $('kind').value = t.kind;
    $('rule').value = t.rule || 'week';
    $('format').value = t.format;
    $('enabled').value = String(t.enabled);
    $('deadline').value = t.deadline ? dateText(t.deadline) : '';
  } else $('deadline').value = dateText(now() + M.DAY);
  $('availableFrom').value = dateText(t?.availableFrom ?? t?.created ?? now());
  $('startTime').value = t?.startTime || '00:00';
  $('endTime').value = t?.endTime || '23:59';
  document
    .querySelectorAll('[name=weekDay]')
    .forEach((x) => (x.checked = (t?.weekDays || [6]).includes(Number(x.value))));
  const locked = role !== 'teacher' && !!t && records.some((r) => r.taskId === t.id);
  ['kind', 'rule', 'format'].forEach((x) => ($(x).disabled = locked));
  $('editHint').textContent = locked
    ? '已有成果，作业类型、周期和提交形式已锁定。名称修改不影响旧成果。'
    : '周期作业发布后立即进入本轮，默认无限循环。';
  updateForm();
  $('formDialog').showModal();
}
function updateReminderForm() {
  const on = $('reminderEnabled').checked;
  $('reminderAmount').disabled = !on;
  $('reminderUnit').disabled = !on;
  $('reminderAmount').required = on && role === 'teacher';
}
$('reminderEnabled').addEventListener('change', updateReminderForm);
function updateForm() {
  $('periodNoteCaption').textContent = periodNoteName({ rule: $('rule').value });
  const once = $('kind').value === 'once';
  $('onceRange').classList.toggle('hidden', !once);
  $('recurringRange').classList.toggle('hidden', once);
  $('weekDaysLabel').classList.toggle('hidden', $('rule').value !== 'week');
  $('ruleLabel').classList.toggle('hidden', once);
  $('deadlineLabel').classList.toggle('hidden', !once);
  $('deadline').required = false;
  const autoOption = $('format').querySelector('[value=auto]');
  autoOption.disabled = false;
  $('periodNoteLabel').classList.toggle('hidden', once);
  formRoundKey = once ? null : M.period({ kind: 'recurring', rule: $('rule').value }, now()).key;
  $('periodNote').disabled = !canEditRoundNotes();
  $('periodNoteHint').textContent = canEditRoundNotes()
    ? formRoundKey
      ? '适用完成时间：' +
        M.scheduleLabel(
          { kind: 'recurring', rule: $('rule').value },
          M.period({ kind: 'recurring', rule: $('rule').value }, now()),
        )
      : ''
    : '周期备注尚未启用，请更新云端接口';
}
function showSubmission(key) {
  const t = tasks.find((x) => x.id === selected);
  if (!t) return; /* @runtime-begin submission-context */
  submitting = { taskId: t.id, key, revision: t.revision };
  /* @runtime-end submission-context */ $('submitForm').reset();
  colorSelect('selfScore');
  $('submitError').textContent = '';
  $('fileInfo').textContent = '';
  $('submitTitle').textContent = t.name;
  $('submitInfo').textContent =
    '提交形式：' + formatText(t.format) + '；提交时间以确认保存时为准。';
  $('textLabel').classList.toggle('hidden', t.format !== 'text');
  $('imageLabel').classList.toggle('hidden', t.format !== 'image');
  $('attachmentLabel').classList.toggle('hidden', t.format !== 'file');
  $('submitDialog').showModal();
}
async function exportBackup() {
  const images = async (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  const out = [];
  for (const r of records) {
    const copy = { ...r, images: [] };
    for (const im of r.images) copy.images.push({ name: im.name, data: await images(im.blob) });
    out.push(copy);
  }
  const blob = new Blob(
    [
      JSON.stringify({
        version: 2,
        exported: new Date().toISOString(),
        tasks,
        records: out,
        assignmentGroups,
      }),
    ],
    { type: 'application/json' },
  );
  download(blob, '伴学记录备份-' + M.input(Date.now()).replace(/[:T]/g, '-') + '.json');
}
function download(blob, name) {
  if (typeof AndroidPhotos !== 'undefined') return AndroidPhotos.save(blob, name);
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (![1, 2].includes(data.version) || !Array.isArray(data.tasks) || !Array.isArray(data.records))
    throw Error('不是有效的本程序备份');
  const ids = new Set();
  const restoredGroups = data.assignmentGroups || [];
  if (!Array.isArray(restoredGroups)) throw Error('备份作业数据无效');
  const groupIds = new Set();
  for (const group of restoredGroups) {
    AssignmentGroups.validate(group, M.SUBJECTS, M.SEMESTERS);
    if (groupIds.has(group.id)) throw Error('备份作业编号重复');
    groupIds.add(group.id);
  }
  for (const t of data.tasks) {
    t.assignmentGroupId = AssignmentGroups.association(t.assignmentGroupId, null, restoredGroups);
    M.validateTask(t, { allowLegacySubject: true });
    if (
      typeof t.id !== 'string' ||
      ids.has(t.id) ||
      !Number.isFinite(t.created) ||
      typeof t.enabled !== 'boolean'
    )
      throw Error('备份作业数据无效');
    ids.add(t.id);
    t.revision = Number.isFinite(t.revision) ? t.revision : 1;
  }
  const rids = new Set();
  for (const r of data.records) {
    if (r.selfScore != null) M.validateScore(r.selfScore);
    if (r.teacherScore != null) M.validateScore(r.teacherScore);
    if (
      !ids.has(r.taskId) ||
      typeof r.round !== 'string' ||
      r.id !== r.taskId + '|' + r.round ||
      rids.has(r.id) ||
      !['text', 'image'].includes(r.format) ||
      typeof r.text !== 'string' ||
      !Number.isFinite(r.completed) ||
      !Array.isArray(r.images)
    )
      throw Error('备份成果数据无效');
    rids.add(r.id);
    for (const im of r.images) {
      if (typeof im.data !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(im.data))
        throw Error('备份图片数据无效');
      const [prefix, b64] = im.data.split(',');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      im.blob = new Blob([bytes], { type: prefix.slice(5, prefix.indexOf(';')) });
      delete im.data;
    }
  }
  if (
    !confirm(
      `恢复备份会替换当前浏览器中的全部数据。备份含 ${data.tasks.length} 个作业、${data.records.length} 份成果。是否继续？建议先导出当前数据。`,
    )
  )
    return false;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['tasks', 'records', 'preferences'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || Error('恢复失败，原数据未改变'));
    tx.onerror = () => {};
    tx.objectStore('tasks').clear();
    tx.objectStore('records').clear();
    data.tasks.forEach((t) => tx.objectStore('tasks').put(t));
    tx.objectStore('preferences').put({
      id: 'assignment-groups',
      groups: restoredGroups,
      revision: 1,
    });
    data.records.forEach((r) => tx.objectStore('records').add(r));
  });
  return true;
}
document.addEventListener('click', async (e) => {
  const el = e.target.closest('button,[data-photo]');
  if (!el) return;
  try {
    if (el.dataset.close) {
      if (
        busy &&
        [
          'roundNoteDialog',
          'submitDialog',
          'formDialog',
          'gradeDialog',
          'libraryDialog',
          'folderDialog',
        ].includes(el.dataset.close)
      )
        return;
      $(el.dataset.close).close();
      return;
    }
    if (el.dataset.weekdays) {
      const t = tasks.find((t) => t.id === el.dataset.weekdays);
      if (!t || t.deletedAt) return;
      weekDaysEditing = t;
      document.getElementById('weekDaysEdit').innerHTML = ['一', '二', '三', '四', '五', '六', '日']
        .map(
          (d, i) =>
            '<label><input name="editWeekDay" type="checkbox" value="' +
            i +
            '" ' +
            ((t.weekDays || [6]).includes(i) ? 'checked' : '') +
            '>周' +
            d +
            '</label>',
        )
        .join('');
      $('weekDaysError').textContent = '';
      $('weekDaysDialog').showModal();
      return;
    }
    if (el.dataset.role) {
      role = el.dataset.role;
      saveDevice('c9-last-role', role);
      tab = 'tasks';
      await refresh();
      return;
    }
    if (el.id === 'switchRole') {
      role = null;
      render();
      return;
    }
    if (el.dataset.tab) {
      tab = el.dataset.tab;
      render();
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    if (el.dataset.calendarView) {
      taskView = el.dataset.calendarView;
      saveDevice('c9-task-view', taskView);
      render();
      return;
    }
    if (el.dataset.calendarDay) {
      calendarDate = el.dataset.calendarDay;
      render();
      return;
    }
    if (el.dataset.calendarMove) {
      moveCalendar(Number(el.dataset.calendarMove));
      render();
      return;
    }
    if (el.id === 'calendarToday') {
      calendarDate = StudyModel.dateLabel(now());
      render();
      return;
    }
    if (el.dataset.recordDetail) {
      const r = records.find((r) => r.id === el.dataset.recordDetail);
      if (!r || !canViewTask(tasks.find((t) => t.id === r.taskId))) return;
      selected = r.taskId;
      shown = Math.max(
        30,
        M.history(
          tasks.find((t) => t.id === selected),
          now(),
        ).length,
      );
      StudyUI.beginTask();
      renderDetail();
      $('detailDialog').showModal();
      [...$('detailBody').querySelectorAll('[data-round]')]
        .find((el) => el.dataset.round === r.round)
        ?.scrollIntoView({ block: 'start' });
      return;
    }
    if (el.dataset.pauseRound) {
      if (role !== 'teacher') return;
      const t = tasks.find((x) => x.id === el.dataset.pauseRound);
      if (!t) return;
      if (!cloudFeatures.roundPause) {
        toast('请先更新 v1.5.1 云端接口');
        return;
      }
      const round = M.period(t, now()),
        paused = !M.paused(t, round);
      if (typeof Cloud !== 'undefined')
        await Cloud.request('/api/tasks/pause', {
          method: 'POST',
          role,
          body: { taskId: t.id, round: round.key, expected: t.revision, paused },
        });
      else {
        const values = new Set(t.pausedRounds || []);
        if (paused) values.add(round.key);
        else values.delete(round.key);
        await writeTask({ ...t, pausedRounds: [...values] }, t.revision);
      }
      await refresh();
      toast(paused ? '本轮已暂停，下一轮自动恢复' : '本轮已恢复');
      return;
    }
    if (el.id === 'newAssignmentGroup') {
      groupUI.publish();
      return;
    }
    if (el.id === 'newTask') {
      showForm();
      return;
    }
    if (['backup', 'restore', 'testToggle', 'applyTime', 'realTime'].includes(el.id) && !TEST_MODE)
      return;
    if (el.id === 'clearFilters') {
      searchName = '';
      searchSubject = '';
      searchAssignmentGroup = '';
      groupUI.reset('historyGroup');
      searchSemesters = [];
      render();
      return;
    }
    if (el.id === 'backup') {
      el.disabled = true;
      await refresh();
      await exportBackup();
      toast('备份已导出，包含图片与文字');
      return;
    }
    if (el.id === 'restore') {
      $('restoreFile').click();
      return;
    }
    if (el.id === 'testToggle') {
      const p = $('testPanel');
      p.classList.toggle('hidden');
      return;
    }
    if (el.id === 'applyTime') {
      testTime = M.parse($('testInput').value);
      if (testTime == null) throw Error('请选择测试时间');
      await refresh();
      return;
    }
    if (el.id === 'realTime') {
      testTime = null;
      await refresh();
      return;
    }
    if (el.dataset.detail) {
      if (!canViewTask(tasks.find((t) => t.id === el.dataset.detail))) return;
      selected = el.dataset.detail;
      shown = 30;
      StudyUI.beginTask();
      renderDetail();
      $('detailDialog').showModal();
      return;
    }
    if (el.dataset.edit) {
      const t = tasks.find((t) => t.id === el.dataset.edit);
      if (t && M.canManage(t, role)) showForm(el.dataset.edit);
      return;
    }
    if (el.dataset.toggle || el.dataset.delete) {
      const t = tasks.find((x) => x.id === (el.dataset.toggle || el.dataset.delete));
      if (!t || !M.canManage(t, role)) return;
      if (
        el.dataset.delete &&
        !confirm('删除作业？已提交的成果会永久保留，可在“发布历史与成果”查看。')
      )
        return;
      const next = { ...t };
      if (el.dataset.delete) next.deletedAt = now();
      else next.enabled = !next.enabled;
      await writeTask(next, t.revision);
      await refresh();
      toast(el.dataset.delete ? '作业已删除，成果已保留' : '作业状态已更新');
      return;
    }
    if (el.dataset.periodNote) {
      editRoundNote(el.dataset.periodNote);
      return;
    }
    if (el.dataset.grade) {
      showGrade(el.dataset.grade);
      return;
    }
    if (el.dataset.submit) {
      showSubmission(el.dataset.submit);
      return;
    }
    if (el.id === 'moreRounds') {
      shown += 30;
      renderDetail();
      return;
    }
    if (el.dataset.photo) {
      showHomeworkPhoto(el.dataset.photo, Number(el.dataset.index));
      return;
    }
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    if (el.id === 'backup') el.disabled = false;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'historySearch') {
    searchName = e.target.value;
    $('historyResults').innerHTML = historyResults();
    updateHistoryFilterStyles();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.closest('#historySemesters')) {
    searchSemesters = selectedSemesters('historySemesters');
    $('historyResults').innerHTML = historyResults();
    updateHistoryFilterStyles();
    e.target.closest('details').querySelector('summary').innerHTML =
      semesterSummary(searchSemesters);
  }
  if (e.target.id === 'historySubject') {
    searchSubject = e.target.value;
    $('historyResults').innerHTML = historyResults();
    updateHistoryFilterStyles();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'calendarDate' && StudyModel.date(e.target.value) != null) {
    calendarDate = e.target.value;
    render();
  }
});
$('kind').addEventListener('change', updateForm);
$('rule').addEventListener('change', updateForm);
$('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy || !role) return;
  busy = true;
  $('publishButton').disabled = true;
  try {
    const old = tasks.find((x) => x.id === editing);
    if (editing && (!old || old.revision !== editingRevision))
      throw Error('作业已更新，请关闭后重新打开编辑');
    const task = {
      ...(old || {}),
      id: old?.id || uid(),
      name: $('name').value.trim(),
      assignmentGroupId: groupUI.value('formAssignmentGroup'),
      subject: $('subject').value,
      semester: $('taskSemester').value,
      requiresTeaching: $('requiresTeaching').value === 'true',
      createdBy: old?.createdBy || (old ? 'teacher' : role),
      kind: $('kind').value,
      rule: $('kind').value === 'recurring' ? $('rule').value : null,
      format: $('format').value,
      deadline:
        $('kind').value === 'once'
          ? M.parse(
              $('deadline').value ||
                dateText(Math.max(now(), M.parse($('availableFrom').value) || 0) + M.DAY),
            ) +
            M.DAY -
            1
          : null,
      dateOnly: true,
      availableFrom:
        $('kind').value === 'once'
          ? $('availableFrom').value
            ? M.parse($('availableFrom').value)
            : null
          : null,
      startTime: null,
      endTime: null,
      weekDays:
        $('kind').value === 'recurring' && $('rule').value === 'week'
          ? [...document.querySelectorAll('[name=weekDay]:checked')].map((x) => Number(x.value))
              .length
            ? [...document.querySelectorAll('[name=weekDay]:checked')].map((x) => Number(x.value))
            : null
          : null,
      enabled: $('enabled').value === 'true',
      disabledAt:
        $('enabled').value === 'true'
          ? null
          : old?.enabled === false
            ? old.disabledAt || old.updated || now()
            : now(),
      created: old?.created || now(),
      updated: now(),
    };
    if (role === 'teacher') {
      task.note = $('taskNote').value.trim();
      if (task.kind === 'recurring' && canEditRoundNotes())
        task.roundNote = { round: formRoundKey, text: $('periodNote').value };
      task.reminder = $('reminderEnabled').checked
        ? MyModel.reminder({
            amount: Number($('reminderAmount').value),
            unit: $('reminderUnit').value,
          })
        : null;
    }
    M.validateTask(task, { requireSemester: true });
    if (old && (old.kind !== task.kind || old.rule !== task.rule)) task.created = now();
    await writeTask(task, old?.revision);
    $('formDialog').close();
    await refresh();
    toast(old ? '修改已保存' : '作业发布成功');
  } catch (err) {
    $('formError').textContent = err.message;
  } finally {
    busy = false;
    $('publishButton').disabled = false;
  }
});
$('resultFiles').addEventListener('change', () => {
  $('fileInfo').textContent = '已选择 ' + $('resultFiles').files.length + ' 个文件';
});
$('resultImages').addEventListener('change', () => {
  $('fileInfo').textContent = `已选择 ${$('resultImages').files.length} 张图片`;
});
$('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy || role !== 'student') return;
  busy = true;
  $('submitButton').disabled = true;
  $('submitButton').textContent = '正在保存…';
  try {
    const t = tasks.find((x) => x.id === submitting.taskId);
    const images = [
      ...(t.format === 'file' ? $('resultFiles').files : $('resultImages').files),
    ].map((f) => ({ name: f.name, blob: f, contentType: f.type || 'application/octet-stream' }));
    if (t.format === 'image' && images.some((i) => !i.blob.type.startsWith('image/')))
      throw Error('请选择图片文件');
    const r = M.submission(
      t,
      submitting.key,
      now(),
      $('resultText').value,
      images,
      $('selfScore').value === '' ? null : Number($('selfScore').value),
    );
    if (t.kind === 'once' && recordFor(t, { key: r.round }))
      throw Error('此轮已经提交，不能重复提交或修改');
    if (t.kind === 'recurring') r.id = t.id + '|' + r.round + '|' + uid();
    await writeRecord(r, submitting.revision);
    $('submitDialog').close();
    await refresh();
    toast(
      r.late && r.kind === 'recurring'
        ? '补交成功，已标记紫色'
        : r.late
          ? '提交成功，已标记逾期完成'
          : '提交成功，作业已变绿',
    );
  } catch (err) {
    $('submitError').textContent =
      err.name === 'QuotaExceededError'
        ? '本地存储空间不足，成果尚未保存。请导出备份并释放设备空间后重试。'
        : err.message;
  } finally {
    busy = false;
    $('submitButton').disabled = false;
    $('submitButton').textContent = '确认提交';
  }
});
$('restoreFile').addEventListener('change', async () => {
  if (!TEST_MODE) return;
  const file = $('restoreFile').files[0];
  if (!file) return;
  try {
    if (await restoreBackup(file)) {
      selected = null;
      $('detailDialog').close();
      await refresh();
      toast('备份已恢复');
    }
  } catch (err) {
    toast('恢复失败：' + err.message);
  } finally {
    $('restoreFile').value = '';
  }
});
['formDialog', 'submitDialog', 'gradeDialog'].forEach((id) =>
  $(id).addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  }),
);
$('detailDialog').addEventListener('close', () => {
  if (!$('photoDialog').open) releasePhotos();
});
/* @runtime-begin startup */
(async () => {
  try {
    db = await openDB();
    const remembered = readDevice('c9-last-role', '');
    if (['teacher', 'student'].includes(remembered)) role = remembered;
    await refresh();
  } catch (e) {
    $('app').innerHTML =
      '<div class="card"><h2>无法打开本地存储</h2><p>' +
      escapeHTML(e.message) +
      '</p><p>请使用普通模式的 Microsoft Edge 或 Chrome 打开本程序，允许本地数据存储。</p></div>';
  }
})();
/* @runtime-end startup */

['selfScore', 'teacherScore'].forEach((id) =>
  $(id).addEventListener('change', () => colorSelect(id)),
);
$('gradeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy || role !== 'teacher' || !grading) return;
  busy = true;
  $('gradeButton').disabled = true;
  try {
    const value = $('teacherScore').value;
    if (value === '') throw Error('请选择老师评分');
    await saveGrade(grading.id, Number(value), grading.revision);
    $('gradeDialog').close();
    await refresh();
    toast('老师评分已保存，双方均可查看');
  } catch (err) {
    $('gradeError').textContent = err.message;
  } finally {
    busy = false;
    $('gradeButton').disabled = false;
  }
});

window.addEventListener('storage', (e) => {
  if (e.key === 'c9-device-motto') {
    motto = e.newValue || DEFAULT_MOTTO;
    $('appSubtitle').textContent = motto;
  }
});

window.addEventListener('storage', (e) => {
  if (
    e.key === 'c9-data-changed' &&
    db &&
    !busy &&
    !MyUI.editing &&
    !document.querySelector('dialog[open]') &&
    !TaskOrdering.active
  )
    refresh().catch((err) => toast(err.message));
});
/* @runtime-begin update */
$('checkUpdate').addEventListener('click', () =>
  toast('当前为 v2.0 本机测试版，测试完成后再接入在线更新。'),
);
/* @runtime-end update */
/* @runtime-begin connection */
$('connectionSettings').addEventListener('click', () => {
  $('localConnectionDialog').showModal();
});
/* @runtime-end connection */

function canEditRoundNotes() {
  return typeof Cloud === 'undefined' || cloudFeatures.roundNotes === true;
}
function editRoundNote(key) {
  if (role !== 'teacher' || !canEditRoundNotes()) return;
  const task = tasks.find((t) => t.id === selected);
  if (!task || task.kind !== 'recurring') return;
  roundNoteDraft = { taskId: task.id, round: key, expected: task.revision };
  $('roundNoteCaption').textContent = periodNoteName(task);
  $('roundNoteText').value = M.roundNote(task, key);
  $('roundNoteTitle').textContent = task.name;
  $('roundNoteError').textContent = '';
  $('roundNoteDialog').showModal();
}
async function saveRoundNote(draft, text) {
  if (role !== 'teacher') throw Error('只有老师可以修改本周期备注');
  if (typeof Cloud !== 'undefined')
    return Cloud.request('/api/tasks/round-note', {
      method: 'POST',
      role,
      body: { ...draft, text },
    });
  const current = tasks.find((t) => t.id === draft.taskId);
  if (!current) throw Error('作业不存在');
  return writeTask({ ...current, roundNote: { round: draft.round, text } }, draft.expected);
}
$('roundNoteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  busy = true;
  $('saveRoundNote').disabled = true;
  try {
    await saveRoundNote(roundNoteDraft, $('roundNoteText').value);
    $('roundNoteDialog').close();
    await refresh();
    toast('本周期备注已保存');
  } catch (err) {
    $('roundNoteError').textContent = err.message;
  } finally {
    busy = false;
    $('saveRoundNote').disabled = false;
  }
});
$('roundNoteDialog').addEventListener('cancel', (e) => {
  if (busy) e.preventDefault();
});
function showHomeworkPhoto(recordId, index) {
  const r = records.find((r) => r.id === recordId);
  if (!r || !canViewTask(tasks.find((t) => t.id === r.taskId)) || !r.images.length) return;
  photoZoom?.destroy();
  photoZoom = null;
  const im = r.images[Math.max(0, Math.min(index, r.images.length - 1))];
  photoRecordId = r.id;
  photoIndex = Math.max(0, Math.min(index, r.images.length - 1));
  if (photoOwnUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(photoOwnUrl);
    photoUrls = photoUrls.filter((u) => u !== photoOwnUrl);
  } /* @runtime-begin photo */
  const u = URL.createObjectURL(im.blob);
  photoUrls.push(u);
  $('largePhoto').src = u;
  $('downloadPhoto').href = u;
  $('downloadPhoto').download = im.name || '成果图片.jpg';
  /* @runtime-end photo */ photoOwnUrl = $('largePhoto').src;
  $('downloadPhoto').classList.toggle('hidden', role !== 'teacher');
  $('homeworkPhotoCount').textContent = photoIndex + 1 + ' / ' + r.images.length;
  $('previousHomeworkPhoto').disabled = photoIndex === 0;
  $('nextHomeworkPhoto').disabled = photoIndex === r.images.length - 1;
  if (!$('photoDialog').open) $('photoDialog').showModal();
  photoZoom = ImageZoom.attach($('homeworkPhotoStage'), $('largePhoto'), $('photoZoomControls'));
}
function moveHomeworkPhoto(delta) {
  const r = records.find((r) => r.id === photoRecordId);
  if (r && photoIndex + delta >= 0 && photoIndex + delta < r.images.length)
    showHomeworkPhoto(r.id, photoIndex + delta);
}
$('previousHomeworkPhoto').addEventListener('click', () => moveHomeworkPhoto(-1));
$('nextHomeworkPhoto').addEventListener('click', () => moveHomeworkPhoto(1));
$('photoDialog').addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    moveHomeworkPhoto(['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1);
  }
});
$('homeworkPhotoStage').addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) {
    photoGesture = null;
    return;
  }
  if (e.button !== 0) return;
  photoGesture = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
$('homeworkPhotoStage').addEventListener('pointerup', (e) => {
  if (!photoGesture || e.pointerId !== photoGesture.id) return;
  const dx = e.clientX - photoGesture.x,
    dy = e.clientY - photoGesture.y;
  photoGesture = null;
  if (photoZoom?.scale > 1) return;
  const distance = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  if (Math.abs(distance) >= 50) moveHomeworkPhoto(distance < 0 ? 1 : -1);
});
$('homeworkPhotoStage').addEventListener('pointercancel', () => {
  photoGesture = null;
});
$('photoDialog').addEventListener('close', () => {
  photoZoom?.destroy();
  photoZoom = null;
  if (photoOwnUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(photoOwnUrl);
    photoUrls = photoUrls.filter((u) => u !== photoOwnUrl);
  }
  photoOwnUrl = null;
  photoRecordId = null;
  photoGesture = null;
});

$('weekDaysForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  busy = true;
  try {
    await saveWeekDays(
      weekDaysEditing,
      [...document.querySelectorAll('[name=editWeekDay]:checked')].map((x) => Number(x.value)),
    );
    $('weekDaysDialog').close();
    await refresh();
    toast('完成星期已更新');
  } catch (e) {
    $('weekDaysError').textContent = e.message;
  } finally {
    busy = false;
  }
});

function openWidgetToday() {
  if (typeof C9Android !== 'undefined' && C9Android.consumeWidgetOpen?.()) {
    tab = 'tasks';
    taskView = 'day';
    const requested = C9Android.widgetOpenDate?.() || '';
    calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : dayLabel(now());
    render();
  }
}
document.addEventListener('c9-widget-open', openWidgetToday);

document.addEventListener('change', (e) => {
  if (e.target.id === 'roundCompletionFilter') {
    StudyUI.state.task.completion = e.target.value;
    StudyUI.state.task.completionChosen = true;
    shown = 30;
    renderDetail();
  }
});

// Semester menus behave like a dropdown while retaining multiple selections.
document.addEventListener('click', (e) => {
  document.querySelectorAll('.semesterDropdown[open]').forEach((menu) => {
    if (!menu.contains(e.target)) menu.open = false;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape')
    document.querySelectorAll('.semesterDropdown[open]').forEach((menu) => (menu.open = false));
});
