async function writeLibrary(entry, expected) {
  if (entry.type === 'exam' && !cloudFeatures.optionalExam)
    throw Error('请先部署内部33云端接口，再保存新版试卷');
  return Cloud.request('/api/library/save', { method: 'POST', role, body: { entry, expected } });
}
