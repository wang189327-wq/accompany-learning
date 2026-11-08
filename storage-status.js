'use strict';
const StorageStatus = (() => {
  let latest = null,
    at = 0,
    pending = null,
    scope = '';
  function mount(who) {
    const box = document.getElementById('storageStatus');
    if (!box || typeof Cloud === 'undefined') return;
    box.hidden = false;
    const currentScope = Cloud.storageScope();
    if (scope !== currentScope) {
      latest = null;
      at = 0;
      scope = currentScope;
    }
    const draw = () => {
      if (!latest) {
        box.textContent = '正在检查云端容量…';
        return;
      }
      if (!latest.available) {
        box.style.color = '';
        box.textContent = latest.message || '容量提醒需要部署新版接口';
        return;
      }
      const gb = (latest.bytes / 1000000000).toFixed(2),
        threshold = latest.thresholdBytes / 1000000000;
      box.textContent =
        (latest.exceeded ? '容量提醒：' : '云端存储：') +
        gb +
        ' GB / 提醒值 ' +
        threshold +
        ' GB。' +
        (latest.exceeded ? '已达到提醒值，不限制上传。' : '不限制上传数量。') +
        'OSS统计非实时。' +
        (latest.statisticsAt
          ? '统计时间：' + new Date(latest.statisticsAt).toLocaleString('zh-CN')
          : '');
      box.style.color = latest.exceeded ? '#9b5600' : '';
    };
    draw();
    if (pending || Date.now() - at < 600000) return;
    const requestedScope = scope;
    pending = Cloud.request('/api/storage/status', { role: who })
      .then((value) => {
        if (scope === requestedScope) latest = value;
      })
      .catch(() => {
        if (scope === requestedScope)
          latest = {
            available: false,
            message: '容量提醒暂不可用，请确认已部署新版接口及存储统计权限；上传不受影响',
          };
      })
      .finally(() => {
        pending = null;
        if (scope === requestedScope) {
          at = Date.now();
          draw();
        } else mount(who);
      });
  }
  return { mount };
})();
