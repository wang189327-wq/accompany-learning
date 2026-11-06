async function openDB() {
  await Cloud.connect();
  return { cloud: true };
}
async function refresh() {
  const sequence = ++refreshSequence;
  const snapshot = await Cloud.snapshot();
  if (sequence !== refreshSequence) return;
  if (!snapshot.features?.my || !snapshot.features?.messages)
    throw Error('请先部署 v1.6.0 云端接口，再使用新版界面');
  tasks = snapshot.tasks;
  records = snapshot.records;
  cloudFeatures = snapshot.features || {};
  MyUI.set(snapshot.preferences || [], snapshot.messages || []);
  TaskOrdering.set(snapshot.taskOrders || {});
  StudyUI.set(snapshot.library || [], !!snapshot.features?.library, snapshot.features);
  const stamp = JSON.stringify([role, tab, Math.floor(now() / 60000), snapshot], (key, value) =>
    key === 'serverTime' ||
    ((key === 'url' || key === 'thumbnailUrl') && value && typeof value === 'string')
      ? undefined
      : value,
  );
  if (stamp !== lastSyncViewStamp) {
    render();
    lastSyncViewStamp = stamp;
  }
  if ($('detailDialog').open && !$('photoDialog').open) renderDetail();
  if ($('messagesDialog').open) MyUI.showMessages();
}
async function saveMyPreference(value, expected) {
  if (value.id === 'shared' && (!cloudFeatures.goalExtras || !cloudFeatures.tableEditing))
    throw Error('请先部署本次云端接口（build 29），再保存学习目标或录取表格');
  return Cloud.request('/api/preferences/my', { method: 'POST', role, body: { value, expected } });
}
async function markMessagesRead(ids) {
  return Cloud.request('/api/messages/read', { method: 'POST', role, body: { ids } });
}
