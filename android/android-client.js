'use strict';
const AndroidPhotos = (() => {
  let saving = false;
  function decode(result) {
    const value = JSON.parse(result);
    if (value.error) throw Error(value.error);
    return value;
  }
  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(Error('读取图片失败'));
      reader.readAsDataURL(blob);
    });
  }
  async function save(blob, name) {
    if (saving) throw Error('图片正在保存，请稍候');
    if (!globalThis.C9Android) throw Error('请使用安卓应用保存到相册');
    saving = true;
    let id;
    try {
      id = decode(C9Android.beginPhoto(name, blob.type || 'image/jpeg')).id;
      for (let offset = 0; offset < blob.size; offset += 262144)
        decode(C9Android.photoChunk(id, await base64(blob.slice(offset, offset + 262144))));
      decode(C9Android.finishPhoto(id));
      id = null;
      toast('图片已保存到手机相册');
    } finally {
      if (id) C9Android.cancelPhoto(id);
      saving = false;
    }
  }
  async function saveFile(blob, name) {
    if (saving) throw Error('文件正在保存，请稍候');
    if (!globalThis.C9Android) throw Error('请使用安卓应用保存文件');
    saving = true;
    let id;
    try {
      id = decode(C9Android.beginFile(name, blob.type || 'application/octet-stream')).id;
      while (!decode(C9Android.fileState(id)).ready) await new Promise((r) => setTimeout(r, 250));
      for (let offset = 0; offset < blob.size; offset += 262144)
        decode(C9Android.photoChunk(id, await base64(blob.slice(offset, offset + 262144))));
      decode(C9Android.finishFile(id));
      id = null;
      toast('文件已保存到所选位置');
    } finally {
      if (id) C9Android.cancelPhoto(id);
      saving = false;
    }
  }
  return { save, saveFile };
})();
globalThis.C9HandleBack = () => {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  if (dialogs.length) {
    if (typeof AndroidUpdates !== 'undefined' && AndroidUpdates?.working) return true;
    if (typeof busy !== 'undefined' && busy) return true;
    const last = dialogs[dialogs.length - 1];
    if (last.id === 'connectionDialog') return false;
    last.close();
    return true;
  }
  return false;
};

// Native updater is independent of cloud login. No APK download occurs before a user click.
const AndroidUpdates = (() => {
  if (
    typeof document === 'undefined' ||
    !globalThis.C9Android ||
    typeof C9Android.checkUpdate !== 'function'
  )
    return null;
  let checking = false,
    working = false,
    timer = null;
  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog id="updateDialog"><div class="dialogHead"><h3>软件更新</h3><button id="laterUpdate">稍后</button></div><p id="updateVersion"></p><div class="content" id="updateNotes"></div><p id="updateStatus" role="status"></p><button id="downloadUpdate" class="primary">下载更新</button></dialog>',
  );
  const el = (id) => document.getElementById(id),
    message = (text) => {
      if (typeof toast === 'function') toast(text);
      else el('updateStatus').textContent = text;
    };
  function state() {
    return JSON.parse(C9Android.updateState());
  }
  function available(value) {
    el('updateVersion').textContent =
      value.currentName === value.latest.versionName
        ? value.latest.versionName + ' 有新的更新包'
        : '当前 ' + value.currentName + ' → 新版 ' + value.latest.versionName;
    el('updateNotes').textContent = value.latest.notes || '';
    el('updateStatus').textContent = '';
    el('downloadUpdate').disabled = false;
    el('downloadUpdate').textContent = '下载更新';
    if (!el('updateDialog').open) el('updateDialog').showModal();
  }
  async function check(manual = false) {
    if (checking || working) return;
    checking = true;
    C9Android.checkUpdate();
    try {
      let value;
      for (let i = 0; i < 240; i++) {
        value = state();
        if (value.phase !== 'checking') break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (value.phase === 'available') {
        if (!manual && document.querySelector('dialog[open]')) return;
        available(value);
      } else if (manual)
        message(
          value.phase === 'current'
            ? '已是最新版本 ' + value.currentName
            : value.error || '检查更新超时，请稍后重试',
        );
    } catch (e) {
      if (manual) message('暂时无法检查更新，请稍后重试');
    } finally {
      checking = false;
    }
  }
  el('laterUpdate').onclick = () => {
    if (!working) el('updateDialog').close();
  };
  el('updateDialog').addEventListener('cancel', (e) => {
    if (working) e.preventDefault();
  });
  el('downloadUpdate').onclick = () => {
    if (working) return;
    const value = state();
    if (value.phase === 'downloaded' || value.phase === 'permission') {
      C9Android.installUpdate();
      return;
    }
    working = true;
    el('downloadUpdate').disabled = true;
    el('laterUpdate').disabled = true;
    C9Android.downloadUpdate();
    timer = setInterval(() => {
      try {
        const next = state();
        el('updateStatus').textContent =
          next.phase === 'downloading'
            ? '正在下载 ' + Math.round((next.done / Math.max(1, next.total)) * 100) + '%'
            : '正在校验安装包…';
        if (next.phase === 'downloaded') {
          clearInterval(timer);
          working = false;
          el('laterUpdate').disabled = false;
          el('downloadUpdate').disabled = false;
          el('downloadUpdate').textContent = '安装更新';
          el('updateStatus').textContent =
            '校验通过，请在系统窗口确认安装。首次更新可能需要允许本应用安装更新。';
          C9Android.installUpdate();
        } else if (next.phase === 'error') {
          clearInterval(timer);
          working = false;
          el('laterUpdate').disabled = false;
          el('downloadUpdate').disabled = false;
          el('updateStatus').textContent = next.error || '更新失败，请重试';
        }
      } catch (e) {
        clearInterval(timer);
        working = false;
        el('laterUpdate').disabled = false;
        el('downloadUpdate').disabled = false;
        el('updateStatus').textContent = '更新失败，请重试';
      }
    }, 300);
  };
  document.getElementById('checkUpdate')?.addEventListener('click', () => check(true));
  setTimeout(() => check(false), 3000);
  return {
    check,
    get working() {
      return working;
    },
  };
})();

// System push is available only in the SDK-enabled Android build.
if (typeof C9Push !== 'undefined') {
  const panel = document.getElementById('settingsPanel');
  if (panel) {
    const button = document.createElement('button');
    button.id = 'systemPushSettings';
    button.textContent = '消息通知';
    button.onclick = () => globalThis.C9Push.openSettings();
    (panel.querySelector('.actions') || panel).append(button);
  }
}
globalThis.C9OpenPush = (event) => {
  if (typeof role === 'undefined' || !role || typeof tasks === 'undefined') return false;
  if (event.targetRole !== role) {
    toast('此通知属于另一身份，请切换身份后查看消息');
    return true;
  }
  const task = tasks.find((value) => value.id === event.taskId);
  if (!task) return false;
  if (!canViewTask(task)) {
    toast('此作业已不可查看');
    return true;
  }
  selected = task.id;
  shown = 30;
  StudyUI.beginTask();
  renderDetail();
  if (!document.getElementById('detailDialog').open)
    document.getElementById('detailDialog').showModal();
  return true;
};
