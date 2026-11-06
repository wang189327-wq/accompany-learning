(async () => {
  if (globalThis.C9Boot) globalThis.C9Boot.started = true;
  try {
    db = await openDB();
    const remembered = readDevice('c9-last-role', '');
    if (['teacher', 'student'].includes(remembered)) role = remembered;
    openWidgetToday();
    const cached = Cloud.cached();
    if (cached) {
      tasks = cached.tasks;
      records = cached.records;
      cloudFeatures = cached.features || {};
      MyUI.set(cached.preferences || [], cached.messages || []);
      TaskOrdering.set(cached.taskOrders || {});
      StudyUI.set(cached.library || [], true, cached.features);
      render();
      Cloud.showSync('显示上次内容 · 正在同步');
      await refresh().catch((e) => toast(e.message));
    } else await refresh();
  } catch (e) {
    $('app').innerHTML =
      '<div class="card"><h2>暂时无法连接云端</h2><p>' +
      escapeHTML(e.message) +
      '</p><p>请检查网络和连接设置，配置正确后刷新重试。</p><button id="reconnect">连接设置</button></div>';
  }
})();
