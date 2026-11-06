'use strict';
(() => {
  const key = 'c9-background-v1',
    choices = [
      ['default', '浅灰绿', '#f3f6f3'],
      ['green', '浅豆绿', '#edf5e9'],
      ['cream', '暖米白', '#faf3e3'],
      ['blue', '雾蓝', '#eaf2f8'],
      ['lavender', '淡紫', '#f0ecf5'],
    ];
  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog id="backgroundDialog"><div class="dialogHead"><h3>背景色选择</h3><button data-close="backgroundDialog">关闭</button></div><div class="backgroundChoices">' +
      choices
        .map(
          ([id, name, color]) =>
            '<button type="button" data-background="' +
            id +
            '" aria-pressed="false"><span class="backgroundSwatch" style="background:' +
            color +
            '"></span>' +
            name +
            '</button>',
        )
        .join('') +
      '</div><p id="backgroundHint" class="muted">仅调整本设备，不影响另一台设备。</p></dialog>',
  );
  const themes = {
    default: ['#225d4c', '#174d3c', '#e8f0e9', '#c9dcd2'],
    green: ['#3f6537', '#2e4f29', '#deebd5', '#c8dcc0'],
    cream: ['#805b25', '#65451b', '#f2e6cb', '#e0d1b2'],
    blue: ['#315d87', '#22486d', '#dce8f5', '#c0d2e5'],
    lavender: ['#685081', '#503962', '#e7def0', '#d0c1e0'],
  };
  function apply(id) {
    const chosen = choices.find((c) => c[0] === id) || choices[0];
    document.documentElement.style.setProperty('--c9-background', chosen[2]);
    const theme = themes[chosen[0]];
    ['--c9-accent', '--c9-accent-hover', '--c9-soft', '--c9-border'].forEach((key, i) =>
      document.documentElement.style.setProperty(key, theme[i]),
    );
    document
      .querySelectorAll('[data-background]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.background === chosen[0])),
      );
    try {
      if (typeof C9Android !== 'undefined' && C9Android.widgetBackground)
        C9Android.widgetBackground(chosen[2]);
    } catch {}
    return chosen[0];
  }
  let saved;
  try {
    saved = localStorage.getItem(key);
  } catch {}
  apply(saved);
  document
    .getElementById('backgroundSettings')
    .addEventListener('click', () => document.getElementById('backgroundDialog').showModal());
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-background]');
    if (!button) return;
    const id = apply(button.dataset.background);
    try {
      localStorage.setItem(key, id);
      document.getElementById('backgroundHint').textContent = '已保存，下次打开仍使用此背景色。';
    } catch {
      document.getElementById('backgroundHint').textContent =
        '背景色已调整，此设备暂时无法保存设置。';
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === key) apply(e.newValue);
  });
})();
