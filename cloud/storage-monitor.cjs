'use strict';
function createStorageMonitor({ thresholdGB = 1, clock = Date.now, ttl = 600000 } = {}) {
  const threshold = Number(thresholdGB);
  if (!Number.isFinite(threshold) || threshold <= 0) throw Error('C9_STORAGE_WARN_GB必须为正数');
  let cached = null,
    until = 0,
    pending = null;
  function status(read) {
    if (cached && clock() < until) return Promise.resolve(cached);
    if (pending) return pending;
    pending = (async () => {
      let value;
      try {
        const stat = await read();
        const bytes = Number(stat.Storage),
          count = Number(stat.ObjectCount),
          parts = Number(stat.MultipartUploadCount);
        if (![bytes, count, parts].every((n) => Number.isSafeInteger(n) && n >= 0))
          throw Error('Invalid bucket statistics');
        const modified = Number(stat.LastModifiedTime);
        value = {
          available: true,
          bytes,
          objects: count,
          incompleteUploads: parts,
          thresholdBytes: threshold * 1000000000,
          exceeded: bytes >= threshold * 1000000000,
          statisticsAt: Number.isFinite(modified) && modified > 0 ? modified * 1000 : null,
          checkedAt: clock(),
          delayed: true,
          uploadLimited: false,
        };
      } catch {
        value = {
          available: false,
          bytes: null,
          exceeded: false,
          thresholdBytes: threshold * 1000000000,
          checkedAt: clock(),
          message: '暂时无法读取云端容量，请检查oss:GetBucketStat权限；上传不受影响',
          uploadLimited: false,
        };
      }
      cached = value;
      until = clock() + (value.available ? ttl : 30000);
      return value;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  return { status };
}
module.exports = { createStorageMonitor };
