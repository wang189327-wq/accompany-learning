'use strict';
const FileViewer = (() => {
  let items = [],
    index = 0,
    serial = 0,
    objectUrl = null,
    pdf = null,
    pdfTask = null,
    pdfPage = 1,
    renderTask = null,
    pdfRenderId = 0,
    gesture = null,
    busyDownload = false,
    imageZoom = null,
    documentZoom = null,
    pdfQualityTimer = null,
    pdfQualityRevision = 0,
    pdfObserver = null,
    pdfVisible = new Set(),
    pdfQueued = new Set(),
    pdfSlots = [],
    pdfPumping = false;
  let lastTiming = null;
  const wordCache = new Map(),
    localWordIds = new WeakMap();
  let nextWordId = 0,
    wordCacheBytes = 0;
  const el = (id) => document.getElementById(id);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog id="fileGallery" class="fileGallery"><div class="dialogHead"><div class="galleryHeading"><h3 id="galleryName"></h3></div><button id="galleryClose">关闭</button></div><div class="galleryControls"><button id="galleryPrev">上一份</button><span id="galleryCount" role="status"></span><button id="galleryNext">下一份</button><button id="galleryDownload">下载</button></div><div id="galleryContent" tabindex="0" aria-label="附件预览，可左右滑动切换"></div><div id="galleryZoomControls" class="galleryControls imageZoomControls hidden" aria-label="预览缩放"><button data-zoom-action="out" aria-label="缩小图片">−</button><button data-zoom-action="reset">适应屏幕</button><button data-zoom-action="in" aria-label="放大图片">＋</button><span id="galleryZoomValue" class="hidden" role="status"></span></div><div id="pdfControls" class="galleryControls hidden"><span id="pdfCount" role="status"></span><span>上下滑动翻页</span></div></dialog>',
  );
  const image = (file) =>
    /^image\//i.test(file.contentType || file.blob?.type || '') ||
    /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
  function clear() {
    serial++;
    clearTimeout(pdfQualityTimer);
    pdfQualityTimer = null;
    pdfQualityRevision++;
    documentZoom?.destroy();
    documentZoom = null;
    pdfRenderId++;
    pdfObserver?.disconnect();
    pdfObserver = null;
    pdfVisible.clear();
    pdfQueued.clear();
    pdfSlots = [];
    pdfPumping = false;
    imageZoom?.destroy();
    imageZoom = null;
    renderTask?.cancel();
    renderTask = null;
    const task = pdfTask,
      document = pdf;
    pdfTask = null;
    pdf = null;
    try {
      if (task) Promise.resolve(task.destroy()).catch(() => {});
      else if (document) Promise.resolve(document.destroy()).catch(() => {});
    } catch {}
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    el('galleryContent').classList.remove('imageGalleryActive', 'documentGalleryActive');
    el('galleryZoomValue').classList.add('hidden');
    el('galleryZoomControls').classList.add('hidden');
    el('galleryContent').replaceChildren();
    el('pdfControls').classList.add('hidden');
  }
  function text(message) {
    const paragraph = document.createElement('p');
    paragraph.className = 'empty';
    paragraph.textContent = message;
    el('galleryContent').replaceChildren(paragraph);
  }
  async function blob(file, status) {
    if (file.blob) {
      status?.('local');
      return file.blob;
    }
    return Cloud.fileBlob(file.uploadId, status);
  }

  // A scaled surface gives the browser real scroll extents for long documents.
  // Single-finger scrolling remains native; only a two-finger pinch is handled here.
  function attachDocumentZoom(
    stage,
    body,
    controls,
    { label = 'Word', onScale = () => {}, onWidth = () => {} } = {},
  ) {
    let scale = 1,
      baseWidth = 0,
      destroyed = false,
      pinch = null,
      drag = null,
      frame = 0;
    const surface = document.createElement('div');
    surface.className = 'documentZoomSurface';
    body.before(surface);
    surface.append(body);
    body.classList.add('documentZoomContent');
    stage.classList.add('documentGalleryActive');
    controls.classList.remove('hidden');
    controls.setAttribute('aria-label', label + '缩放');
    const value = el('galleryZoomValue');
    value.classList.remove('hidden');
    controls.querySelector('[data-zoom-action=out]').setAttribute('aria-label', '缩小' + label);
    controls.querySelector('[data-zoom-action=in]').setAttribute('aria-label', '放大' + label);
    const clamp = (v) => Math.max(1, Math.min(5, v));
    function layout() {
      if (destroyed) return;
      const previousWidth = baseWidth;
      baseWidth = Math.max(1, stage.clientWidth);
      body.style.width = baseWidth + 'px';
      if (previousWidth && previousWidth !== baseWidth) onWidth(baseWidth, previousWidth);
      surface.style.width = baseWidth * scale + 'px';
      body.style.transform = 'scale(' + scale + ')';
      surface.style.height = Math.max(body.offsetHeight, body.scrollHeight) * scale + 'px';
      stage.dataset.documentScale = String(scale);
      stage.dataset.zoomed = scale > 1 ? 'true' : 'false';
      stage.style.cursor = scale > 1 ? 'grab' : '';
      value.textContent = Math.round(scale * 100) + '%';
      controls.querySelector('[data-zoom-action=out]').disabled = scale <= 1;
      controls.querySelector('[data-zoom-action=in]').disabled = scale >= 5;
    }
    function setScale(next, cx, cy, anchor) {
      if (destroyed) return;
      const rect = stage.getBoundingClientRect(),
        x = (cx ?? rect.left + stage.clientWidth / 2) - rect.left,
        y = (cy ?? rect.top + stage.clientHeight / 2) - rect.top,
        point = anchor || { x: (stage.scrollLeft + x) / scale, y: (stage.scrollTop + y) / scale },
        previous = scale;
      scale = clamp(next);
      layout();
      stage.scrollLeft = point.x * scale - x;
      stage.scrollTop = point.y * scale - y;
      if (previous !== scale) onScale(scale);
    }
    function start(e) {
      if (e.touches.length !== 2) {
        pinch = null;
        return;
      }
      const [a, b] = e.touches,
        rect = stage.getBoundingClientRect(),
        x = (a.clientX + b.clientX) / 2 - rect.left,
        y = (a.clientY + b.clientY) / 2 - rect.top;
      pinch = {
        distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        scale,
        anchor: { x: (stage.scrollLeft + x) / scale, y: (stage.scrollTop + y) / scale },
      };
    }
    function move(e) {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const [a, b] = e.touches;
      setScale(
        (pinch.scale * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) / pinch.distance,
        (a.clientX + b.clientX) / 2,
        (a.clientY + b.clientY) / 2,
        pinch.anchor,
      );
    }
    function end(e) {
      if (e.touches.length !== 2) pinch = null;
    }
    function control(e) {
      const button = e.target.closest('[data-zoom-action]');
      if (!button) return;
      e.preventDefault();
      if (button.dataset.zoomAction === 'reset') {
        const rect = stage.getBoundingClientRect();
        setScale(1, rect.left, rect.top);
        stage.scrollLeft = 0;
      } else setScale(scale * (button.dataset.zoomAction === 'in' ? 1.3 : 1 / 1.3));
    }
    function wheel(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    }
    function down(e) {
      if (e.pointerType !== 'mouse' || e.button !== 0 || scale <= 1) return;
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: stage.scrollLeft,
        top: stage.scrollTop,
      };
      stage.setPointerCapture?.(e.pointerId);
      stage.style.cursor = 'grabbing';
      e.preventDefault();
    }
    function pan(e) {
      if (!drag || drag.id !== e.pointerId) return;
      stage.scrollLeft = drag.left + drag.x - e.clientX;
      stage.scrollTop = drag.top + drag.y - e.clientY;
      e.preventDefault();
    }
    function up(e) {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      stage.style.cursor = scale > 1 ? 'grab' : '';
    }
    const observe = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(layout);
      },
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(observe) : null;
    stage.addEventListener('touchstart', start, { passive: true });
    stage.addEventListener('touchmove', move, { passive: false });
    stage.addEventListener('touchend', end);
    stage.addEventListener('touchcancel', end);
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', pan);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', wheel, { passive: false });
    controls.addEventListener('click', control);
    observer?.observe(stage);
    observer?.observe(body);
    layout();
    return {
      get scale() {
        return scale;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        observer?.disconnect();
        cancelAnimationFrame(frame);
        stage.removeEventListener('touchstart', start);
        stage.removeEventListener('touchmove', move);
        stage.removeEventListener('touchend', end);
        stage.removeEventListener('touchcancel', end);
        stage.removeEventListener('pointerdown', down);
        stage.removeEventListener('pointermove', pan);
        stage.removeEventListener('pointerup', up);
        stage.removeEventListener('pointercancel', up);
        stage.removeEventListener('wheel', wheel);
        controls.removeEventListener('click', control);
        stage.classList.remove('documentGalleryActive');
        stage.style.cursor = '';
        delete stage.dataset.zoomed;
        delete stage.dataset.documentScale;
      },
    };
  }
  function refreshPdfQuality(stamp) {
    clearTimeout(pdfQualityTimer);
    pdfQualityTimer = setTimeout(() => {
      if (stamp !== serial || !pdf) return;
      pdfQualityRevision++;
      renderTask?.cancel();
      for (const slot of pdfSlots) {
        const canvas = slot.querySelector('canvas');
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
          canvas.remove();
        }
        delete slot.dataset.rendered;
        const number = Number(slot.dataset.page);
        if (pdfVisible.has(number)) pdfQueued.add(number);
      }
      pumpPdf(stamp);
    }, 180);
  }

  async function drawPdfPage(number, stamp) {
    const slot = pdfSlots[number - 1],
      document = pdf,
      quality = pdfQualityRevision;
    if (!slot || !document || stamp !== serial || slot.dataset.rendered === 'true') return;
    const page = await document.getPage(number);
    if (stamp !== serial) return;
    const width = Math.max(200, el('galleryContent').clientWidth - 24),
      scale = Math.min(2, width / page.getViewport({ scale: 1 }).width),
      viewport = page.getViewport({ scale }),
      canvas = globalThis.document.createElement('canvas');
    const displayScale = documentZoom?.scale || 1,
      density = Math.min(
        Math.max(2, globalThis.devicePixelRatio || 1) * displayScale,
        20,
        Math.sqrt(12000000 / (viewport.width * viewport.height)),
        8192 / Math.max(viewport.width, viewport.height),
      );
    canvas.width = Math.max(1, Math.ceil(viewport.width * density));
    canvas.height = Math.max(1, Math.ceil(viewport.height * density));
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    canvas.style.maxWidth = '100%';
    canvas.setAttribute('aria-label', 'PDF 第 ' + number + ' 页');
    slot.style.width = viewport.width + 'px';
    slot.style.height = viewport.height + 'px';
    slot.append(canvas);
    const task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0],
    });
    renderTask = task;
    try {
      await task.promise;
      if (stamp === serial && quality === pdfQualityRevision) {
        slot.dataset.rendered = 'true';
        slot.dataset.renderScale = String(displayScale);
        slot.querySelector('.pdfPageLabel')?.remove();
      } else canvas.remove();
    } catch (e) {
      canvas.remove();
      if (e.name !== 'RenderingCancelledException') throw e;
    } finally {
      if (renderTask === task) renderTask = null;
      page.cleanup();
    }
  }
  async function pumpPdf(stamp) {
    if (pdfPumping || stamp !== serial) return;
    pdfPumping = true;
    try {
      while (pdfQueued.size && stamp === serial) {
        const number = pdfQueued.values().next().value;
        pdfQueued.delete(number);
        if (!pdfVisible.has(number)) continue;
        try {
          await drawPdfPage(number, stamp);
        } catch (e) {
          if (stamp === serial) {
            const slot = pdfSlots[number - 1];
            if (slot) slot.textContent = '第 ' + number + ' 页加载失败，请重新打开或下载查看。';
          }
        }
      }
    } finally {
      if (stamp === serial) pdfPumping = false;
    }
  }
  async function pdfRender(stamp) {
    const document = pdf;
    if (!document || stamp !== serial) return;
    const first = await document.getPage(1);
    if (stamp !== serial) return;
    const width = Math.max(200, el('galleryContent').clientWidth - 24),
      viewport = first.getViewport({
        scale: Math.min(2, width / first.getViewport({ scale: 1 }).width),
      }),
      pages = globalThis.document.createElement('div');
    pages.className = 'pdfPages';
    pdfSlots = Array.from({ length: document.numPages }, (_, i) => {
      const slot = globalThis.document.createElement('section');
      slot.className = 'pdfPage';
      slot.dataset.page = String(i + 1);
      slot.style.width = viewport.width + 'px';
      slot.style.height = viewport.height + 'px';
      slot.setAttribute('aria-label', 'PDF 第 ' + (i + 1) + ' 页');
      const label = globalThis.document.createElement('span');
      label.className = 'pdfPageLabel';
      label.textContent = '第 ' + (i + 1) + ' 页';
      slot.append(label);
      pages.append(slot);
      return slot;
    });
    el('galleryContent').replaceChildren(pages);
    documentZoom = attachDocumentZoom(el('galleryContent'), pages, el('galleryZoomControls'), {
      label: 'PDF',
      onScale: () => refreshPdfQuality(stamp),
      onWidth: (width) => {
        const next = Math.max(200, width - 24);
        for (const slot of pdfSlots) {
          const previous = parseFloat(slot.style.width) || next,
            height = parseFloat(slot.style.height) || next;
          slot.style.width = next + 'px';
          slot.style.height = (height * next) / previous + 'px';
        }
        refreshPdfQuality(stamp);
      },
    });
    el('pdfCount').textContent = '1 / ' + document.numPages + ' 页';
    el('pdfControls').classList.remove('hidden');
    pdfVisible.add(1);
    await drawPdfPage(1, stamp);
    if (stamp !== serial) return;
    if (typeof IntersectionObserver === 'function') {
      pdfObserver = new IntersectionObserver(
        (entries) => {
          if (stamp !== serial) return;
          for (const entry of entries) {
            const number = Number(entry.target.dataset.page);
            if (entry.isIntersecting) {
              pdfVisible.add(number);
              if (entry.target.dataset.rendered !== 'true') pdfQueued.add(number);
            } else {
              pdfVisible.delete(number);
              pdfQueued.delete(number);
              const canvas = entry.target.querySelector('canvas');
              if (canvas && entry.target.dataset.rendered === 'true') {
                canvas.width = 1;
                canvas.height = 1;
                canvas.remove();
                delete entry.target.dataset.rendered;
              }
            }
          }
          pumpPdf(stamp);
        },
        { root: el('galleryContent'), rootMargin: '900px 0px' },
      );
      pdfSlots.forEach((slot) => pdfObserver.observe(slot));
    } else {
      for (let n = 2; n <= document.numPages; n++) {
        if (stamp !== serial) return;
        await drawPdfPage(n, stamp);
      }
    }
  }
  el('galleryContent').addEventListener(
    'scroll',
    () => {
      if (!pdfSlots.length) return;
      const root = el('galleryContent').getBoundingClientRect(),
        center = root.top + root.height / 2;
      const slot =
        pdfSlots.find((s) => s.getBoundingClientRect().bottom > center) || pdfSlots.at(-1);
      el('pdfCount').textContent = slot.dataset.page + ' / ' + pdfSlots.length + ' 页';
    },
    { passive: true },
  );
  async function wordPreview(data, file, stamp, timing) {
    const body = document.createElement('div'),
      styles = document.createElement('div');
    body.className = 'docxPreview';
    el('galleryContent').replaceChildren(styles, body);
    let key;
    if (file.uploadId && typeof Cloud !== 'undefined')
      key = (await Cloud.attachmentScope()) + '|' + file.uploadId;
    else {
      if (!localWordIds.has(data)) localWordIds.set(data, ++nextWordId);
      key = 'local:' + localWordIds.get(data);
    }
    if (stamp !== serial) return;
    const cached = wordCache.get(key);
    if (cached) {
      styles.append(...[...cached.styles.childNodes].map((n) => n.cloneNode(true)));
      body.append(...[...cached.body.childNodes].map((n) => n.cloneNode(true)));
      wordCache.delete(key);
      wordCache.set(key, cached);
      timing.reusedParsed = true;
    } else {
      await docx.renderAsync(data, body, styles, {
        className: 'c9-docx',
        inWrapper: true,
        ignoreWidth: true,
        ignoreHeight: true,
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
        renderComments: false,
      });
      if (stamp !== serial) return;
      const size = body.innerHTML.length * 2 + styles.innerHTML.length * 2;
      if (size <= 16 * 1024 * 1024) {
        while (wordCache.size >= 2 || wordCacheBytes + size > 16 * 1024 * 1024) {
          const oldest = wordCache.keys().next().value;
          wordCacheBytes -= wordCache.get(oldest).size;
          wordCache.delete(oldest);
        }
        wordCache.set(key, { body: body.cloneNode(true), styles: styles.cloneNode(true), size });
        wordCacheBytes += size;
      }
    }
    for (const link of body.querySelectorAll('a')) {
      const href = link.getAttribute('href') || '';
      if (!/^(https?:|mailto:|#)/i.test(href)) link.removeAttribute('href');
      link.addEventListener('click', (e) => e.preventDefault());
    }
    for (const item of body.querySelectorAll('[contenteditable]'))
      item.removeAttribute('contenteditable');
    documentZoom = attachDocumentZoom(el('galleryContent'), body, el('galleryZoomControls'));
  }
  async function show(next) {
    if (!items.length) return;
    clear();
    index = Math.max(0, Math.min(items.length - 1, next));
    const stamp = serial,
      { file, entry } = items[index];
    el('galleryName').textContent = entry.name;
    const pageMode = entry.type === 'exam' && image(file);
    el('galleryPrev').textContent = pageMode ? '上一页' : '上一份';
    el('galleryNext').textContent = pageMode ? '下一页' : '下一份';
    el('galleryCount').textContent = index + 1 + ' / ' + items.length;
    el('galleryPrev').disabled = index === 0;
    el('galleryNext').disabled = index === items.length - 1;
    el('galleryContent').scrollTop = 0;
    const timing = {
        downloadMs: 0,
        parseMs: 0,
        totalMs: 0,
        bytes: 0,
        source: 'network',
        reusedParsed: false,
      },
      started = performance.now();
    text('正在下载资料…');
    try {
      const data = await blob(file, (source) => {
        timing.source = source;
        if (stamp === serial) text(source === 'network' ? '正在下载资料…' : '正在读取资料…');
      });
      if (stamp !== serial) return;
      timing.downloadMs = performance.now() - started;
      timing.bytes = data.size;
      const parseStart = performance.now();
      if (image(file)) {
        objectUrl = URL.createObjectURL(data);
        const img = document.createElement('img');
        img.className = 'galleryImage';
        img.src = objectUrl;
        img.alt = entry.name;
        img.draggable = false;
        img.onerror = () => {
          if (stamp === serial) text('图片无法预览，请下载后打开。');
        };
        el('galleryContent').replaceChildren(img);
        el('galleryContent').classList.add('imageGalleryActive');
        el('galleryZoomControls').classList.remove('hidden');
        el('galleryZoomControls').setAttribute('aria-label', '图片缩放');
        el('galleryZoomControls')
          .querySelector('[data-zoom-action=out]')
          .setAttribute('aria-label', '缩小图片');
        el('galleryZoomControls')
          .querySelector('[data-zoom-action=in]')
          .setAttribute('aria-label', '放大图片');
        imageZoom = ImageZoom.attach(el('galleryContent'), img, el('galleryZoomControls'));
      } else if (
        /\.pdf$/i.test(file.name) ||
        /application\/pdf/i.test(file.contentType || data.type || '')
      ) {
        text('正在解析 PDF…');
        const lib = await import('./pdf.mjs');
        if (stamp !== serial) return;
        lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', location.href).href;
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (stamp !== serial) return;
        if (typeof C9Android !== 'undefined') {
          globalThis.pdfjsWorker = await import('./pdf.worker.mjs');
          if (stamp !== serial) return;
        }
        const options = {
          ...(typeof C9Android !== 'undefined'
            ? { useSystemFonts: false, useWorkerFetch: false }
            : {}),
          isEvalSupported: false,
          isImageDecoderSupported: false,
          isOffscreenCanvasSupported: false,
          cMapUrl: new URL('pdf-cmaps/', location.href).href,
          cMapPacked: true,
          standardFontDataUrl: new URL('pdf-fonts/', location.href).href,
          wasmUrl: new URL('pdf-wasm/', location.href).href,
        };
        let task = lib.getDocument({ ...options, data: bytes.slice() });
        pdfTask = task;
        let document;
        try {
          document = await task.promise;
        } catch (error) {
          if (!/worker/i.test(error.message || '')) throw error;
          await task.destroy().catch(() => {});
          if (stamp !== serial) return;
          globalThis.pdfjsWorker = await import('./pdf.worker.mjs');
          if (stamp !== serial) return;
          task = lib.getDocument({ ...options, data: bytes.slice() });
          pdfTask = task;
          document = await task.promise;
        }
        if (stamp !== serial) {
          await document.destroy();
          return;
        }
        pdf = document;
        pdfPage = 1;
        await pdfRender(stamp);
      } else if (/\.docx$/i.test(file.name)) {
        text('正在解析 Word…');
        await wordPreview(data, file, stamp, timing);
      } else if (/\.(txt|csv|md|json)$/i.test(file.name)) {
        const pre = document.createElement('pre'),
          value = await data.text();
        if (stamp !== serial) return;
        pre.className = 'galleryText';
        pre.textContent =
          value.slice(0, 200000) +
          (value.length > 200000 ? '\n\n预览仅显示前 200000 个字符，请下载查看全文。' : '');
        el('galleryContent').replaceChildren(pre);
      } else {
        text('此格式暂不支持直接预览。可继续左右滑动浏览其他附件，或下载后用 WPS 等软件打开。');
      }
      if (stamp === serial) {
        timing.parseMs = performance.now() - parseStart;
        timing.totalMs = performance.now() - started;
        lastTiming = timing;
      }
    } catch (e) {
      if (stamp !== serial) return;
      console.warn('C9 preview:', e.message);
      text(
        e.name === 'PasswordException'
          ? '此PDF已加密，请先用WPS解除密码后重新上传，或下载后打开。'
          : '此文件暂时无法预览：' +
              (e.message || '未知错误') +
              '。可下载后打开，也可以继续切换其他附件。',
      );
    }
  }
  function open(list, position = 0) {
    if (el('fileGallery').open) clear();
    items = list;
    if (!items.length) {
      toast('当前文件夹没有附件');
      return;
    }
    if (!el('fileGallery').open) el('fileGallery').showModal();
    show(position);
  }
  function close() {
    clear();
    items = [];
    el('fileGallery').close();
  }
  el('fileGallery').addEventListener('close', () => {
    if (el('fileGallery').open) return;
    clear();
    items = [];
  });
  el('fileGallery').addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!busyDownload) close();
  });
  document.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.id === 'galleryClose') {
      if (!busyDownload) close();
    } else if (button.id === 'galleryPrev') {
      show(index - 1);
    } else if (button.id === 'galleryNext') {
      show(index + 1);
    } else if (button.id === 'galleryDownload') {
      if (busyDownload) return;
      busyDownload = true;
      button.disabled = true;
      const file = items[index].file;
      try {
        const data = await blob(file);
        if (typeof AndroidPhotos !== 'undefined') await AndroidPhotos.saveFile(data, file.name);
        else await download(data, file.name);
      } catch (e) {
        toast(e.message);
      } finally {
        busyDownload = false;
        button.disabled = false;
      }
    }
  });
  el('galleryContent').addEventListener('pointerdown', (e) => {
    if (e.button === 0 && e.isPrimary !== false)
      gesture = { x: e.clientX, y: e.clientY, id: e.pointerId, at: Date.now() };
  });
  el('galleryContent').addEventListener('pointerup', (e) => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const dx = e.clientX - gesture.x,
      dy = e.clientY - gesture.y,
      duration = Date.now() - gesture.at;
    gesture = null;
    if (documentZoom || imageZoom?.scale > 1) return;
    if (duration < 1500 && Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      if (dx < 0 && index < items.length - 1) show(index + 1);
      else if (dx > 0 && index > 0) show(index - 1);
    }
  });
  el('galleryContent').addEventListener('pointercancel', () => {
    gesture = null;
  });
  el('galleryContent').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (documentZoom) return;
      e.preventDefault();
      show(index + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
  return {
    open,
    get lastTiming() {
      return lastTiming ? { ...lastTiming } : null;
    },
    get active() {
      return el('fileGallery').open;
    },
  };
})();
