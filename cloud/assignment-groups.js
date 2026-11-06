(function (scope) {
  'use strict';
  const ID = /^[-a-zA-Z0-9_]{1,100}$/;
  function validate(group, subjects, semesters) {
    if (!group || !ID.test(group.id || '')) throw Error('任务编号无效');
    if (typeof group.name !== 'string' || !group.name.trim()) throw Error('请输入任务名称');
    const subject = group.subject ?? '',
      semester = group.semester ?? '';
    if (subject !== '' && !subjects.includes(subject)) throw Error('请选择有效的任务所属学科');
    if (semester !== '' && !semesters.includes(semester)) throw Error('请选择有效的任务所属学期');
    return {
      id: group.id,
      name: group.name.trim(),
      subject,
      semester,
    };
  }
  function filter(groups, query = '') {
    const keyword = query.trim().toLocaleLowerCase();
    return groups.filter((group) => group.name.toLocaleLowerCase().includes(keyword));
  }
  function association(input, previous, groups) {
    const value = input === undefined ? (previous ?? null) : input;
    if (value === null) return null;
    if (typeof value !== 'string' || !ID.test(value) || !groups.some((group) => group.id === value))
      throw Error('关联任务不存在，请刷新后重新选择');
    return value;
  }
  function matches(assignment, selected) {
    return (
      selected === '' ||
      (selected === '__unlinked__'
        ? !assignment.assignmentGroupId
        : assignment.assignmentGroupId === selected)
    );
  }
  const api = { validate, filter, association, matches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.AssignmentGroups = api;
})(globalThis);
