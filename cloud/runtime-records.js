async function writeRecord(record, taskRevision) {
  if (record.kind === 'recurring' && !cloudFeatures.repeatSubmissions)
    throw Error('请先部署内部33云端接口，再使用重复提交');
  await Cloud.submit(record, taskRevision, submitting);
}
