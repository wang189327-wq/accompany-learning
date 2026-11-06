'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { createHash } = require('node:crypto'),
  { loadAsync } = require('../zip-reader.js');
const root = path.join(__dirname, '..'),
  hash = (b) => createHash('sha256').update(b).digest('hex');
async function scan(zip, label) {
  let count = 0;
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || (!name.startsWith('assets/') && !name.startsWith('public/'))) continue;
    if (!/\.(js|html|json)$/.test(name)) continue;
    const text = await file.async('string');
    if (
      /https:\/\/[a-z0-9-]+\.(?:cn-[a-z0-9-]+\.)?fcapp\.run|https:\/\/[a-z0-9-]+\.netlify\.app/.test(
        text,
      )
    )
      throw Error('Unexpected deployed host in ' + label + ': ' + name);
    count++;
  }
  return count;
}
(async () => {
  const apkBytes = await fs.readFile(path.join(root, 'android/release/伴学记录-v4.0.apk')),
    apk = await loadAsync(apkBytes),
    checks = {};
  checks.apkTextAssetsScanned = await scan(apk, 'APK');
  const runtime = await apk.file('assets/runtime-config.js').async('string');
  if (runtime !== 'globalThis.C9_DEFAULT_ENDPOINT="";\n')
    throw Error('Public APK endpoint is not empty');
  for (const name of ['docx-preview.txt', 'jszip.txt', 'pdfjs.txt'])
    if (!apk.file('assets/third-party-notices/' + name)) throw Error('License missing from APK');
  let assets = 0;
  async function verify(dir, rel = '') {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await verify(path.join(dir, e.name), rel + e.name + '/');
      else {
        const local = await fs.readFile(path.join(dir, e.name)),
          entry = apk.file('assets/' + rel + e.name);
        if (!entry || hash(await entry.async('nodebuffer')) !== hash(local))
          throw Error('APK asset mismatch ' + rel + e.name);
        assets++;
      }
    }
  }
  await verify(path.join(root, 'android/build/assets'));
  checks.apkAssetsVerified = assets;
  const packages = [];
  for (const name of [
    '伴学记录云端接口部署包.zip',
    '伴学记录云端界面.zip',
    '伴学记录自动备份函数.zip',
  ]) {
    const bytes = await fs.readFile(path.join(root, 'cloud/release', name)),
      zip = await loadAsync(bytes);
    if (name.includes('接口')) {
      for (const file of [
        'core.cjs',
        'task-service.cjs',
        'assignment-groups.cjs',
        'assignment-groups.js',
        'extras.cjs',
        'server.cjs',
        'aliyun.cjs',
        'package-lock.json',
      ])
        if (
          hash(await zip.file(file).async('nodebuffer')) !==
          hash(await fs.readFile(path.join(root, 'cloud', file)))
        )
          throw Error('Cloud source mismatch ' + file);
      if (!zip.file('public/third-party-notices/docx-preview.txt'))
        throw Error('Cloud license missing');
      checks.cloudTextAssetsScanned = await scan(zip, 'Cloud');
    }
    packages.push({ name, bytes: bytes.length, sha256: hash(bytes) });
  }
  const result = {
    passed: true,
    name: '伴学记录',
    version: '4.0',
    versionCode: 57,
    cloudBuild: 55,
    apk: { bytes: apkBytes.length, sha256: hash(apkBytes) },
    checks,
    packages,
    physicalAndroidTested: false,
    realBusinessDataChanged: false,
    realGPTCalled: false,
  };
  await fs.mkdir(path.join(root, 'verification-results'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'verification-results/artifacts.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
