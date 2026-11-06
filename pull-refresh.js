'use strict';
(() => {
  let gesture = null,
    loading = false;
  const status = document.getElementById('pullStatus');
  function blocked() {
    return (
      !role ||
      tab === 'mine' ||
      busy ||
      MyUI.editing ||
      TaskOrdering.active ||
      FileViewer.active ||
      !!document.querySelector('dialog[open]')
    );
  }
  function reset() {
    gesture = null;
    if (!loading) status.classList.add('hidden');
  }
  document.addEventListener(
    'touchstart',
    (e) => {
      if (
        e.touches.length !== 1 ||
        blocked() ||
        window.scrollY > 1 ||
        e.target.closest('input,select,textarea,button,a,summary,.tableScroll,.admissionsScroll')
      )
        return;
      gesture = { x: e.touches[0].clientX, y: e.touches[0].clientY, distance: 0 };
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!gesture || loading) return;
      if (e.touches.length !== 1 || blocked()) {
        reset();
        return;
      }
      const dx = e.touches[0].clientX - gesture.x,
        dy = e.touches[0].clientY - gesture.y;
      if (dy < 0 || Math.abs(dx) > Math.max(30, dy * 0.7)) {
        reset();
        return;
      }
      gesture.distance = dy;
      if (dy > 30) {
        e.preventDefault();
        status.classList.remove('hidden');
        status.textContent = dy >= 100 ? '松开刷新' : '下拉刷新';
      }
    },
    { passive: false },
  );
  document.addEventListener(
    'touchend',
    async () => {
      const distance = gesture?.distance || 0;
      gesture = null;
      if (distance < 100 || blocked() || loading) {
        reset();
        return;
      }
      loading = true;
      status.textContent = '正在刷新…';
      status.classList.remove('hidden');
      try {
        await refresh();
        toast('已刷新');
      } catch (err) {
        toast('刷新失败：' + err.message);
      } finally {
        loading = false;
        reset();
      }
    },
    { passive: true },
  );
  document.addEventListener('touchcancel', reset, { passive: true });
})();
