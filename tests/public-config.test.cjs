const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { readConfig } = require('../scripts/config.cjs');
const missing = path.join(__dirname, 'not-a-config.json');
test('公开版默认无私人接口和更新源，配置仅允许自己的HTTPS地址', () => {
  assert.deepEqual(readConfig({}, missing), { apiEndpoint: '', updateManifestUrl: '' });
  assert.deepEqual(
    readConfig(
      {
        C9_API_ENDPOINT: 'https://api.example.com/',
        C9_UPDATE_MANIFEST_URL: 'https://study.example.com/updates/latest.json',
      },
      missing,
    ),
    {
      apiEndpoint: 'https://api.example.com',
      updateManifestUrl: 'https://study.example.com/updates/latest.json',
    },
  );
  for (const url of [
    'http://api.example.com',
    'https://u:p@api.example.com',
    'https://api.example.com/api',
    'https://api.example.com/?secret=x',
    'https://api.example.com:444',
  ])
    assert.throws(() => readConfig({ C9_API_ENDPOINT: url }, missing));
  assert.throws(() =>
    readConfig({ C9_UPDATE_MANIFEST_URL: 'https://study.example.com/other.txt' }, missing),
  );
});
test('公开安卓构建不覆盖连接配置，未配置更新有提示且保留原校验', () => {
  const root = path.join(__dirname, '..'),
    android = fs.readFileSync(path.join(root, 'android/android-client.js'), 'utf8'),
    native = fs.readFileSync(
      path.join(root, 'android/src/cn/c9/studyplan/UpdateManager.java'),
      'utf8',
    );
  assert.ok(!android.includes('globalThis.C9_DEFAULT_ENDPOINT='));
  for (const check of [
    'MANIFEST_URL.isEmpty()',
    '尚未配置更新地址',
    'new URL(MANIFEST_URL).getHost()',
    '/updates/banxue-record-v',
    'SHA-256',
    'version(next)<=version(current)',
    'Arrays.equals(a[0].toByteArray(),b[0].toByteArray())',
  ])
    assert.ok(native.includes(check), check);
});
test('部署占位访问码不能启动真实接口', () => {
  const { createServer } = require('../cloud/server.cjs');
  assert.throws(
    () => createServer({ token: 'GENERATE_AT_LEAST_32_RANDOM_CHARACTERS' }),
    /不要使用示例占位值/,
  );
});
test('公开锁文件只引用官方npm下载地址，避免本机镜像缓存掩盖失效下载', () => {
  const lock = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../cloud/package-lock.json'), 'utf8'),
  );
  const packages = Object.values(lock.packages).filter((x) => x.resolved);
  assert.ok(packages.length > 0);
  for (const item of packages)
    assert.ok(item.resolved.startsWith('https://registry.npmjs.org/'), item.resolved);
});
