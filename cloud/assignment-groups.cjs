'use strict';
const G = require('./assignment-groups.js');
const TASK_ID = '__c9_assignment_groups__';
function createAssignmentGroups(store, clock, M, fail) {
  const read = () => store.getRecord(TASK_ID, 'catalog');
  const list = async () => (await read())?.groups || [];
  async function publish(body, who) {
    if (!['teacher', 'student'].includes(who)) fail(403, '请选择学生或老师身份');
    let value;
    try {
      value = G.validate(body.group, M.SUBJECTS, M.SEMESTERS);
    } catch (e) {
      fail(400, e.message);
    }
    const group = { ...value, createdBy: who, created: clock() };
    for (let attempt = 0; attempt < 5; attempt++) {
      const old = await read();
      if (old?.groups.some((x) => x.id === group.id)) fail(409, '任务编号已存在，请重新发布');
      try {
        await store.putRecord(
          {
            taskId: TASK_ID,
            round: 'catalog',
            groups: [...(old?.groups || []), group],
            gradeRevision: (old?.gradeRevision || 0) + 1,
          },
          old?.gradeRevision ?? null,
        );
        return group;
      } catch (e) {
        if (e.status !== 409 || attempt === 4) throw e;
      }
    }
  }
  async function association(input, previous) {
    try {
      return G.association(input, previous, input == null && previous == null ? [] : await list());
    } catch (e) {
      fail(400, e.message);
    }
  }
  return { list, publish, association };
}
module.exports = { createAssignmentGroups };
