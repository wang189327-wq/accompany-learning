'use strict';
globalThis.ImageZoom = (() => {
  function attach(stage, image, controls) {
    let scale = 1,
      x = 0,
      y = 0,
      destroyed = false,
      startPinch = null,
      startDrag = null;
    const pointers = new Map(),
      clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const paint = () => {
      if (destroyed) return;
      image.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
      image.style.cursor = scale > 1 ? 'zoom-out' : 'zoom-in';
      stage.dataset.zoomed = scale > 1 ? 'true' : 'false';
      for (const b of controls?.querySelectorAll('[data-zoom-action]') || [])
        b.disabled =
          (b.dataset.zoomAction === 'out' && scale <= 1) ||
          (b.dataset.zoomAction === 'in' && scale >= 5);
    };
    const resize = (next, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) => {
      const r = stage.getBoundingClientRect(),
        ox = cx - r.left - stage.clientWidth / 2,
        oy = cy - r.top - stage.clientHeight / 2,
        prev = scale;
      scale = clamp(next, 1, 5);
      x = scale === 1 ? 0 : (x - ox) * (scale / prev) + ox;
      y = scale === 1 ? 0 : (y - oy) * (scale / prev) + oy;
      paint();
    };
    const reset = () => {
      scale = 1;
      x = 0;
      y = 0;
      paint();
    };
    const down = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        startPinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale };
        startDrag = null;
      } else if (scale > 1)
        startDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, baseX: x, baseY: y };
    };
    const move = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && startPinch) {
        const [a, b] = [...pointers.values()],
          d = Math.hypot(a.x - b.x, a.y - b.y);
        resize(
          (startPinch.scale * d) / Math.max(1, startPinch.distance),
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
        );
        e.preventDefault();
      } else if (startDrag?.id === e.pointerId && scale > 1) {
        x = startDrag.baseX + e.clientX - startDrag.x;
        y = startDrag.baseY + e.clientY - startDrag.y;
        paint();
        e.preventDefault();
      }
    };
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) startPinch = null;
      if (startDrag?.id === e.pointerId) startDrag = null;
    };
    const wheel = (e) => {
      e.preventDefault();
      resize(scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
    };
    const tap = (e) => {
      if (pointers.size > 0) return;
      e.preventDefault();
      resize(scale > 1 ? 1 : 2, e.clientX, e.clientY);
    };
    const control = (e) => {
      const b = e.target.closest('[data-zoom-action]');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.zoomAction === 'in') resize(scale * 1.3);
      else if (b.dataset.zoomAction === 'out') resize(scale / 1.3);
      else reset();
    };
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', wheel, { passive: false });
    image.addEventListener('click', tap);
    controls?.addEventListener('click', control);
    paint();
    return {
      reset,
      get scale() {
        return scale;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stage.removeEventListener('pointerdown', down);
        stage.removeEventListener('pointermove', move);
        stage.removeEventListener('pointerup', up);
        stage.removeEventListener('pointercancel', up);
        stage.removeEventListener('wheel', wheel);
        image.removeEventListener('click', tap);
        controls?.removeEventListener('click', control);
        delete stage.dataset.zoomed;
      },
    };
  }
  return { attach };
})();
