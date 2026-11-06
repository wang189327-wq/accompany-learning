const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../assignment-groups.js');
const groups = [
  { id: 'g1', name: '英语阅读 ABC', subject: '英语', semester: '七年级上学期' },
  { id: 'g2', name: '英语阅读 ABC', subject: '英语', semester: '八年级上学期' },
  { id: 'g3', name: '数学计算', subject: '数学', semester: '七年级上学期' },
];
test('关键词匹配不区分英文大小写，同名返回独立编号，未关联和具体任务精确筛选', () => {
  assert.deepEqual(
    G.filter(groups, 'abc').map((x) => x.id),
    ['g1', 'g2'],
  );
  assert.equal(G.filter(groups, ' 不存在 ').length, 0);
  assert.equal(G.matches({}, '__unlinked__'), true);
  assert.equal(G.matches({ assignmentGroupId: 'g1' }, '__unlinked__'), false);
  assert.equal(G.matches({ assignmentGroupId: 'g2' }, 'g1'), false);
  assert.equal(G.matches({}, ''), true);
  assert.equal(G.association(undefined, 'g1', groups), 'g1');
  assert.equal(G.association(null, 'g1', groups), null);
  assert.throws(() => G.association('missing', null, groups), /不存在/);
});

test('4.0作业档案关联筛选和已有名称、学科、学期条件取交集', () => {
  require('../model.js');
  const M = global.TaskModel;
  const TaskViews = require('../task-views.js');
  const c = {
    M,
    role: 'teacher',
    searchName: '阅读',
    searchSubject: '英语',
    searchSemesters: ['七年级上学期'],
    searchAssignmentGroup: 'g1',
    tasks: [
      {
        id: 'a',
        name: '阅读一',
        assignmentGroupId: 'g1',
        subject: '英语',
        semester: '七年级上学期',
      },
      {
        id: 'b',
        name: '阅读二',
        assignmentGroupId: 'g2',
        subject: '英语',
        semester: '七年级上学期',
      },
      { id: 'c', name: '阅读三', subject: '英语', semester: '七年级上学期' },
    ],
    canViewTask: () => true,
    now: () => Date.now(),
  };
  // A nonmatching group leaves no cards, so rendering never needs unrelated card dependencies.
  c.searchAssignmentGroup = 'missing';
  assert.match(TaskViews.create(() => c).historyResults(), /共 0 个作业/);
  assert.equal(G.filter(groups, '阅读').length, 2);
});
