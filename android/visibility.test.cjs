'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  vm = require('node:vm');
async function fixture() {
  const elements = new Map(),
    listeners = new Map();
  const el = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        open: false,
        innerHTML: '',
        textContent: '',
        value: '',
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        setAttribute() {},
        closest() {
          return this;
        },
        querySelector() {
          return this;
        },
        querySelectorAll() {
          return [];
        },
        reset() {},
        removeAttribute(name) {
          delete this[name];
        },
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    AssignmentGroups: require('../assignment-groups.js'),
    AssignmentGroupsUI: { create: () => ({ html: () => '', reset() {}, value: () => null }) },
    MyUI: {
      unread() {
        return 0;
      },
      set() {},
    },
    StudyUI: {
      set() {},
      taskTabs() {
        return '';
      },
      beginTask() {},
      taskMode: 'records',
    },
    window: { addEventListener() {} },
    document: {
      body: { insertAdjacentHTML() {}, append() {} },
      getElementById: el,
      querySelector() {
        return el('header');
      },
      querySelectorAll() {
        return [];
      },
      addEventListener: (name, fn) => {
        const previous = listeners.get(name);
        listeners.set(name, async (event) => {
          if (previous) await previous(event);
          return fn(event);
        });
      },
      activeElement: null,
    },
    setInterval() {},
    setTimeout() {},
    URL,
    Blob,
    console,
  });
  vm.runInContext(
    await fs.readFile(path.join(__dirname, 'build/assets/model.js'), 'utf8'),
    context,
  );
  const time = vm.runInContext('TaskModel.parse("2026-10-10T12:00")', context);
  const tasks = ['正常作业', '停用作业', '已删文字', '已删图片'].map((name, i) => ({
    id: 'task-' + i,
    name,
    subject: i === 2 ? '语文' : '数学',
    kind: 'once',
    deadline: time + 86400000,
    format: i === 3 ? 'image' : 'text',
    enabled: i !== 1,
    created: time - 86400000,
    deletedAt: i > 1 ? time : undefined,
    revision: 1,
  }));
  const records = tasks.map((t) => ({
    id: t.id + '|单次',
    taskId: t.id,
    taskName: t.name,
    round: '单次',
    format: t.format,
    selfScore: 8,
    teacherScore: 9,
    gradeRevision: 1,
    completed: time,
    text: '完成内容-' + t.name,
    images:
      t.format === 'image'
        ? [{ name: '作业.png', url: 'https://example.com/image', uploadId: 'image-1' }]
        : [],
  }));
  context.fixtureTasks = tasks;
  context.fixtureRecords = records;
  context.Cloud = {
    connect: () => new Promise(() => {}),
    time: () => time,
    snapshot: async () => ({
      tasks,
      records,
      features: { my: true, messages: true },
      serverTime: time,
    }),
  };
  let source = await fs.readFile(path.join(__dirname, 'build/assets/app.js'), 'utf8');
  vm.runInContext(
    await fs.readFile(path.join(__dirname, 'build/assets/task-order.js'), 'utf8'),
    context,
  );
  for (const name of ['submission-views.js', 'grade-flow.js', 'task-views.js']) {
    vm.runInContext(await fs.readFile(path.join(__dirname, 'build/assets', name), 'utf8'), context);
  }
  vm.runInContext(source, context);
  vm.runInContext(
    "StudyUI.state={task:{completion:'all'}};syncMarkup=(target,html)=>{target.innerHTML=html;};tasks=fixtureTasks;records=fixtureRecords;db={cloud:true};",
    context,
  );
  return { context, el, listeners, tasks, records };
}
test('students cannot see deleted tasks through history, filters or counts; teachers retain records and scores', async () => {
  const f = await fixture();
  vm.runInContext('role="student";tab="history";render();', f.context);
  let page = f.el('app').innerHTML;
  assert(page.includes('正常作业'));
  assert(page.includes('停用作业'));
  assert(!page.includes('已删文字'));
  assert(!page.includes('已删图片'));
  vm.runInContext('tab="tasks";render();', f.context);
  page = f.el('app').innerHTML;
  assert(page.includes('<strong>2</strong> 份历史成果'));
  let result = vm.runInContext(
    'searchName="已删";searchSubject="语文";historyResults()',
    f.context,
  );
  assert(result.includes('共 0 个作业'));
  result = vm.runInContext('role="teacher";historyResults()', f.context);
  assert(result.includes('已删文字'));
  assert(!result.includes('已删图片'));
  vm.runInContext(
    'searchName="";searchSubject="";render();selected="task-2";renderDetail();',
    f.context,
  );
  assert(f.el('app').innerHTML.includes('<strong>4</strong> 份历史成果'));
  assert(f.el('detailBody').innerHTML.includes('完成内容-已删文字'));
  assert(f.el('detailBody').innerHTML.includes('8 / 10 分'));
  assert(f.el('detailBody').innerHTML.includes('9 / 10 分'));
  vm.runInContext('selected="task-3";renderDetail();', f.context);
  assert(f.el('detailBody').innerHTML.includes('https://example.com/image'));
  assert.equal(f.tasks.length, 4);
  assert.equal(f.records.length, 4);
});
test('stale task links cannot reopen deleted tasks; syncing a deletion closes existing student views', async () => {
  const f = await fixture();
  vm.runInContext('role="student";tab="history";', f.context);
  await f.listeners.get('click')({
    target: { closest: () => ({ dataset: { detail: 'task-2' } }) },
  });
  assert.equal(f.el('detailDialog').open, false);
  vm.runInContext('selected="task-0";', f.context);
  f.el('detailDialog').open = true;
  f.el('photoDialog').open = true;
  f.el('detailBody').innerHTML = '旧内容';
  f.el('largePhoto').src = '旧图片';
  f.tasks[0].deletedAt = f.tasks[2].deletedAt;
  await vm.runInContext('refresh()', f.context);
  assert.equal(f.el('detailDialog').open, false);
  assert.equal(f.el('photoDialog').open, false);
  assert.equal(f.el('detailBody').innerHTML, '');
  assert.equal(f.el('largePhoto').src, undefined);
  assert(!f.el('app').innerHTML.includes('正常作业'));
  assert.equal(f.tasks.length, 4);
  assert.equal(f.records.length, 4);
  vm.runInContext('role="teacher";selected="task-0";renderDetail();', f.context);
  assert(f.el('detailBody').innerHTML.includes('完成内容-正常作业'));
});
