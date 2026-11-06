async function writeTask(task, expected) {
  if (task.assignmentGroupId != null && !cloudFeatures.assignmentGroups) checkGroupCapability();
  if (!task.deletedAt && (!cloudFeatures.optionalTaskFields || !cloudFeatures.courseTasks))
    throw Error('请先部署2.4云端接口（build48），再发布或修改作业');
  if (task.dateOnly && !cloudFeatures.repeatSubmissions) throw Error('请先部署内部33云端接口');
  if (task.format === 'auto' && !cloudFeatures.autoCheckin) throw Error('请先部署内部33云端接口');
  if (
    !cloudFeatures.taskSchedule &&
    (task.availableFrom != null || task.startTime || task.endTime || task.weekDays?.length)
  )
    throw Error('请先部署内部版本26的云端接口，才能保存作业完成时间和星期安排');
  await Cloud.request('/api/tasks', { method: 'POST', role, body: { task, expected } });
}
