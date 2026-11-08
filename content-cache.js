'use strict';
// 附件解析结果缓存：同一附件第二次打开直接复用，省掉重新解析。
// 键里带内容摘要，同一个 uploadId 下内容变了不会命中旧结果。
globalThis.C9ContentCache = (() => {
  function create({ maxBytes = 32 * 1024 * 1024, maxEntries = 4 } = {}) {
    const entries = new Map();
    const stats = { hits: 0, misses: 0, evictions: 0 };
    let bytes = 0;
    function drop(key) {
      const entry = entries.get(key);
      if (!entry) return;
      entries.delete(key);
      bytes -= entry.bytes;
      stats.evictions++;
      try {
        entry.dispose?.();
      } catch {}
    }
    function get(key) {
      const entry = entries.get(key);
      if (!entry) {
        stats.misses++;
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      stats.hits++;
      return entry.value;
    }
    function set(key, value, { bytes: size = 0, dispose = null } = {}) {
      drop(key);
      // 超大文件仍由预览器持有并显示；不额外缓存，关闭时由预览器释放。
      // 返回 null 让 PDF 调用方保留资源所有权，不会误以为已交给缓存。
      if (size > maxBytes || maxEntries < 1) return null;
      entries.set(key, { value, bytes: size, dispose });
      bytes += size;
      while (bytes > maxBytes || entries.size > maxEntries) drop(entries.keys().next().value);
      return value;
    }
    function clear() {
      for (const key of [...entries.keys()]) drop(key);
    }
    return { get, set, drop, clear, stats: () => ({ ...stats, bytes, entries: entries.size }) };
  }
  // 优先用 SHA-256 前 8 字节；没有 SubtleCrypto（部分安卓 WebView）时退化为双 FNV。
  async function digest(source) {
    try {
      const buffer =
        typeof Blob !== 'undefined' && source instanceof Blob ? await source.arrayBuffer() : source;
      if (globalThis.crypto?.subtle) {
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return [...new Uint8Array(hash).subarray(0, 8)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }
      const view = new Uint8Array(buffer);
      let first = 0x811c9dc5,
        second = 0x1000193;
      for (let i = 0; i < view.length; i++) {
        first = ((first ^ view[i]) * 0x01000193) >>> 0;
        second = (second + view[i] * (i + 1)) >>> 0;
      }
      return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
    } catch {
      return '';
    }
  }
  // 摘要失败返回空键，调用方据此跳过缓存，宁可重解析也不复用错误内容。
  function key(source, uploadId, hash) {
    return hash ? (source || 'local') + '|' + (uploadId || '') + '|' + hash : '';
  }
  return { create, digest, key };
})();
