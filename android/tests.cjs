'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { prepare } = require('./prepare-assets.cjs');
async function fixture(fail = false) {
  const calls = [],
    messages = [];
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((bytes) => {
        this.result = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
        this.onload();
      });
    }
  }
  const context = vm.createContext({
    Blob,
    FileReader: Reader,
    toast: (m) => messages.push(m),
    C9Android: {
      beginPhoto(name, type) {
        calls.push(['begin', name, type]);
        return '{"id":"photo-1"}';
      },
      photoChunk(id, data) {
        calls.push(['chunk', id, data]);
        return fail ? '{"error":"保存图片失败"}' : '{}';
      },
      finishPhoto(id) {
        calls.push(['finish', id]);
        return '{}';
      },
      cancelPhoto(id) {
        calls.push(['cancel', id]);
      },
    },
  });
  vm.runInContext(await fs.readFile(path.join(__dirname, 'android-client.js'), 'utf8'), context);
  return { context, calls, messages };
}
test('manual album save preserves full content across chunk boundaries', async () => {
  const f = await fixture();
  assert.equal(f.calls.length, 0);
  const content = Buffer.alloc(600000);
  for (let i = 0; i < content.length; i++) content[i] = i % 251;
  f.context.blob = new Blob([content], { type: 'image/png' });
  await vm.runInContext('AndroidPhotos.save(blob,"作业图片.png")', f.context);
  const chunks = f.calls.filter((c) => c[0] === 'chunk');
  assert.equal(chunks.length, 3);
  assert.deepEqual(Buffer.concat(chunks.map((c) => Buffer.from(c[2], 'base64'))), content);
  assert.equal(f.calls.at(-1)[0], 'finish');
  assert.deepEqual(f.messages, ['图片已保存到手机相册']);
});
test('failed save cancels partial image and permits retry', async () => {
  const f = await fixture(true);
  f.context.blob = new Blob(['image'], { type: 'image/png' });
  await assert.rejects(
    vm.runInContext('AndroidPhotos.save(blob,"作业图片.png")', f.context),
    /保存图片失败/,
  );
  assert.equal(f.calls.at(-1)[0], 'cancel');
  assert.equal(f.messages.length, 0);
  await assert.rejects(
    vm.runInContext('AndroidPhotos.save(blob,"作业图片.png")', f.context),
    /保存图片失败/,
  );
  assert.equal(f.calls.filter((c) => c[0] === 'begin').length, 2);
});
test('documents use explicit save destination and preserve chunked bytes', async () => {
  const f = await fixture();
  let poll = 0;
  f.context.setTimeout = setTimeout;
  f.context.C9Android.beginFile = (name, type) => {
    f.calls.push(['document', name, type]);
    return '{"id":"doc-1"}';
  };
  f.context.C9Android.fileState = () => JSON.stringify({ ready: ++poll > 1 });
  f.context.C9Android.finishFile = (id) => {
    f.calls.push(['done-document', id]);
    return '{}';
  };
  const bytes = Buffer.alloc(700000, 37);
  f.context.blob = new Blob([bytes], { type: 'application/pdf' });
  await vm.runInContext('AndroidPhotos.saveFile(blob,"试卷.pdf")', f.context);
  assert.equal(f.calls[0][0], 'document');
  assert.equal(f.calls[0][2], 'application/pdf');
  assert.equal(poll, 2);
  assert.deepEqual(
    Buffer.concat(f.calls.filter((c) => c[0] === 'chunk').map((c) => Buffer.from(c[2], 'base64'))),
    bytes,
  );
  assert.equal(f.calls.at(-1)[0], 'done-document');
});
test('cancelled document picker stops saving and cleans the pending job', async () => {
  const f = await fixture();
  f.context.C9Android.beginFile = () => '{"id":"doc-cancel"}';
  f.context.C9Android.fileState = () => '{"error":"已取消保存"}';
  f.context.blob = new Blob(['document'], { type: 'application/pdf' });
  await assert.rejects(
    vm.runInContext('AndroidPhotos.saveFile(blob,"资料.pdf")', f.context),
    /已取消保存/,
  );
  assert.equal(f.calls.at(-1)[0], 'cancel');
  assert.equal(f.calls.filter((c) => c[0] === 'chunk').length, 0);
});
test('APK assets start locally and await native album save errors', async () => {
  await prepare();
  const assets = path.join(__dirname, 'build/assets');
  const html = await fs.readFile(path.join(assets, 'index.html'), 'utf8');
  const names = [...html.matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]);
  assert(names.includes('android-client.js'));
  const native = await fs.readFile(
    path.join(__dirname, 'src/app/accompany/learning/MainActivity.java'),
    'utf8',
  );
  const generatedAssets = await fs.readFile(
    path.join(__dirname, 'src/app/accompany/learning/AssetList.java'),
    'utf8',
  );
  assert.ok(native.includes('ASSETS = AssetList.NAMES'));
  const assetList = generatedAssets.match(
    /NAMES\s*=\s*new HashSet<>\(Arrays\.asList\(([\s\S]*?)\)\)/,
  );
  assert.ok(assetList, 'Android asset routing allowlist exists');
  const allowed = new Set([...assetList[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  for (const name of names)
    assert.ok(allowed.has(name), 'Android WebView must allow the packaged script: ' + name);
  for (const name of names) {
    assert(!name.includes('/'));
    new vm.Script(await fs.readFile(path.join(assets, name), 'utf8'));
  }
  const app = await fs.readFile(path.join(assets, 'app.js'), 'utf8');
  assert(/await\s+download\(\s*await\s+Cloud\.imageBlob\(im\.uploadId\)/.test(app));
  assert(/return\s+AndroidPhotos\.save\(blob,\s*name\)/.test(app));
  assert(!html.includes('安卓相册保存将在 APK 版本接入'));
  assert(!html.includes('C9_ACCESS_TOKEN'));
});
async function fontFixture(initial, blocked = false) {
  const events = {},
    state = { stored: initial },
    elements = {
      fontSizeSelect: {
        value: '',
        addEventListener(name, fn) {
          events.change = fn;
        },
      },
      fontSaveHint: { textContent: '' },
      fontSettings: {
        addEventListener(name, fn) {
          events.open = fn;
        },
      },
      fontDialog: {
        showModal() {
          state.open = true;
        },
      },
    };
  const document = { documentElement: { style: {} }, getElementById: (id) => elements[id] };
  const localStorage = {
    getItem() {
      if (blocked) throw Error('blocked');
      return state.stored;
    },
    setItem(key, value) {
      if (blocked) throw Error('blocked');
      state.key = key;
      state.stored = value;
    },
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'font-settings.js'), 'utf8'), {
    document,
    localStorage,
  });
  return { events, state, elements, document };
}
test('text size applies immediately, persists per device and restores on reopening', async () => {
  const f = await fontFixture('large');
  assert.equal(f.document.documentElement.style.fontSize, '18px');
  f.events.open();
  assert.equal(f.state.open, true);
  for (const [mode, pixels] of [
    ['small', 13],
    ['standard', 15],
    ['large', 18],
    ['extraLarge', 21],
  ]) {
    f.elements.fontSizeSelect.value = mode;
    f.events.change();
    assert.equal(f.document.documentElement.style.fontSize, pixels + 'px');
    assert.equal(f.state.stored, mode);
  }
  const restored = await fontFixture(f.state.stored);
  assert.equal(restored.document.documentElement.style.fontSize, '21px');
  const otherDevice = await fontFixture(null);
  assert.equal(otherDevice.document.documentElement.style.fontSize, '15px');
});
test('invalid or blocked preferences still allow readable font changes', async () => {
  const invalid = await fontFixture('toString');
  assert.equal(invalid.document.documentElement.style.fontSize, '15px');
  const blocked = await fontFixture(null, true);
  blocked.elements.fontSizeSelect.value = 'extraLarge';
  blocked.events.change();
  assert.equal(blocked.document.documentElement.style.fontSize, '21px');
  assert.match(blocked.elements.fontSaveHint.textContent, /暂时无法保存/);
});
