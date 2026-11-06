async function saveGrade(id, score, expected) {
  if (role !== 'teacher') throw Error('只有老师可以评分');
  const r = records.find((x) => x.id === id);
  if (!r) throw Error('成果记录不存在');
  await Cloud.request('/api/grades', {
    method: 'POST',
    role,
    body: { taskId: r.taskId, round: r.round, recordKey: r.recordKey || r.round, score, expected },
  });
}
