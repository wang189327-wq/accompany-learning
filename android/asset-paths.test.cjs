const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const zip = require('../zip-reader.js');
test('APK nested PDF assets use Android slash paths and preserve all font/CMap/wasm bytes', async () => {
  const root = path.join(__dirname, '..'),
    manifest = await fs.readFile(path.join(__dirname, 'AndroidManifest.xml'), 'utf8'),
    version = manifest.match(/android:versionName="([0-9.]+)"/)[1],
    apk = await zip.loadAsync(
      await fs.readFile(path.join(__dirname, 'release/accompany-learning-v' + version + '.apk')),
    );
  const assets = Object.keys(apk.files).filter((n) => n.startsWith('assets/'));
  assert.equal(
    assets.some((n) => n.includes('\\')),
    false,
    'Windows archive separators prevent Android AssetManager access',
  );
  assert.ok(apk.file('assets/pdf-fonts/LiberationSans-Regular.ttf'));
  assert.ok(apk.file('assets/pdf-cmaps/UniGB-UCS2-H.bcmap'));
  for (const folder of ['pdf-fonts', 'pdf-cmaps', 'pdf-wasm'])
    for (const n of await fs.readdir(path.join(root, folder))) {
      const entry = apk.file('assets/' + folder + '/' + n);
      assert.ok(entry, folder + '/' + n);
      assert.deepEqual(
        await entry.async('nodebuffer'),
        await fs.readFile(path.join(root, folder, n)),
      );
    }
});
