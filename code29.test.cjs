const assert = require('node:assert/strict'),
  X = require('./my-model.js');
require('./model.js');
const S = require('./study-model.js'),
  M = global.TaskModel;
assert.deepEqual(X.goalSubjects(M.SUBJECTS).slice(-4), ['生物', '体育', '实验', '总分']);
assert.deepEqual(
  X.goals(
    {
      体育: { full: '30.5', score: '29', rank: '2' },
      总分: { full: '760', score: '720', rank: '1' },
    },
    M.SUBJECTS,
  ),
  { 体育: { full: 30.5, score: 29, rank: 2 }, 总分: { full: 760, score: 720, rank: 1 } },
);
let t = {
  headers: ['A', 'B', 'C', 'D'],
  rows: [
    ['a', 'b', 'c', 'd'],
    ['e', 'f', 'g', 'h'],
    ['i', 'j', 'k', 'l'],
    ['m', 'n', 'o', 'p'],
  ],
  merges: [],
  columnWidths: [100, 110, 120, 130],
  rowHeights: [50, 60, 70, 80],
};
X.validateTable(t);
t = X.fill(t, null, true);
t = X.fill(t, { r: 1, c: 1, h: 1, w: 2 }, false);
assert.equal(t.fillColor, X.LIGHT_GREEN);
assert.equal(t.cellFills['1,2'], '#ffffff');
let moved = X.move(t, 'row', 0, 3, 'after');
assert.deepEqual(
  moved.rows.map((r) => r[0]),
  ['e', 'i', 'm', 'a'],
);
assert.deepEqual(moved.rowHeights, [60, 70, 80, 50]);
assert.equal(moved.cellFills['0,1'], '#ffffff');
moved = X.move(t, 'column', 1, 3, 'after');
assert.deepEqual(moved.headers, ['A', 'C', 'D', 'B']);
assert.deepEqual(moved.rows[0], ['a', 'c', 'd', 'b']);
assert.deepEqual(moved.columnWidths, [100, 120, 130, 110]);
assert.equal(moved.cellFills['1,3'], '#ffffff');
assert.deepEqual(t.rows[0], ['a', 'b', 'c', 'd']);
assert.equal(X.insertRow(t, 0).cellFills['2,1'], '#ffffff');
assert.equal(X.insertColumn(t, 0).cellFills['1,2'], '#ffffff');
assert.equal(X.deleteRow(t, 0).cellFills['0,1'], '#ffffff');
assert.equal(X.deleteColumn(t, 0).cellFills['1,0'], '#ffffff');
const nine = X.merge(t, { r: 0, c: 0, h: 3, w: 3 }, 'all');
assert.equal(nine.rows[0][0], 'a\nb\nc\ne\nf\ng\ni\nj\nk');
assert.equal(nine.merges[0].h * nine.merges[0].w, 9);
const block = X.merge(t, { r: 1, c: 0, h: 2, w: 2 }, 'all');
moved = X.move(block, 'row', 1, 3, 'after');
assert.deepEqual(moved.merges[0], { r: 2, c: 0, h: 2, w: 2 });
assert.equal(moved.rows[2][0], block.rows[1][0]);
assert.throws(() => X.move(block, 'row', 0, 1, 'after'), /拆开/);
const columnBlock = X.merge(t, { r: 0, c: 1, h: 2, w: 2 }, 'all');
assert.deepEqual(X.move(columnBlock, 'column', 1, 3, 'after').merges[0], {
  r: 0,
  c: 2,
  h: 2,
  w: 2,
});
assert.throws(() => X.validateTable({ ...t, fillColor: 'red' }));
assert.throws(() => X.validateTable({ ...t, cellFills: { '99,0': X.LIGHT_GREEN } }));
const exam = {
  id: 'test',
  type: 'exam',
  name: '测验',
  subject: '数学',
  semester: '七年级上学期',
  fullScore: 80,
  score: 60,
  rank: 2,
  examDate: Date.now(),
  notes: '无',
  files: [{ name: 'test.pdf', size: 1, contentType: 'application/pdf' }],
};
const valid = S.validate(exam);
assert.equal(valid.fullScore, 80);
assert.equal(S.exams([valid], { base: 100 })[0].plottedScore, 75);
assert.throws(() => S.validate({ ...exam, fullScore: 0 }));
console.log(
  'code29: goals/custom exam scores, 9-cell merge, row/column moves, merged block protection and fill persistence passed',
);
