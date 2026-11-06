const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../model.js');
const M = global.TaskModel;
const TaskViews = require('../task-views.js');

test('拆分后的任务卡片、历史及四种日期视图与原版输出一致，并读取最新角色和筛选', () => {
  const time = M.parse('2026-11-05T12:00');
  const context = {
    M,
    time,
    tasks: [],
    records: [],
    role: 'student',
    taskView: 'agenda',
    calendarDate: null,
    searchName: '',
    searchSubject: '',
    searchSemesters: [],
    TaskOrdering: { controls: () => '', card: () => '', actions: () => '' },
    now: () => context.time,
    dayStart: (value) => M.parse(value),
    dayLabel: (value) => M.input(value).slice(0, 10),
    escapeHTML: (value) =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('"', '&quot;'),
    scoreHTML: (record) => (record ? 'score:' + record.selfScore : ''),
    badge: (value) => '<span>' + value.label + '</span>',
    kindText: (task) => task.kind,
    formatText: (value) => value,
    dateText: (value) => (value == null ? '未设置' : M.input(value).slice(0, 10)),
    periodNoteName: (task) => ({ day: '本日备注', week: '本周备注', month: '本月备注' })[task.rule],
    canViewTask: (task) => context.role === 'teacher' || !task.deletedAt,
    recordFor: (task, period) =>
      context.records.filter((r) => r.taskId === task.id && r.round === period.key).at(-1),
    pendingOn: (tasks, value) => M.calendarPending(tasks, context.records, M.parse(value)),
    completedOn: (value) =>
      M.calendarRecords(context.tasks, context.records, M.parse(value), context.role),
  };
  context.tasks = Array.from({ length: 12 }, (_, index) => ({
    id: 'view-' + index,
    name: '合成任务<' + index + '>',
    subject: index % 2 ? '数学' : '语文',
    semester: index % 3 ? '七年级上学期' : '',
    kind: index % 4 ? 'recurring' : 'once',
    rule: ['day', 'week', 'month'][index % 3],
    format: index % 2 ? 'image' : 'text',
    enabled: index % 5 !== 0,
    created: time - 10 * M.DAY,
    deadline: time + M.DAY,
    dateOnly: true,
    weekDays: [0, 6],
    createdBy: index % 2 ? 'teacher' : 'student',
    requiresTeaching: index % 3 === 0,
    note: '任务备注<' + index + '>',
    roundNotes: {},
    pausedRounds: [],
    deletedAt: index === 11 ? time : null,
  }));
  for (const [index, task] of context.tasks.entries()) {
    const period = M.period(task, time);
    task.roundNotes[period.key] = '轮次备注' + index;
    if (index % 2)
      context.records.push({
        id: task.id + '|one',
        taskId: task.id,
        taskName: task.name,
        round: period.key,
        completed: time - 1000,
        late: index % 3 === 0,
        selfScore: 8,
      });
  }
  const baseline = vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'fixtures/task-views-before-readability.js'), 'utf8'),
    baseline,
  );
  const views = TaskViews.create(() => context);
  let cases = 0;
  for (const role of ['student', 'teacher'])
    for (const mode of ['agenda', 'day', 'week', 'month']) {
      context.role = role;
      context.taskView = mode;
      for (const date of ['2026-11-05', '2026-12-31', '2027-01-01']) {
        context.calendarDate = date;
        for (const task of context.tasks) {
          assert.equal(views.taskCard(task), baseline.taskCard(task));
          cases++;
        }
        assert.equal(
          views.calendarPage(context.tasks, '日程正文'),
          baseline.calendarPage(context.tasks, '日程正文'),
        );
        for (const search of ['', '合成任务', '不存在']) {
          context.searchName = search;
          context.searchSemesters = search ? ['七年级上学期'] : [];
          assert.equal(views.historyResults(), baseline.historyResults());
          cases++;
        }
      }
    }
  console.log(JSON.stringify({ taskViewCompatibilityCases: cases }));
});
