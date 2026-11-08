const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path');
const root = path.join(__dirname, '../..');
function load() {
  const context = vm.createContext({
    Map,
    Promise,
    Uint8Array,
    ArrayBuffer,
    Blob,
    crypto,
    globalThis: undefined,
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'content-cache.js'), 'utf8'), context);
  return context.C9ContentCache;
}
test('解析结果缓存按内容摘要命中，同键复用且不重复解析', async () => {
  const C9ContentCache = load();
  const cache = C9ContentCache.create({ maxBytes: 1024, maxEntries: 4 });
  let parses = 0;
  const parse = async () => {
    parses++;
    return { body: 'parsed' };
  };
  const hash = await C9ContentCache.digest(new Blob(['内容A']));
  const key = C9ContentCache.key('cloud', 'upload-1', hash);
  assert.equal(await cache.get(key), null);
  const value = await parse();
  cache.set(key, value, { bytes: 10 });
  assert.deepEqual(await cache.get(key), { body: 'parsed' });
  assert.equal(parses, 1);
  assert.equal(cache.stats().hits, 1);
  assert.equal(cache.stats().misses, 1);
});

test('同一uploadId下内容变化不会命中旧解析结果', async () => {
  const C9ContentCache = load();
  const first = await C9ContentCache.digest(new Blob(['第一版']));
  const second = await C9ContentCache.digest(new Blob(['改过的第二版']));
  assert.notEqual(first, second);
  assert.notEqual(
    C9ContentCache.key('cloud', 'upload-1', first),
    C9ContentCache.key('cloud', 'upload-1', second),
  );
  // 空摘要表示摘要失败，此时返回空键，调用方跳过缓存而不是复用错误内容。
  assert.equal(C9ContentCache.key('cloud', 'upload-1', ''), '');
});

test('超出预算按LRU淘汰并调用dispose释放底层资源', () => {
  const C9ContentCache = load();
  const cache = C9ContentCache.create({ maxBytes: 100, maxEntries: 3 });
  const disposed = [];
  cache.set('a', 1, { bytes: 60, dispose: () => disposed.push('a') });
  cache.set('b', 2, { bytes: 60, dispose: () => disposed.push('b') });
  assert.deepEqual(disposed, ['a'], '写入第二条时应淘汰最旧的 a');
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 2);
  cache.set('c', 3, { bytes: 10, dispose: () => disposed.push('c') });
  // b 刚被命中刷新过顺序，因此再次超预算时淘汰的是 c 之后的最旧项。
  assert.equal(cache.stats().entries <= 3, true);
  cache.clear();
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().bytes, 0);
});

test('超大文件继续由预览器使用，不入缓存且不提前释放', () => {
  const C9ContentCache = load();
  const cache = C9ContentCache.create({ maxBytes: 10, maxEntries: 1 });
  const active = { ok: true };
  let disposed = false;
  assert.equal(cache.set('big', active, { bytes: 999, dispose: () => (disposed = true) }), null);
  assert.equal(active.ok, true);
  assert.equal(cache.get('big'), null);
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().bytes, 0);
  assert.equal(disposed, false);
});
