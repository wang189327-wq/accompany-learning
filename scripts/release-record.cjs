'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function record(apkPath) {
  const manifest = fs.readFileSync(path.join(root, 'android/AndroidManifest.xml'), 'utf8');
  const bytes = fs.readFileSync(path.resolve(apkPath));
  const originPath = path.join(root, 'personal-origin.json');
  const origin = fs.existsSync(originPath) ? JSON.parse(fs.readFileSync(originPath, 'utf8')) : null;
  const sourceCommit =
    origin?.sourceCommit ||
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  const result = {
    variant: origin ? 'personal' : 'public',
    sourceCommit,
    versionName: manifest.match(/android:versionName="([^"]+)"/)[1],
    versionCode: Number(manifest.match(/android:versionCode="(\d+)"/)[1]),
    cloudBuild: Number(
      fs.readFileSync(path.join(root, 'cloud/server.cjs'), 'utf8').match(/build:\s*(\d+)/)[1],
    ),
    apk: {
      name: path.basename(apkPath),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    builtAt: new Date().toISOString(),
    physicalDeviceTested: false,
  };
  const out = path.join(root, 'verification-results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'build-identity.json'), JSON.stringify(result, null, 2));
  return result;
}
if (require.main === module) {
  try {
    if (!process.argv[2]) throw Error('请提供实际APK路径');
    console.log(JSON.stringify(record(process.argv[2])));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { record };
